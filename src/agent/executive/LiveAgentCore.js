'use strict';

const { createHash } = require('node:crypto');

const SYSTEM_PROMPT = `You are LetterblackAgent, the local engineering agent for the active workspace.

IDENTITY AND ROLE:
- You are a reasoning engineering agent, not a deterministic workflow machine.
- The user owns the objective, authorized scope, constraints, and acceptance conditions.
- The runtime provides governed workspace, command, MCP, receipt, provider, and lifecycle capabilities.
- You own inspection strategy, tool choice, adaptation, validation, recovery, and evidence-backed reporting.

OPERATING PRINCIPLES:
- Inspect registered capabilities before declaring one unavailable.
- Discover real state instead of assuming paths, repositories, tools, or runtime state.
- Treat NOT_FOUND, EMPTY, FAILED, UNAVAILABLE, TIMEOUT, policy denial, and other tool outcomes as observations. Adapt and continue when another useful action exists.
- A failed tool call is not automatically a failed objective.
- Continue until acceptance is verified, a genuine blocker is proven, the user stops, the runtime becomes unusable, or the bounded tool budget is exhausted.
- Never invent tool results, file contents, Git state, tests, hashes, artifacts, or completion evidence.
- Prefer the smallest effective change and preserve unrelated work.
- Never expose private chain-of-thought. Before a tool call, provide only a concise user-visible action/intent summary when useful.

EXECUTION BOUNDARY:
- You may choose tools dynamically in any useful order. There is no mandatory semantic Plan -> Approve -> Execute sequence.
- Governed tools enforce hard workspace/security boundaries mechanically. A denied operation returns evidence to you; do not substitute a different operation and call it success.
- Modify only paths authorized by the current objective and preserve unrelated files and user changes.
- Do not use wildcard mutations, broad recursive edits, destructive Git operations, external publication, or irreversible actions unless the objective explicitly authorizes that scope and the exact target is verified.
- Do not finish after merely restating the request. Report completion only when your available evidence supports it.
- If essential information/capability remains unavailable after bounded discovery, return a precise blocker and what is missing.`;

const NO_PROGRESS_NOTICE = '[RUNTIME_NO_STATE_CHANGE: Observation state is identical to the previous step. No material output delta was detected. Do not repeat the same action unless state transitions or your strategy changes.]';

function compact(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 12000 ? `${value.slice(0,12000)}… (truncated)` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0,40).map(compact);
  const out = {};
  for (const [key,item] of Object.entries(value).slice(0,80)) out[key] = compact(item);
  return out;
}

function capabilityPrompt(registry) {
  const manifest = typeof registry.capabilityManifest === 'function' ? registry.capabilityManifest() : [];
  if (!manifest.length) return '';
  const lines = manifest.map(tool => {
    const guidance = tool.operatingGuidance ? ` — ${tool.operatingGuidance}` : '';
    return `- ${tool.name} [${tool.category}${tool.readOnly ? '; read-only' : ''}]${guidance}`;
  });
  return `\n\nREGISTERED CAPABILITIES FOR THIS SESSION:\n${lines.join('\n')}\nChoose among them dynamically from the objective and observations. No external semantic classifier has preselected a required tool sequence.`;
}

function visibleIntent(value) {
  const text = String(value || '').replace(/\s+/gu,' ').trim();
  if (!text) return '';
  return text.length > 320 ? `${text.slice(0,319).trimEnd()}…` : text;
}

class LiveAgentCore {
  constructor({ registry, provider, ctx = {}, maxToolCalls = 40 } = {}) {
    if (!registry) throw new Error('LiveAgentCore requires a ToolRegistry.');
    if (!provider) throw new Error('LiveAgentCore requires a provider.');
    this.registry = registry;
    this.provider = provider;
    this.ctx = ctx || {};
    this.maxToolCalls = Math.max(1, Number(maxToolCalls) || 40);
    this.conversations = new Map();
    this._ingestedInstructionIds = new Map();
    this._skillHash = new Map();
    this._aborters = new Map();
  }

