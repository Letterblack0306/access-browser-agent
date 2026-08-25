'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const AgentEventStore = require('./AgentEventStore');
const { projectSession, isTerminalStatus } = require('./AgentSessionState');

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

class AgentExecutive {
  constructor({ workspaceRoot, stateRoot, sessionId, stepRunner, eventStore, onEvent, onState, maxRetries = DEFAULT_MAX_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS } = {}) {
    if (!workspaceRoot) throw new Error('workspaceRoot is required');
    if (!sessionId) throw new Error('sessionId is required');
    if (typeof stepRunner !== 'function') throw new Error('stepRunner is required');
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.sessionId = String(sessionId);
    this.stepRunner = stepRunner;
    this.store = eventStore || new AgentEventStore({ workspaceRoot: this.workspaceRoot, stateRoot, sessionId: this.sessionId });
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.onState = typeof onState === 'function' ? onState : () => {};
    this.maxRetries = Math.max(0, Number(maxRetries) || 0);
    this.retryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
    this.events = [];
    this.state = null;
    this.skillSeed = null;
    this._initialized = false;
    this._runPromise = null;
    this._attemptController = null;
    this._stopRequested = false;
    this._cancelRequested = false;
  }

  getEvents() { return cloneJson(this.events); }

  async initialize({ objective = '', providerSelection = null, skills = null } = {}) {
    // FIX #P2: Single-flight initialization guard. If two (or more)
    // submissions/initializations race, both previously observed
    // _initialized === false before either completed, producing duplicate
    // session.created events. Now a shared promise serializes them so only
    // the first call performs the load+create and the rest await its result.
    if (this._initialized) return this.getState();
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInitialize({ objective, providerSelection, skills });
    try {
      return await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  async _doInitialize({ objective = '', providerSelection = null, skills = null } = {}) {
    if (this._initialized) return this.getState();
    this.events = await this.store.loadEvents();
    if (!this.events.length) {
      await this._append('session.created', { workspaceRoot: this.workspaceRoot, objective: String(objective || '').trim(), providerSelection });
    } else {
      this.state = projectSession(this.events);
      this._emitState();
      await this._ensureRecoveryBoundary();
    }
    this.inputSkills = skills || null;
    await this._updateSkillSeed(this.inputSkills);
    this._initialized = true;
    return this.getState();
  }

  async submitInstruction(input = {}) {
    await this.initialize({ objective: input.objective || '' });
    this._assertRecoveryReconciled();
    this._assertNotCancelled();
    const text = String(input.text || input.message || input.instruction || '').trim();
    if (!text) throw new Error('instruction text is required');
    const instructionId = String(input.instructionId || `instruction-${randomUUID()}`);
    const event = await this._append('user.message', { instructionId, text, source: String(input.source || 'unknown'), metadata: input.metadata || {} });
    if (!this.state.objective) await this._append('objective.revised', { objective: text, reason: 'first_instruction' });
    else if (this.state.completion) await this._append('objective.revised', { objective: text, reason: 'next_instruction' });
    await this._updateSkillSeed(input.skills);
    const runPromise = this.state.status === 'stopped' ? null : this.run();
    return { ok: true, sessionId: this.sessionId, instructionId, eventId: event.eventId, status: this.state.status, pending: true, runPromise };
  }

  run() {
    if (this._runPromise) return this._runPromise;
    this._runPromise = this._runLoop().finally(() => { this._runPromise = null; });
    return this._runPromise;
  }

  async stop(reason = 'Stopped by user.') {
    await this.initialize();
    if (isTerminalStatus(this.state.status) || this.state.status === 'stopped') return this.getState();
    if (this._stopRequested) return this.getState();
    this._stopRequested = true;
    await this._append('session.stop_requested', { reason });
    this._abortCurrentAttempt(reason);
    if (this._runPromise) await this._runPromise.catch(() => {});
    else { await this._append('session.stopped', { reason }); await this._checkpoint('stopped'); }
    return this.getState();
  }

  async resume() {
    await this.initialize();
    this._assertRecoveryReconciled();
    this._assertNotCancelled();
    if (this.state.status !== 'stopped') return this.run();
    this._stopRequested = false;
    await this._append('session.resumed', {});
    return this.run();
  }

  async cancel(reason = 'Cancelled by user.') {
    await this.initialize();
    if (this.state.status === 'cancelled') return this.getState();
    if (this._cancelRequested) return this.getState();
    this._cancelRequested = true;
    await this._append('session.cancel_requested', { reason });
    this._abortCurrentAttempt(reason);
    if (this._runPromise) await this._runPromise.catch(() => {});
    if (this.state.status !== 'cancelled') { await this._append('session.cancelled', { reason }); await this._checkpoint('cancelled'); }
    return this.getState();
  }

  async reviseObjective(objective, reason = 'user_revision') {
    await this.initialize();
    this._assertRecoveryReconciled();
    this._assertNotCancelled();
    const value = String(objective || '').trim();
    if (!value) throw new Error('objective is required');
    await this._append('objective.revised', { objective: value, reason });
    return this.getState();
  }

  getState() { return this.state ? cloneJson(this.state) : null; }

  async reconcileRecovery({ disposition = 'abandoned', reason = '' } = {}) {
    await this.initialize();
    if (!this.state.recoveryRequired) return this.getState();
    const value = String(disposition || '').trim();
    if (!['abandoned', 'verified_completed', 'retry_approved'].includes(value)) {
      const error = new Error('Recovery disposition must be abandoned, verified_completed, or retry_approved.');
      error.code = 'AGENT_RECOVERY_DISPOSITION_INVALID';
      throw error;
    }
    await this._append('session.recovery_reconciled', {
      stepId: this.state.recovery?.stepId || null,
      disposition: value,
      reason: String(reason || '').trim(),
    });
    return this.getState();
  }

  async approve(approvalId, decision, reason = '') {
    await this.initialize();
    this._assertNotCancelled();
    if (!this.state.waiting || this.state.waiting.kind !== 'approval') throw new Error('No action is awaiting approval.');
    if (approvalId && approvalId !== this.state.waiting.approvalId) throw new Error('Approval ID does not match the pending action.');
    const action = this.state.waiting.action;
    await this._append('approval.decided', { approvalId: this.state.waiting.approvalId, decision, reason });
    return { approvalId: this.state.waiting.approvalId, decision, action };
  }

  async _runLoop() {
    await this.initialize();
    this._assertNotCancelled();
    this._assertRecoveryReconciled();
    if (this.state.status === 'stopped' || this.state.status === 'cancelled') return this.getState();
    await this._append('session.running', {});

    while (true) {
      if (this._cancelRequested) { await this._append('session.cancelled', { reason: 'Cancelled during execution.' }); await this._checkpoint('cancelled'); break; }
      if (this._stopRequested) { await this._append('session.stopped', { reason: 'Stopped at an execution boundary.' }); await this._checkpoint('stopped'); break; }
      if (isTerminalStatus(this.state.status)) break;

      const stepId = `step-${randomUUID()}`;
      const stepContext = this._buildStepContext(stepId);
      const consumedInstructionIds = stepContext.pendingInstructions.map(item => item.instructionId);
      let attempt = 0;
      let result = null;

      while (attempt <= this.maxRetries) {
        if (this._stopRequested || this._cancelRequested) break;
        this._attemptController = new AbortController();
        const turnId = `turn-${randomUUID()}`;
        await this._append('step.started', { stepId, turnId, action: { kind: 'reason_and_act', attempt } });
        try {
          result = await this.stepRunner({ ...stepContext, turnId, attempt, signal: this._attemptController.signal, emitExecutionEvent: event => this._appendExecutionEvent(event), emitAgentEvent: (phase, data) => this._append(phase, data) });
          await this._append('step.observed', { stepId, observation: result?.observation ?? result ?? null });
          await this._append('step.completed', { stepId, attempt });
          break;
        } catch (error) {
          const aborted = this._attemptController.signal.aborted;
          const timedOut = isRunTimeoutError(error);
          const retryable = isRetryableError(error);
          await this._append('step.failed', { stepId, attempt, aborted, timedOut, retryable, error: serializeError(error) });
          if (aborted || timedOut || !retryable || attempt >= this.maxRetries) { result = { status: timedOut ? 'timed_out' : aborted ? 'interrupted' : 'waiting_for_dependency', reason: error?.message || String(error), retryable }; break; }
          attempt += 1;
          await this._append('step.retrying', { stepId, attempt, error: serializeError(error) });
          await delay(this.retryDelayMs);
        } finally { this._attemptController = null; }
      }

      if (this._cancelRequested || this._stopRequested) continue;
      const decision = normalizeStepResult(result);
      if (decision.decision) await this._append('decision.recorded', { decisionId: `decision-${randomUUID()}`, kind: decision.decision, reason: decision.reason, instructionIds: consumedInstructionIds });
      if (decision.consumeInstructions && consumedInstructionIds.length) await this._append('instruction.processed', { instructionIds: consumedInstructionIds });
      await this._checkpoint('step_boundary');

      if (decision.status === 'completed') {
        await this._append('objective.completed', { summary: decision.summary, evidence: decision.evidence });
        await this._checkpoint('objective_completed');
        break;
      }
      if (decision.status === 'waiting_for_input') { await this._append('input.waiting', { reason: decision.reason }); break; }
      if (decision.status === 'waiting_for_user') { await this._append('user.waiting', { question: decision.question || decision.summary || decision.reason, reason: decision.reason || 'Awaiting user input before continuing.' }); break; }
      if (decision.status === 'approval') { await this._append('approval.pending', { approvalId: decision.approvalId, action: decision.action, reason: decision.reason }); break; }
      if (decision.status === 'waiting_for_dependency') { await this._append('dependency.waiting', { dependency: decision.dependency, reason: decision.reason, retryAt: decision.retryAt }); break; }
      if (decision.status === 'stopped') { await this._append('session.stopped', { reason: decision.reason || 'Agent chose to stop.' }); await this._checkpoint('stopped'); break; }
      // FIX #P1d: Cline-style result states (failed, blocked, timed_out) must
      // terminate the run loop with the correct terminal status instead of
      // falling through to waiting_for_input.
      if (decision.status === 'failed') { await this._append('objective.failed', { summary: decision.summary, evidence: decision.evidence, reason: decision.reason || 'Agent step failed.' }); await this._checkpoint('failed'); break; }
      if (decision.status === 'blocked') { await this._append('objective.blocked', { summary: decision.summary, evidence: decision.evidence, dependency: decision.dependency || 'unresolved', reason: decision.reason || 'Agent is blocked.', retryAt: decision.retryAt }); await this._checkpoint('blocked'); break; }
      if (decision.status === 'timed_out') { await this._append('objective.timed_out', { summary: decision.summary, evidence: decision.evidence, reason: decision.reason || 'Agent step timed out.' }); await this._checkpoint('timed_out'); break; }
      if (this.state.pendingInstructions.length === 0 && decision.continue !== true) { await this._append('input.waiting', { reason: decision.reason || 'No unresolved instruction remains.' }); break; }
    }
    return this.getState();
  }

  _buildStepContext(stepId) {
    const activePlanNodeId = this.state?.activePlanNodeId || this.state?.currentPlanStepId || null;
    return { sessionId: this.sessionId, stepId, planNodeId: activePlanNodeId, workspaceRoot: this.workspaceRoot, objective: this.state.objective, status: this.state.status, pendingInstructions: cloneJson(this.state.pendingInstructions), conversation: cloneJson(this.state.conversation || { messages: [] }), recentDecisions: cloneJson(this.state.decisions.slice(-20)), recentObservations: cloneJson(this.state.observations.slice(-20)), checkpointId: this.state.checkpointId, providerSelection: cloneJson(this.state.providerSelection), skills: this.skillSeed || null };
  }

  async _append(type, data) { const event = await this.store.append(type, data); this.events.push(event); this.state = projectSession([event], this.state); this.onEvent(cloneJson(event)); this._emitState(); return event; }
  async _appendExecutionEvent(event) { const stored = await this.store.appendExecution(event); this.events.push(stored); this.onEvent(cloneJson(stored)); return stored; }
  async _checkpoint(reason) { const checkpoint = await this.store.checkpoint(this.state, { checkpointId: `checkpoint-${Date.now()}-${randomUUID().slice(0, 8)}` }); await this._append('checkpoint.created', { checkpointId: checkpoint.checkpointId, reason }); await this.store.writeSnapshot(this.state); return checkpoint; }

  async _updateSkillSeed(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const incoming = String(snapshot.hash || '');
    const current = this.skillSeed ? String(this.skillSeed.hash || '') : '';
    if (incoming && incoming !== current) { this.skillSeed = snapshot; await this._append('skills.activated', { skillIds: Array.isArray(snapshot.ids) ? snapshot.ids : [], hashes: snapshot.hashes || {}, hash: incoming, resolvedAt: new Date().toISOString() }); }
  }

  async _ensureRecoveryBoundary() {
    if (this.state?.recoveryRequired) return;
    const started = new Set();
    const terminal = new Set();
    const reconciled = new Set();
    for (const event of this.events) {
      const stepId = String(event?.data?.stepId || '').trim();
      if (!stepId) continue;
      if (event.type === 'step.started') started.add(stepId);
      if (event.type === 'step.completed' || event.type === 'step.failed') terminal.add(stepId);
      if (event.type === 'session.recovery_reconciled') reconciled.add(stepId);
    }
    const ambiguousStepId = [...started].find(stepId => !terminal.has(stepId) && !reconciled.has(stepId));
    if (!ambiguousStepId) return;
    await this._append('session.recovery_required', {
      stepId: ambiguousStepId,
      reason: 'A process restart left an execution step without a durable terminal outcome. No new work may run until an operator reconciles it.',
    });
  }

  _abortCurrentAttempt(reason) { if (this._attemptController && !this._attemptController.signal.aborted) this._attemptController.abort(new Error(reason)); }
  _assertNotCancelled() { if (this.state?.status === 'cancelled' || this._cancelRequested) throw new Error('agent session is cancelled'); }
  _assertRecoveryReconciled() {
    if (!this.state?.recoveryRequired) return;
    const error = new Error(`Agent recovery is required for step ${this.state.recovery?.stepId || 'unknown'} before new work can run.`);
    error.code = 'AGENT_RECOVERY_REQUIRED';
    error.classification = 'RECOVERY';
    error.recovery = cloneJson(this.state.recovery);
    throw error;
  }
  _emitState() { this.onState(this.getState()); }
}

function normalizeStepResult(value) {
  const result = value && typeof value === 'object' ? value : {};
  return { status: String(result.status || 'continue'), continue: result.continue === true, consumeInstructions: result.consumeInstructions !== false, decision: result.decision ? String(result.decision) : '', reason: result.reason ? String(result.reason) : '', dependency: result.dependency ? String(result.dependency) : '', retryAt: result.retryAt || null, summary: result.summary ? String(result.summary) : '', evidence: Array.isArray(result.evidence) ? result.evidence : [], question: result.question ? String(result.question) : '', approvalId: result.approvalId ? String(result.approvalId) : '', action: result.action || null };
}
function isRetryableError(error) { return Boolean(error && (error.retryable === true || error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'EPIPE')); }
function isRunTimeoutError(error) { return error?.code === 'AGENT_RUN_TIMEOUT'; }
function serializeError(error) { if (!error) return null; return { name: String(error.name || 'Error'), message: String(error.message || error), code: error.code ? String(error.code) : null, httpStatus: Number.isInteger(error.httpStatus) ? error.httpStatus : null, retryable: error.retryable === true }; }
function delay(ms) { if (!ms) return Promise.resolve(); return new Promise(resolve => setTimeout(resolve, ms)); }
function cloneJson(value) { if (value === undefined) return null; return JSON.parse(JSON.stringify(value)); }

module.exports = AgentExecutive;
module.exports.DEFAULT_MAX_RETRIES = DEFAULT_MAX_RETRIES;
module.exports.DEFAULT_RETRY_DELAY_MS = DEFAULT_RETRY_DELAY_MS;
