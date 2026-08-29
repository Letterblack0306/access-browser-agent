'use strict';

const ACTIVE_STATUSES = new Set([
  'running',
  'retrying',
  'waiting_for_input',
  'waiting_for_user',
  'waiting_for_dependency',
]);

const TERMINAL_STATUSES = new Set(['stopped', 'cancelled', 'completed', 'failed', 'blocked', 'timed_out']);

// FIX #P1: Transitional statuses that are neither actively executing nor
// terminal. They represent valid intermediate states that require an external
// trigger (user action, reconciliation, or resume) to progress.
const TRANSITIONAL_STATUSES = new Set(['idle', 'recovery_required']);

function createInitialState({ sessionId, workspaceRoot, objective = '', providerSelection = null, createdAt = new Date().toISOString() } = {}) {
  if (!sessionId) throw new Error('sessionId is required');
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return {
    version: 1,
    sessionId: String(sessionId),
    workspaceRoot: String(workspaceRoot),
    status: 'idle',
    objective: String(objective || '').trim(),
    objectiveRevision: objective ? 1 : 0,
    providerSelection,
    activeStepId: null,
    activeAction: null,
    pendingInstructions: [],
    processedInstructionIds: [],
    conversation: { messages: [] },
    decisions: [],
    observations: [],
    retry: { attempt: 0, lastError: null },
    waiting: null,
    recoveryRequired: false,
    recovery: null,
    checkpointId: null,
    stopRequested: false,
    cancelRequested: false,
    completion: null,
    createdAt,
    updatedAt: createdAt,
    lastEventId: null,
  };
}

function projectSession(events, seed = null) {
  let state = seed ? cloneJson(seed) : null;
  for (const event of events || []) state = reduceSessionEvent(state, event);
  return state;
}

function reduceSessionEvent(previous, event) {
  if (!event || typeof event !== 'object') return previous;
  const data = event.data || {};
  const now = event.createdAt || new Date().toISOString();
  let state = previous ? cloneJson(previous) : null;

  if (event.type === 'session.created') {
    state = createInitialState({
      sessionId: event.sessionId,
      workspaceRoot: data.workspaceRoot,
      objective: data.objective,
      providerSelection: data.providerSelection || null,
      createdAt: now,
    });
  }
  if (!state) throw new Error(`Agent session event ${event.type} arrived before session.created`);

  switch (event.type) {
    case 'session.created': break;
    case 'objective.revised':
      state.objective = String(data.objective || '').trim();
      state.objectiveRevision += 1;
      state.completion = null;
      break;
    case 'session.running':
      state.status = 'running';
      state.waiting = null;
      state.stopRequested = false;
      state.cancelRequested = false;
      break;
    case 'session.recovery_required':
      state.status = 'recovery_required';
      state.recoveryRequired = true;
      state.recovery = {
        stepId: String(data.stepId || ''),
        reason: String(data.reason || 'Execution stopped before its side effect outcome was durably recorded.'),
        detectedAt: now,
      };
      state.waiting = { kind: 'recovery', reason: state.recovery.reason };
      break;
    case 'session.recovery_reconciled':
      state.status = 'idle';
      state.recoveryRequired = false;
      state.recovery = {
        ...(state.recovery || {}),
        disposition: String(data.disposition || 'abandoned'),
        reason: String(data.reason || ''),
        reconciledAt: now,
      };
      state.waiting = null;
      break;
    case 'user.message': {
      const instructionId = String(data.instructionId || event.eventId);
      if (!state.pendingInstructions.some(item => item.instructionId === instructionId) && !state.processedInstructionIds.includes(instructionId)) {
        state.pendingInstructions.push({ instructionId, text: String(data.text || '').trim(), source: String(data.source || 'unknown'), receivedAt: now, metadata: cloneJson(data.metadata || {}) });
      }
      appendConversationMessage(state, {
        role: 'user',
        instructionId,
        content: String(data.text || '').trim(),
      });
      break;
    }
    case 'conversation.message':
      appendConversationMessage(state, data.message);
      break;
    case 'instruction.processed': {
      const instructionIds = normalizeStringArray(data.instructionIds);
      state.pendingInstructions = state.pendingInstructions.filter(item => !instructionIds.includes(item.instructionId));
      if (instructionIds.length) state.processedInstructionIds = unique(state.processedInstructionIds.concat(instructionIds));
      break;
    }
    case 'step.started':
      state.status = 'running';
      state.activeStepId = String(data.stepId || '');
      state.activeAction = cloneJson(data.action || null);
      break;
    case 'decision.recorded':
      state.decisions = state.decisions.concat([{ decisionId: String(data.decisionId || event.eventId), kind: String(data.kind || ''), reason: String(data.reason || ''), instructionIds: normalizeStringArray(data.instructionIds), recordedAt: now }]).slice(-50);
      break;
    case 'step.observed':
      state.observations = state.observations.concat([{ stepId: String(data.stepId || ''), observation: cloneJson(data.observation), observedAt: now }]).slice(-100);
      break;
    case 'step.completed':
      state.activeStepId = null;
      state.activeAction = null;
      state.retry.attempt = 0;
      state.retry.lastError = null;
      break;
    case 'step.failed':
      state.activeStepId = null;
      state.activeAction = null;
      state.retry.lastError = cloneJson(data.error || null);
      break;
    case 'step.retrying':
      state.status = 'retrying';
      state.retry.attempt = Number(data.attempt || 0);
      state.retry.lastError = cloneJson(data.error || null);
      break;
    case 'dependency.waiting':
      state.status = 'waiting_for_dependency';
      state.waiting = { kind: 'dependency', dependency: String(data.dependency || ''), reason: String(data.reason || ''), retryAt: data.retryAt || null };
      break;
    case 'input.waiting':
      state.status = 'waiting_for_input';
      state.waiting = { kind: 'input', reason: String(data.reason || '') };
      break;
    case 'user.waiting':
      state.status = 'waiting_for_user';
      state.activeStepId = null;
      state.activeAction = null;
      state.waiting = { kind: 'user', question: String(data.question || ''), reason: String(data.reason || '') };
      break;
    case 'approval.pending':
      state.status = 'waiting_for_input';
      state.waiting = { kind: 'approval', approvalId: String(data.approvalId || ''), action: cloneJson(data.action || null), reason: String(data.reason || '') };
      break;
    case 'approval.decided':
      state.waiting = null;
      state.status = 'running';
      break;
    case 'session.stop_requested': state.stopRequested = true; break;
    case 'session.stopped':
      state.status = 'stopped';
      state.stopRequested = false;
      state.cancelRequested = false;
      state.activeStepId = null;
      state.activeAction = null;
      break;
    case 'session.resumed':
      state.status = 'idle';
      state.stopRequested = false;
      state.waiting = null;
      break;
    case 'session.cancel_requested': state.cancelRequested = true; break;
    case 'session.cancelled':
      state.status = 'cancelled';
      state.cancelRequested = false;
      state.stopRequested = false;
      state.activeStepId = null;
      state.activeAction = null;
      state.completion = { outcome: 'cancelled', reason: String(data.reason || ''), completedAt: now };
      break;
    case 'objective.completed':
      state.status = 'completed';
      state.activeStepId = null;
      state.activeAction = null;
      state.completion = { outcome: 'objective_completed', summary: String(data.summary || ''), evidence: cloneJson(data.evidence || []), completedAt: now };
      break;
    case 'objective.failed':
      state.status = 'failed';
      state.activeStepId = null;
      state.activeAction = null;
      state.completion = { outcome: 'failed', summary: String(data.summary || ''), evidence: cloneJson(data.evidence || []), reason: String(data.reason || ''), completedAt: now };
      break;
    case 'objective.blocked':
      state.status = 'blocked';
      state.activeStepId = null;
      state.activeAction = null;
      state.waiting = { kind: 'dependency', dependency: String(data.dependency || ''), reason: String(data.reason || ''), retryAt: data.retryAt || null };
      state.completion = { outcome: 'blocked', summary: String(data.summary || ''), evidence: cloneJson(data.evidence || []), reason: String(data.reason || ''), completedAt: now };
      break;
    case 'objective.timed_out':
      state.status = 'timed_out';
      state.activeStepId = null;
      state.activeAction = null;
      state.completion = { outcome: 'timed_out', summary: String(data.summary || ''), evidence: cloneJson(data.evidence || []), reason: String(data.reason || ''), completedAt: now };
      break;
    case 'checkpoint.created': state.checkpointId = String(data.checkpointId || ''); break;
    case 'provider.selected': state.providerSelection = cloneJson(data.providerSelection || null); break;
    default: break;
  }

  state.updatedAt = now;
  state.lastEventId = event.eventId || state.lastEventId;
  return state;
}