  messagesFor(sessionId, durableConversation = null) {
    let messages = this.conversations.get(sessionId);
    if (!messages) {
      const durableMessages = Array.isArray(durableConversation?.messages)
        ? compactDurableMessages(durableConversation.messages)
        : [];
      messages = [{ role:'system', content:SYSTEM_PROMPT + capabilityPrompt(this.registry) }, ...durableMessages];
      this.conversations.set(sessionId, messages);
      const ingested = this.ingestedInstructionsFor(sessionId);
      for (const message of durableConversation?.messages || []) {
        if (message?.role === 'user' && message.instructionId) ingested.add(String(message.instructionId));
      }
    }
    return messages;
  }

  ingestedInstructionsFor(sessionId) {
    let ids = this._ingestedInstructionIds.get(sessionId);
    if (!ids) {
      ids = new Set();
      this._ingestedInstructionIds.set(sessionId, ids);
    }
    return ids;
  }

  reset(sessionId) {
    this.conversations.delete(sessionId);
    this._ingestedInstructionIds.delete(sessionId);
    this._skillHash.delete(sessionId);
  }

  stop(sessionId) {
    const aborter = this._aborters.get(sessionId);
    if (aborter && !aborter.signal.aborted) aborter.abort();
  }

  async step(stepContext = {}) {
    const sessionId = String(stepContext.sessionId || 'session');
    const messages = this.messagesFor(sessionId, stepContext.conversation);
    const skillInfo = stepContext.skills || null;
    const skillHash = skillInfo?.hash ? String(skillInfo.hash) : 'none';
    if (this._skillHash.get(sessionId) !== skillHash) {
      const skillText = skillInfo?.text ? `\n\nACTIVE SKILLS (session-aware):\n${skillInfo.text}\n` : '';
      messages[0] = { role:'system', content:SYSTEM_PROMPT + capabilityPrompt(this.registry) + skillText };
      this._skillHash.set(sessionId, skillHash);
    }

    const pending = Array.isArray(stepContext.pendingInstructions) ? stepContext.pendingInstructions : [];
    const ingested = this.ingestedInstructionsFor(sessionId);
    const fresh = pending.filter(item => {
      const id = String(item?.instructionId || '');
      return id && !ingested.has(id);
    });
    const currentInstruction = fresh.map(item => String(item?.text || '').trim()).filter(Boolean).join('\n');
    if (currentInstruction) {
      messages.push({ role:'user', content:currentInstruction });
      for (const item of fresh) ingested.add(String(item.instructionId));
    } else if (!messages.some(message => message.role === 'user') && stepContext.objective) {
      messages.push({ role:'user', content:String(stepContext.objective) });
    }

    const activeObjective = currentInstruction || String(stepContext.objective || '').trim();
    const aborter = new AbortController();
    const parentSignal = stepContext.signal;
    const abortFromParent = () => aborter.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else if (parentSignal && typeof parentSignal.addEventListener === 'function') parentSignal.addEventListener('abort', abortFromParent, { once:true });
    this._aborters.set(sessionId, aborter);

    const emitExecutionEvent = typeof stepContext.emitExecutionEvent === 'function' ? stepContext.emitExecutionEvent : async () => {};
    const emitAgentEvent = typeof stepContext.emitAgentEvent === 'function' ? stepContext.emitAgentEvent : async () => {};
    let toolCalls = 0;
    let lastObservationFingerprint = null;
    let duplicateObservationCount = 0;
    let transientRuntimeNotice = null;
    const runtimeEvidence = [];

    try {
      while (toolCalls < this.maxToolCalls) {
        if (aborter.signal.aborted) {
          return { status:'stopped', reason:'Stopped by user.', summary:'Stopped by user.', evidence:runtimeEvidence, consumeInstructions:false };
        }

        const providerMessages = transientRuntimeNotice
          ? [...messages, { role:'system', content:transientRuntimeNotice }]
          : messages;
        transientRuntimeNotice = null;
        const response = await this.provider.complete({
          messages:providerMessages,
          tools:this.registry.openAiTools(),
          signal:aborter.signal,
        });

        const assistant = { role:'assistant', content:String(response?.content || '') };
        if (Array.isArray(response?.toolCalls) && response.toolCalls.length) {
          assistant.tool_calls = response.toolCalls.map(call => ({
            id:call.id,
            type:'function',
            function:{ name:call.name, arguments:JSON.stringify(call.arguments || {}) },
          }));
        }
        messages.push(assistant);
        if (assistant.tool_calls?.length) {
          await emitAgentEvent('conversation.message', { message:durableAssistantMessage(assistant) });
          await emitAgentEvent('agent.intent', {
            turnId:String(stepContext.turnId || stepContext.stepId || 'turn'),
            detail:visibleIntent(response.content) || `Using ${response.toolCalls.map(call => call.name).join(', ')}.`,
            toolNames:response.toolCalls.map(call => call.name),
          });
        }

        if (!response?.toolCalls?.length) {
          const summary = String(response?.content || '').trim();
          if (!summary) {
            return {
              status:'blocked',
              blocker:'provider_empty_response',
              reason:'Provider returned neither a tool call nor a user-visible result.',
              summary:'BLOCKED: provider returned no actionable output.',
              evidence:runtimeEvidence,
              consumeInstructions:false,
            };
          }
          return {
            status:'completed',
            summary,
            evidence:runtimeEvidence,
            consumeInstructions:true,
          };
        }

        for (const call of response.toolCalls) {
          if (toolCalls >= this.maxToolCalls) break;
          toolCalls += 1;
          const phase = executionPhaseForTool(call.name);
          const execution = baseExecutionEvent(stepContext, call, phase);
          await emitExecutionEvent({ ...execution, type:'execution.phase.changed', status:'running', phase });
          await emitExecutionEvent({ ...execution, type:'execution.tool.started', status:'running', phase });

          let result;
          try {
            result = await this.registry.execute(call.name, call.arguments, {
              ...this.ctx,
              sessionId,
              turnId:stepContext.turnId || stepContext.stepId,
              stepId:stepContext.stepId,
              toolCallId:call.id,
              operationId:stepContext.operationId,
              instructionId:stepContext.instructionId,
            });
          } catch (error) {
            result = {
              ok:false,
              output:{
                ok:false,
                observation:'FAILED',
                error:{ code:String(error?.code || 'TOOL_EXECUTION_FAILED'), message:String(error?.message || error) },
              },
              evidence:{ verified:false },
            };
          }

          const output = result?.output || { ok:false, observation:'EMPTY' };
          const toolMessage = {
            role:'tool',
            tool_call_id:call.id,
            content:durableToolContent(output),
          };
          messages.push(toolMessage);
          await emitAgentEvent('conversation.message', { message:toolMessage });

          const completed = {
            ...execution,
            type:'execution.tool.completed',
            status:'completed',
            phase:result?.ok === true ? phase : 'recovering',
            outputSummary:summarizeToolOutput(output),
            receiptId:output.receipt?.id || output.receiptId || output.receipt?.hash || null,
            error:result?.ok === true ? null : summarizeError(output.error || output),
          };
          const stored = await emitExecutionEvent(completed);
          runtimeEvidence.push(runtimeEvidenceRecord(stored?.data || completed, output, result?.evidence));

          const terminal = result?.output?.terminal === true || result?.output?.error?.terminal === true;
          if (terminal) {
            const terminalCode = String(output?.code || output?.error?.code || 'TERMINAL');
            const terminalDetail = String(output?.error?.message || output?.message || '').trim();
            return {
              status:'blocked',
              blocker:'terminal_tool',
              reason:`Terminal tool "${call.name}" returned ${terminalCode}${terminalDetail ? `: ${terminalDetail}` : ''}. The objective stopped immediately instead of exhausting the tool budget.`,
              summary:'BLOCKED: a terminal tool outcome forced the objective to stop now.',
              evidence:runtimeEvidence,
              consumeInstructions:false,
            };
          }

          const fingerprint = observationFingerprint(call.name, call.arguments, output);
          if (fingerprint === lastObservationFingerprint) {
            duplicateObservationCount += 1;
            const reconciliation = {
              toolName:String(call.name || ''),
              duplicateCount:duplicateObservationCount,
              observationHash:fingerprint,
              status:duplicateObservationCount >= 2 ? 'stagnation' : 'no_state_change',
            };
            await emitAgentEvent('runtime.no_progress', reconciliation);
            if (duplicateObservationCount >= 2) {
              return {
                status:'blocked',
                blocker:'no_progress_stagnation',
                reason:`The same tool observation repeated ${duplicateObservationCount} consecutive times without material state change. Runtime reconciliation stopped the loop before another provider completion.`,
                summary:'BLOCKED: repeated identical observations produced no material progress.',
                evidence:runtimeEvidence,
                consumeInstructions:false,
              };
            }
            transientRuntimeNotice = NO_PROGRESS_NOTICE;
          } else {
            lastObservationFingerprint = fingerprint;
            duplicateObservationCount = 0;
          }

          // Important: failed/non-found/unavailable tool observations are now
          // in conversation as real flow messages. Control returns to the model
          // on the next loop iteration so it can adapt rather than terminate.
        }
      }

      return {
        status:'blocked',
        blocker:'tool_budget',
        reason:`Tool-call budget exhausted (${this.maxToolCalls}) before the agent produced a supported final result.`,
        summary:'BLOCKED: bounded tool-call budget exhausted.',
        evidence:runtimeEvidence,
        consumeInstructions:false,
      };
    } finally {
      this._aborters.delete(sessionId);
      if (parentSignal && typeof parentSignal.removeEventListener === 'function') parentSignal.removeEventListener('abort', abortFromParent);
    }
  }
}

