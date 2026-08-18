'use strict';

/**
 * ClineStyleAgentCore — an agent response system with:
 *   1. Plan mode — creates a checkable task checklist before executing
 *   2. Tool calling — LLM-driven function calls with approval gates
 *   3. Diff previews — file changes are previewed before being applied
 *   4. Status transitions — proposal → approved → applied → verified
 *
 * This is a self-contained implementation that mirrors the Cline-style
 * agent UX: the model plans, previews changes, calls tools, and reports
 * results with visible status cards at every step.
 */

const crypto = require('node:crypto');
const { TaskPlan, STEP_STATUS, plannerSystemPrompt, extractPlanEnvelope } = require('./AgentPlanner');
const { FileChangeRecord, REVIEW_STATUS, buildDiff, applyEditBlocks, fileSha256 } = require('./ToolReview');

const AGENT_STATUS = Object.freeze({
  IDLE: 'idle',
  PLANNING: 'planning',       // model is producing a plan
  AWAITING_PLAN: 'awaiting_plan_approval',  // plan shown to user
  EXECUTING: 'executing',     // executing plan steps
  REVIEWING: 'reviewing',     // diff preview shown, awaiting approval
  COMPLETED: 'completed',
  FAILED: 'failed',
  STOPPED: 'stopped',
});