function isActiveStatus(status) { return ACTIVE_STATUSES.has(String(status || '')); }
function isTerminalStatus(status) { return TERMINAL_STATUSES.has(String(status || '')); }
function isTransitionalStatus(status) { return TRANSITIONAL_STATUSES.has(String(status || '')); }
function normalizeStringArray(value) { return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : []; }
function unique(values) { return [...new Set(values)]; }
function appendConversationMessage(state, message) {
  const normalized = normalizeConversationMessage(message);
  if (!normalized) return;
  const conversation = state.conversation && Array.isArray(state.conversation.messages)
    ? state.conversation
    : { messages: [] };
  const previous = conversation.messages.at(-1);
  if (normalized.role === 'user' && previous?.role === 'user' && previous.content === normalized.content) return;
  conversation.messages = conversation.messages.concat([normalized]).slice(-200);
  state.conversation = conversation;
}
function normalizeConversationMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const role = String(message.role || '').trim();
  if (!['user', 'assistant', 'tool'].includes(role)) return null;
  const normalized = { role };
  if (role === 'user') {
    normalized.instructionId = String(message.instructionId || '').trim();
    normalized.content = String(message.content || '').trim();
    return normalized.content ? normalized : null;
  }
  if (role === 'assistant') {
    const toolCalls = Array.isArray(message.tool_calls) ? cloneJson(message.tool_calls) : [];
    if (!toolCalls.length) return null;
    normalized.content = '';
    normalized.tool_calls = toolCalls;
    return normalized;
  }
  normalized.tool_call_id = String(message.tool_call_id || '').trim();
  normalized.content = String(message.content || '').trim();
  return normalized.tool_call_id && normalized.content ? normalized : null;
}
function cloneJson(value) { if (value === undefined) return null; return JSON.parse(JSON.stringify(value)); }

module.exports = { ACTIVE_STATUSES, TERMINAL_STATUSES, TRANSITIONAL_STATUSES, createInitialState, projectSession, reduceSessionEvent, isActiveStatus, isTerminalStatus, isTransitionalStatus };