function executionPhaseForTool(name) {
  const value=String(name || '').toLowerCase();
  if (value === 'writefile' || value === 'applypatch' || /(?:edit|replace|create|delete)/u.test(value)) return 'editing';
  if (value === 'runcommand' || /(?:test|check|lint|build|compile|validate)/u.test(value)) return 'validating';
  if (value === 'askuser') return 'waiting_for_user';
  return 'investigating';
}

function durableAssistantMessage(message) {
  return { role:'assistant', content:'', tool_calls:Array.isArray(message.tool_calls) ? message.tool_calls : [] };
}

function toProviderMessage(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.role === 'user') return message.content ? { role:'user', content:String(message.content) } : null;
  if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) return { role:'assistant', content:'', tool_calls:message.tool_calls };
  if (message.role === 'tool' && message.tool_call_id && message.content) return { role:'tool', tool_call_id:String(message.tool_call_id), content:String(message.content) };
  return null;
}

const HISTORICAL_TOOL_RESULT_MAX_CHARS = 500;

function compactHistoricalToolResult(message) {
  if (message?.role !== 'tool') return message;
  const content = String(message.content || '');
  if (content.length <= HISTORICAL_TOOL_RESULT_MAX_CHARS) return message;
  return {
    ...message,
    content:JSON.stringify({
      truncatedHistoricalToolResult:true,
      originalChars:content.length,
      sha256:createHash('sha256').update(content).digest('hex'),
      preview:content.slice(0,350),
    }),
  };
}