class ClineStyleAgentCore {
  constructor({ registry, provider, ctx = {}, approvalRequestor, maxToolCalls = 40, emitEvent = async () => {} } = {}) {
    if (!registry) throw new Error('ClineStyleAgentCore requires a ToolRegistry.');
    if (!provider) throw new Error('ClineStyleAgentCore requires a provider.');
    this.registry = registry;
    this.provider = provider;
    this.ctx = ctx || {};
    this.approvalRequestor = typeof approvalRequestor === 'function' ? approvalRequestor : async () => 'approved';
    this.maxToolCalls = Math.max(1, Number(maxToolCalls) || 40);
    this.emitEvent = typeof emitEvent === 'function' ? emitEvent : async () => {};
    this.conversations = new Map();
    this._plans = new Map();          // sessionId -> TaskPlan
    this._reviews = new Map();        // sessionId -> Map(filePath, FileChangeRecord)
    this._aborters = new Map();
    this._fileReaders = new Map();    // sessionId -> readFile(path) helper
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /**
   * Register a file reader for verification and diff previews.
   */
  setFileReader(sessionId, readFile) {
    if (typeof readFile === 'function') this._fileReaders.set(String(sessionId || 'session'), readFile);
  }

  getPlan(sessionId) {
    return this._plans.get(String(sessionId || 'session')) || null;
  }

  getReview(sessionId) {
    return this._reviews.get(String(sessionId || 'session')) || null;
  }

  /**
   * Run one full agent step: plan → approve → execute → preview → report.
   */
  async run(stepContext = {}) {
    const sessionId = String(stepContext.sessionId || 'session');
    const objective = String(stepContext.objective || '').trim() || String(stepContext.instruction || '').trim();
    const messages = this.messagesFor(sessionId, stepContext.conversation);
    const aborter = new AbortController();
    const parentSignal = stepContext.signal;
    const abortFromParent = () => aborter.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else if (parentSignal && typeof parentSignal.addEventListener === 'function') parentSignal.addEventListener('abort', abortFromParent, { once: true });
    this._aborters.set(sessionId, aborter);

    // FIX #5: Local timeout enforcement — guarantee termination even if the
    // provider hangs. Default 5 minutes per run; configurable via stepContext.timeoutMs.
    const timeoutMs = Number(stepContext.timeoutMs) || 300000;
    const timeoutTimer = setTimeout(() => {
      const error = new Error(`Agent run timed out after ${timeoutMs} ms.`);
      error.code = 'AGENT_RUN_TIMEOUT';
      aborter.abort(error);
    }, timeoutMs);

    try {
      // 1. Inject objective as user message if not already present
      if (objective && !messages.some(message => message.role === 'user' && String(message.content || '').includes(objective))) {
        messages.push({ role: 'user', content: objective });
      }

      // 2. Plan phase — ask the model to produce a plan envelope
      await this.emitEvent({ sessionId, type: 'plan.started', phase: 'plan.started', status: 'running', objective });
      await this.emitStatus(sessionId, AGENT_STATUS.PLANNING, 'Planning the steps for this task…');

      const plan = await this._producePlan(sessionId, messages, objective, aborter.signal);
      this._plans.set(sessionId, plan);

      await this.emitEvent({ sessionId, type: 'plan.created', phase: 'plan.created', status: 'completed', plan: plan.serialize() });
      await this.emitStatus(sessionId, AGENT_STATUS.AWAITING_PLAN, `Plan created with ${plan.steps.length} steps. Awaiting approval…`);

      // 3. Await plan approval (if configured to require it)
      const planDecision = await this.approvalRequestor({
        kind: 'plan',
        name: 'createPlan',
        plan: plan.serialize(),
        sessionId,
      });
      if (planDecision !== 'approved') {
        await this.emitEvent({ sessionId, type: 'plan.rejected', phase: 'plan.rejected', status: 'blocked', reason: 'Plan was not approved.' });
        return { status: 'stopped', plan: plan.serialize(), summary: 'Plan was not approved.' };
      }
      await this.emitEvent({ sessionId, type: 'plan.approved', phase: 'plan.approved', status: 'completed', plan: plan.serialize() });

      // 4. Execution phase — run tools, tracking plan step status
      await this.emitStatus(sessionId, AGENT_STATUS.EXECUTING, 'Executing the approved plan…');
      const result = await this._executePlan(sessionId, messages, plan, aborter.signal, stepContext);

      // 5. Final summary
      return {
        ...result,
        plan: plan.serialize(),
      };
    } finally {
      clearTimeout(timeoutTimer);
      this._aborters.delete(sessionId);
      if (parentSignal && typeof parentSignal.removeEventListener === 'function') parentSignal.removeEventListener('abort', abortFromParent);
    }
  }

  stop(sessionId) {
    const aborter = this._aborters.get(String(sessionId || 'session'));
    if (aborter && !aborter.signal.aborted) aborter.abort();
  }

  reset(sessionId) {
    const id = String(sessionId || 'session');
    this.conversations.delete(id);
    this._plans.delete(id);
    this._reviews.delete(id);
    this._fileReaders.delete(id);
  }

  // ---------------------------------------------------------------
  // Internal: conversation management
  // ---------------------------------------------------------------

  messagesFor(sessionId, durableConversation = null) {
    let messages = this.conversations.get(sessionId);
    if (!messages) {
      const durableMessages = Array.isArray(durableConversation?.messages)
        ? durableConversation.messages.filter(m => m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool'))
        : [];
      const systemContent = [
        'You are a local engineering agent that plans before acting.',
        '1. You start by creating a clear, bounded plan.',
        '2. You execute one step at a time using available tools.',
        '3. Before editing a file, you read it, preview the change, and apply it.',
        '4. You always report completion with concrete evidence.',
        'Never invent tool results. Use your tools for every claim.',
        'Keep final responses concise: what changed, evidence, and next steps.',
      ].join('\n');
      messages = [{ role: 'system', content: systemContent }, ...durableMessages];
      this.conversations.set(sessionId, messages);
    }
    return messages;
  }

  // ---------------------------------------------------------------
  // Internal: plan production
  // ---------------------------------------------------------------

  async _producePlan(sessionId, messages, objective, signal) {
    // Ask the provider for a plan using a planning prompt and the createPlan tool.
    const createPlanTool = {
      type: 'function',
      function: {
        name: 'createPlan',
        description: 'Create a structured plan for the current objective. The plan must contain a list of concrete, checkable steps.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short plan title.' },
            steps: {
              type: 'array',
              description: 'Ordered list of concrete steps.',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Short step title.' },
                  description: { type: 'string', description: 'What the step will do.' },
                },
                required: ['title'],
              },
            },
          },
          required: ['title', 'steps'],
        },
      },
    };
    const plannerMessages = [
      ...messages.slice(0, 1), // system
      { role: 'system', content: plannerSystemPrompt(this.registry, objective) },
      ...messages.filter(m => m.role === 'user').slice(-1),
    ];

    const response = await awaitWithAbort(this.provider.complete({
      messages: plannerMessages,
      tools: [createPlanTool],
      signal,
    }), signal);

    const assistant = { role: 'assistant', content: response.content || '' };
    if (response.toolCalls?.length) {
      assistant.tool_calls = response.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
      }));
    }
    messages.push(assistant);

    // Extract plan from tool call arguments or free-text envelope.
    // FIX #6: Do NOT fabricate a tool result. `createPlan` is an internal
    // planning step, not a registered tool — pushing a fake `{role:'tool'}`
    // message would violate "never invent tool results". Instead, record the
    // plan as an assistant message so the conversation stays truthful.
    const planCall = (response.toolCalls || []).find(tc => tc.name === 'createPlan');
    if (planCall) {
      const args = planCall.arguments || {};
      const steps = Array.isArray(args.steps) ? args.steps.map(step => ({ title: String(step.title || '').trim() || 'Step' })) : [];
      const plan = new TaskPlan({ objective, sessionId, steps });
      // Replace the assistant tool-call message with a plain assistant message
      // describing the plan (no fabricated tool result).
      const last = messages.at(-1);
      if (last && last.role === 'assistant' && Array.isArray(last.tool_calls)) {
        last.tool_calls = [];
        last.content = `Plan created with ${plan.steps.length} steps: ${plan.steps.map(s => s.title).join('; ')}`;
      }
      return plan;
    }

    // Free-text plan envelope fallback
    const envelope = extractPlanEnvelope(response.content);
    const plan = TaskPlan.fromRawPlan(envelope || response.content || '', {
      objective,
      sessionId,
      fallbackSteps: [
        'Inspect the workspace and existing state',
        'Read relevant files',
        'Make the requested change',
        'Validate the result',
        'Report completion evidence',
      ],
    });
    // If raw plan had no steps, use fallback
    if (!plan.steps.length) {
      plan.addStep({ title: 'Inspect the workspace and existing state' });
      plan.addStep({ title: 'Read relevant files' });
      plan.addStep({ title: 'Make the requested change' });
      plan.addStep({ title: 'Validate the result' });
      plan.addStep({ title: 'Report completion evidence' });
    }
    return plan;
  }

  // ---------------------------------------------------------------
  // Internal: execution
  // ---------------------------------------------------------------

  async _executePlan(sessionId, messages, plan, signal, stepContext = {}) {
    const emitExecutionEvent = typeof stepContext.emitExecutionEvent === 'function' ? stepContext.emitExecutionEvent : async () => {};
    let toolCallsThisStep = 0;
    let currentStepIndex = 0;
    const planMap = new Map(plan.steps.map((step, index) => [step.id, index]));

    // Notify UI: first step starts
    if (plan.steps.length) {
      plan.markRunning(0);
      this.emitEvent({ sessionId, type: 'plan.step.running', phase: 'plan.step.running', status: 'running', step: plan.steps[0] });
    }

    while (toolCallsThisStep < this.maxToolCalls) {
      if (signal?.aborted) {
        this.emitEvent({ sessionId, type: 'plan.step.stopped', phase: 'plan.step.stopped', status: 'stopped', plan: plan.serialize() });
        return { status: 'stopped', summary: 'Stopped by user.', plan: plan.serialize() };
      }

      // Inject plan step context into the model
      const pendingSteps = plan.steps.filter(step => step.status === STEP_STATUS.PENDING || step.status === STEP_STATUS.RUNNING);
      const planContext = {
        role: 'system',
        content: [
          'CURRENT PLAN:',
          ...plan.steps.map(step => `[${step.status.toUpperCase()}] ${step.index}. ${step.title}${step.description ? ` — ${step.description}` : ''}`),
          '',
          pendingSteps.length ? `NEXT STEP TO EXECUTE: ${pendingSteps[0].index}. ${pendingSteps[0].title}` : 'ALL STEPS COMPLETED',
        ].join('\n'),
      };
      messages.push(planContext);

      const response = await awaitWithAbort(this.provider.complete({
        messages,
        tools: this.registry.openAiTools(),
        signal,
      }), signal);

      messages.pop(); // remove plan context (re-injected next loop)
      const assistant = { role: 'assistant', content: response.content || '' };
      if (response.toolCalls?.length) {
        assistant.tool_calls = response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
        }));
      }
      messages.push(assistant);
      if (assistant.tool_calls?.length) {
        await this.emitEvent({ sessionId, type: 'conversation.message', phase: 'conversation.message', message: { role: 'assistant', content: '', tool_calls: assistant.tool_calls } });
      }

      // No tool calls → final answer
      if (!response.toolCalls?.length) {
        // FIX #3: Do NOT force plan.phase = 'completed' here. If any step
        // failed/blocked, the plan must stay failed/blocked (monotonic).
        // Only mark running steps complete; never regress a failed step.
        const hasFailure = plan.steps.some(step => step.status === STEP_STATUS.FAILED || step.status === STEP_STATUS.BLOCKED);
        if (!hasFailure) {
          for (const step of plan.steps) {
            if (step.status === STEP_STATUS.RUNNING) step.status = STEP_STATUS.COMPLETED;
          }
          if (plan.steps.every(step => step.status === STEP_STATUS.COMPLETED)) plan.phase = 'completed';
        }
        const incomplete = !hasFailure && plan.steps.some(step => step.status !== STEP_STATUS.COMPLETED);
        if (incomplete) {
          for (let index = 0; index < plan.steps.length; index += 1) {
            if (plan.steps[index].status === STEP_STATUS.PENDING || plan.steps[index].status === STEP_STATUS.RUNNING) {
              plan.markBlocked(index, 'The model ended before this plan step was executed.');
            }
          }
        }
        const terminalStatus = hasFailure ? 'failed' : incomplete ? 'blocked' : 'completed';
        await this.emitEvent({ sessionId, type: 'plan.completed', phase: 'plan.completed', status: terminalStatus, plan: plan.serialize() });
        await this.emitStatus(sessionId, terminalStatus === 'completed' ? AGENT_STATUS.COMPLETED : AGENT_STATUS.FAILED, terminalStatus === 'completed' ? 'Task completed' : terminalStatus === 'blocked' ? 'Task blocked: the plan was not completed.' : 'Task failed');
        return {
          status: terminalStatus,
          summary: response.content || plan.objective || (terminalStatus === 'completed' ? 'Objective completed.' : terminalStatus === 'blocked' ? 'Objective was not completed.' : 'Objective failed.'),
          plan: plan.serialize(),
          evidence: [],
        };
      }

      // Execute tool calls
      for (const tc of response.toolCalls) {
        if (toolCallsThisStep >= this.maxToolCalls) break;
        toolCallsThisStep += 1;

        // Map execution phase to plan step
        const stepIndex = this._stepForTool(tc.name, plan, planMap);
        if (stepIndex !== null) {
          plan.markRunning(stepIndex);
          await this.emitEvent({ sessionId, type: 'plan.step.running', phase: 'plan.step.running', status: 'running', step: plan.steps[stepIndex] });
        }

        const execution = this._baseExecutionEvent(stepContext, tc, sessionId);
        await this.emitEvent({ ...execution, type: 'execution.phase.changed', status: 'running', phase: execution.phase });
        await this.emitEvent({ ...execution, type: 'execution.tool.started', status: 'running', phase: execution.phase });

        // Approval gate
        if (this.registry.requiresApproval(tc.name)) {
          await this.emitEvent({ ...execution, type: 'execution.tool.approval_requested', status: 'waiting_for_approval', phase: execution.phase });
          const decision = await this.approvalRequestor({ name: tc.name, arguments: tc.arguments, sessionId });
          await this.emitEvent({ ...execution, type: 'execution.tool.approval_decided', status: decision === 'approved' ? 'running' : 'blocked', phase: execution.phase });
          if (decision !== 'approved') {
            const toolMessage = { role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: false, error: 'Approval denied.' }) };
            messages.push(toolMessage);
            await this.emitEvent({ ...execution, type: 'execution.tool.failed', status: 'failed', phase: 'recovering', error: { code: 'APPROVAL_DENIED', message: 'Approval denied.' } });
            if (stepIndex !== null) {
              plan.markFailed(stepIndex, 'Approval denied.');
              await this.emitEvent({ sessionId, type: 'plan.step.failed', phase: 'plan.step.failed', status: 'failed', step: plan.steps[stepIndex] });
            }
            continue;
          }
        }

        // Tool execution with change preview for edit tools
        try {
          const preview = await this._previewToolChange(tc, sessionId);
          if (preview) {
            await this.emitEvent({ sessionId, type: 'execution.tool.preview', phase: 'execution.tool.preview', status: 'reviewing', toolCallId: tc.id, review: preview });
            await this.emitStatus(sessionId, AGENT_STATUS.REVIEWING, `Previewing change to ${preview.filePath}…`);
          }

          const result = await this.registry.execute(tc.name, tc.arguments, {
            ...this.ctx,
            sessionId,
            turnId: stepContext.turnId || stepContext.stepId,
            stepId: stepContext.stepId,
            toolCallId: tc.id,
          });

          const toolMessage = { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result.output ?? { ok: result.ok }) };
          messages.push(toolMessage);
          await this.emitEvent({ sessionId, type: 'conversation.message', phase: 'conversation.message', message: toolMessage });

          const completed = {
            ...execution,
            type: result.ok ? 'execution.tool.completed' : 'execution.tool.failed',
            status: result.ok ? 'completed' : 'failed',
            phase: result.ok ? execution.phase : 'recovering',
            outputSummary: { ok: result.ok === true, keys: Object.keys(result.output || {}).slice(0, 20) },
            error: result.ok ? null : { message: String(result.output?.error?.message || result.output?.error || 'Tool execution failed.') },
            receiptId: result.output?.receipt?.id || result.output?.receiptId || null,
          };
          await this.emitEvent(completed);

          // FIX #1 + #2: Branch on result.ok. A failed tool marks the step FAILED,
          // and "verified" is only set after a real on-disk read (verifyAppliedChange),
          // never fabricated.
          if (preview && result.ok) {
            const record = this._reviews.get(sessionId)?.get(preview.fileKey);
            if (record) {
              record.markApplied(result.output?.receipt?.id || null);
              // Real verification: read the file back and compare to proposed content.
              const readFile = this._fileReaders.get(sessionId);
              if (typeof readFile === 'function') {
                const { verifyAppliedChange } = require('./ToolReview');
                const verified = await verifyAppliedChange(record, async filePath => {
                  const content = await readFile(filePath);
                  return typeof content === 'object' && content !== null ? content.content || '' : content;
                });
                await this.emitEvent({
                  sessionId,
                  type: 'execution.tool.applied',
                  phase: 'execution.tool.applied',
                  status: verified.status === REVIEW_STATUS.VERIFIED ? 'verified' : 'failed',
                  toolCallId: tc.id,
                  review: verified.summary(),
                });
              } else {
                // No file reader available — mark applied but NOT verified.
                record.markApplied(result.output?.receipt?.id || null);
                await this.emitEvent({
                  sessionId,
                  type: 'execution.tool.applied',
                  phase: 'execution.tool.applied',
                  status: 'applied',
                  toolCallId: tc.id,
                  review: record.summary(),
                });
              }
            }
          }

          // FIX #1: Only mark the step completed on success; mark failed on failure.
          if (stepIndex !== null) {
            if (result.ok) {
              plan.markCompleted(stepIndex, String(result.output?.path || ''));
              await this.emitEvent({ sessionId, type: 'plan.step.completed', phase: 'plan.step.completed', status: 'completed', step: plan.steps[stepIndex] });
            } else {
              plan.markFailed(stepIndex, String(result.output?.error?.message || result.output?.error || 'Tool execution failed.'));
              await this.emitEvent({ sessionId, type: 'plan.step.failed', phase: 'plan.step.failed', status: 'failed', step: plan.steps[stepIndex] });
            }
          }
          if (!result.ok) {
            await this.emitEvent({ sessionId, type: 'plan.completed', phase: 'plan.completed', status: 'failed', plan: plan.serialize() });
            await this.emitStatus(sessionId, AGENT_STATUS.FAILED, 'Task failed');
            return { status: 'failed', summary: String(result.output?.error?.message || result.output?.error || 'Tool execution failed.'), plan: plan.serialize(), evidence: [] };
          }
        } catch (error) {
          const toolMessage = {
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ ok: false, error: { code: error?.code || 'TOOL_ERROR', message: String(error?.message || error || 'Tool failed.') } }),
          };
          messages.push(toolMessage);
          await this.emitEvent({ ...execution, type: 'execution.tool.failed', status: signal?.aborted ? 'cancelled' : 'failed', phase: 'recovering', error: { message: String(error?.message || error) } });
          if (stepIndex !== null) {
            plan.markFailed(stepIndex, String(error?.message || error || 'Tool failed.'));
            await this.emitEvent({ sessionId, type: 'plan.step.failed', phase: 'plan.step.failed', status: 'failed', step: plan.steps[stepIndex] });
          }
          throw error;
        }
      }
    }

    return {
      status: 'blocked',
      blocker: 'tool_budget',
      reason: 'Tool-call budget exhausted before the plan completed.',
      plan: plan.serialize(),
    };
  }

  // ---------------------------------------------------------------
  // Internal: diff preview / review
  // ---------------------------------------------------------------

  async _previewToolChange(tc, sessionId) {
    const name = String(tc.name || '').toLowerCase();
    const args = tc.arguments || {};
    const readFile = this._fileReaders.get(sessionId);
    const workspaceRoot = this.ctx.workspaceRoot || this.ctx.workspace?.root || null;

    // Only preview edit tools that change file content
    const isWrite = name === 'writefile' || name === 'applypatch' || name === 'edit' || /(?:edit|patch|write|replace|create)/.test(name);

    // Try to determine target file path
    let filePath = String(args.path || args.filePath || args.target || '');
    const targets = Array.isArray(args.targets) ? args.targets : [];
    if (!filePath && targets.length) filePath = String(targets[0] || '');
    const fileKey = filePath;
    if (!fileKey) return null;

    // FIX #2 (consistency): Resolve the path ONCE and use the same resolved
    // path for the file reader, the FileChangeRecord, and verification.
    // Previously the reader got the relative path at preview time but the
    // record stored the absolute path, so verifyAppliedChange read a
    // different key and could never match.
    const resolvedPath = workspaceRoot ? require('node:path').resolve(workspaceRoot, fileKey) : fileKey;

    // Build the proposed content (for writeFile) or apply edit blocks (for applyPatch)
    let originalContent = null;
    let proposedContent = null;

    try {
      if (typeof readFile === 'function') {
        originalContent = await readFile(resolvedPath);
      } else if (this.ctx.workspace && typeof this.ctx.workspace.read === 'function') {
        originalContent = await this.ctx.workspace.read(fileKey);
      }
      if (originalContent === null || originalContent === undefined) originalContent = '';
      if (typeof originalContent === 'object' && originalContent !== null) originalContent = originalContent.content || '';
      originalContent = String(originalContent);
    } catch (error) {
      // New file — empty original
      originalContent = '';
    }

    if (name === 'writefile') {
      proposedContent = String(args.content ?? args.text ?? '');
    } else if (Array.isArray(args.edits) && args.edits.length) {
      const applied = applyEditBlocks(originalContent, args.edits);
      proposedContent = applied.content;
    } else if (typeof args.content === 'string') {
      proposedContent = args.content;
    } else {
      return null;
    }

    if (originalContent === proposedContent) return null;

    // Create/reuse a FileChangeRecord. Use the RESOLVED path so the record's
    // filePath is absolute and verification reads the correct file.
    let reviews = this._reviews.get(sessionId);
    if (!reviews) {
      reviews = new Map();
      this._reviews.set(sessionId, reviews);
    }
    let record = reviews.get(resolvedPath);
    if (!record) {
      record = new FileChangeRecord({ filePath: resolvedPath, workspaceRoot, originalContent, proposedContent });
      reviews.set(resolvedPath, record);
    }
    const diff = record.set(proposedContent);

    return {
      fileKey: resolvedPath,
      filePath: record.relativePath || fileKey,
      originalContent: originalContent.slice(0, 2000),
      proposedContent: proposedContent.slice(0, 2000),
      diff: diff.text.slice(0, 4000),
      diffStats: { additions: diff.additions, deletions: diff.deletions, changes: diff.changes, truncated: diff.truncated },
      status: record.status,
      action: tc.name,
    };
  }

  // ---------------------------------------------------------------
  // Internal: helpers
  // ---------------------------------------------------------------

  _stepForTool(toolName, plan, planMap) {
    const name = String(toolName || '').toLowerCase();
    // Simple heuristic: writing tools map to the "edit" step; read tools map to "inspect";
    // run/tool commands map to "validate".
    const find = (predicate, indexOffset = 0) => {
      const index = plan.steps.findIndex(predicate);
      return index >= 0 ? index + indexOffset : null;
    };
    if (/(?:write|patch|edit|replace|create|delete)/u.test(name)) {
      return find(step => /(edit|change|write|modify|implement|patch|create|fix)/iu.test(step.title)) ?? null;
    }
    if (/(?:run|test|validate|build|check|lint|compile)/u.test(name)) {
      return find(step => /(valid|test|check|build|run|lint|compile)/iu.test(step.title)) ?? null;
    }
    if (/(?:read|list|search|inspect|git|workspace)/u.test(name)) {
      return find(step => /(inspect|read|list|search|explore|examine|analyze|discover|understand)/iu.test(step.title)) ?? null;
    }
    return null;
  }

  async emitStatus(sessionId, status, detail = '') {
    await this.emitEvent({
      sessionId,
      type: 'agent.status',
      phase: 'agent.status',
      status,
      detail: String(detail || ''),
      timestamp: new Date().toISOString(),
    });
  }

  _baseExecutionEvent(stepContext, tc, sessionId) {
    return {
      sessionId,
      turnId: String(stepContext.turnId || stepContext.stepId || 'turn'),
      stepId: String(stepContext.stepId || 'step'),
      toolCallId: String(tc.id || 'tool-call'),
      toolName: String(tc.name || ''),
      phase: this._phaseForTool(tc.name),
      inputSummary: { argumentKeys: Object.keys(tc.arguments || {}) },
      timestamp: new Date().toISOString(),
    };
  }

  _phaseForTool(name) {
    const value = String(name || '').toLowerCase();
    if (/(?:write|patch|edit|replace|create|delete)/u.test(value)) return 'editing';
    if (/(?:test|check|lint|build|compile|validate|run)/u.test(value)) return 'validating';
    return 'investigating';
  }

  summarize(sessionId) {
    const plan = this._plans.get(sessionId);
    const reviews = this._reviews.get(sessionId);
    return {
      plan: plan ? plan.serialize() : null,
      changes: reviews ? [...reviews.values()].map(record => record.summary()) : [],
    };
  }
}

function awaitWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function abortReason(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error('Agent run was aborted.');
  error.name = 'AbortError';
  return error;
}

module.exports = {
  ClineStyleAgentCore,
  AGENT_STATUS,
  REVIEW_STATUS,
  STEP_STATUS,
};