function compactDurableMessages(messages) {
  const compacted = [];
  for (const source of messages) {
    const message = toProviderMessage(source);
    if (!message) continue;
    const previous = compacted.at(-1);
    if (message.role === 'user' && previous?.role === 'user' && previous.content === message.content) continue;
    compacted.push(compactHistoricalToolResult(message));
  }
  return compacted;
}

function durableToolContent(output) {
  const serialized = JSON.stringify(compact(output));
  if (serialized.length <= 6000) return serialized;
  return JSON.stringify({ truncated:true, sha256:createHash('sha256').update(serialized).digest('hex'), preview:`${serialized.slice(0,5400)}…` });
}

function stableValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function observationFingerprint(toolName, args, output) {
  const normalized = JSON.stringify({
    toolName:String(toolName || ''),
    args:stableValue(args || {}),
    output:stableValue(compact(output)),
  });
  return createHash('sha256').update(normalized).digest('hex');
}

function baseExecutionEvent(stepContext, toolCall, phase) {
  return {
    sessionId:String(stepContext.sessionId || 'session'),
    turnId:String(stepContext.turnId || stepContext.stepId || 'turn'),
    stepId:String(stepContext.stepId || 'step'),
    toolCallId:String(toolCall.id || 'tool-call'),
    moduleId:moduleIdFor(toolCall.name),
    toolName:String(toolCall.name || ''),
    blockerIds:[],
    phase,
    inputSummary:{ argumentKeys:Object.keys(toolCall.arguments || {}) },
  };
}

function moduleIdFor(name) {
  const value=String(name || '');
  if (value.startsWith('mcp.')) return 'mcp';
  if (value.toLowerCase().startsWith('git')) return 'git';
  return 'agent-tools';
}

function summarizeToolOutput(output) {
  if (!output || typeof output !== 'object') return { type:typeof output };
  return {
    ok:output.ok === true,
    observation:output.observation || null,
    code:output.code || output.error?.code || null,
    keys:Object.keys(output).slice(0,20),
  };
}

function runtimeEvidenceRecord(event, output, evidence = null) {
  return {
    source:'runtime',
    tool:String(event.toolName || ''),
    toolCallId:String(event.toolCallId || ''),
    eventId:event.eventId ? String(event.eventId) : null,
    phase:String(event.phase || ''),
    status:String(event.status || ''),
    timestamp:event.timestamp ? String(event.timestamp) : null,
    outputSummary:compact(event.outputSummary || summarizeToolOutput(output)),
    receiptId:event.receiptId ? String(event.receiptId) : null,
    verified:evidence?.verified === true,
    details:runtimeEvidenceDetails(output),
  };
}

function runtimeEvidenceDetails(output) {
  if (!output || typeof output !== 'object') return {};
  const details={};
  for (const key of ['path','sha256','beforeSha256','receiptId','exitCode','verified','truncated','size','observation','code','timedOut']) {
    const value=output[key];
    if (value === null || value === undefined) continue;
    if (['string','number','boolean'].includes(typeof value)) details[key]=value;
  }
  if (output.receipt && typeof output.receipt === 'object') {
    if (output.receipt.id) details.receiptId=String(output.receipt.id);
    if (output.receipt.hash) details.receiptHash=String(output.receipt.hash);
  }
  return details;
}

function summarizeError(error) {
  if (!error) return null;
  return { code:error.code ? String(error.code) : null, message:String(error.message || error) };
}

// Compatibility exports are intentionally non-semantic. No active runtime
// consumes a keyword-derived capability plan.
function classifyObjective() {
  return { capabilities:[], operations:[], requiresWorkspace:false, requiresUserInput:false, allowedMutations:[], forbiddenActions:[] };
}
function requiredToolEvidence() { return []; }
function evidenceCategoryForTool() { return null; }
function missingEvidence() { return []; }

module.exports = {
  LiveAgentCore,
  SYSTEM_PROMPT,
  compact,
  classifyObjective,
  requiredToolEvidence,
  evidenceCategoryForTool,
  executionPhaseForTool,
  missingEvidence,
  capabilityPrompt,
  runtimeEvidenceRecord,
  observationFingerprint,
};