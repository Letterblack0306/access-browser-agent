'use strict';

const { randomUUID } = require('node:crypto');

const EXECUTION_STATUSES = Object.freeze([
  'pending',
  'running',
  'waiting_for_approval',
  'blocked',
  'failed',
  'completed',
  'cancelled',
]);

const EXECUTION_EVENT_TYPES = Object.freeze([
  'execution.phase.changed',
  'execution.tool.started',
  'execution.tool.approval_requested',
  'execution.tool.approval_decided',
  'execution.tool.completed',
  'execution.tool.failed',
]);

function createExecutionEvent(input = {}) {
  const event = {
    eventId: String(input.eventId || randomUUID()),
    sessionId: required(input.sessionId, 'sessionId'),
    turnId: required(input.turnId, 'turnId'),
    stepId: required(input.stepId, 'stepId'),
    toolCallId: required(input.toolCallId, 'toolCallId'),
    moduleId: required(input.moduleId, 'moduleId'),
    toolName: input.toolName ? String(input.toolName) : null,
    type: required(input.type, 'type'),
    status: required(input.status, 'status'),
    blockerIds: stringArray(input.blockerIds),
    timestamp: String(input.timestamp || new Date().toISOString()),
    inputSummary: input.inputSummary && typeof input.inputSummary === 'object' ? clone(input.inputSummary) : null,
    outputSummary: input.outputSummary && typeof input.outputSummary === 'object' ? clone(input.outputSummary) : null,
    diagnosticId: input.diagnosticId ? String(input.diagnosticId) : null,
    receiptId: input.receiptId ? String(input.receiptId) : null,
    approvalId: input.approvalId ? String(input.approvalId) : null,
    planNodeId: input.planNodeId ? String(input.planNodeId) : null,
    gitCommitSha: input.gitCommitSha ? String(input.gitCommitSha) : null,
    browserResultSha: input.browserResultSha ? String(input.browserResultSha) : null,
    error: input.error ? clone(input.error) : null,
  };
  return validateExecutionEvent(event);
}

function validateExecutionEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('Execution event must be an object.');
  for (const field of ['eventId', 'sessionId', 'turnId', 'stepId', 'toolCallId', 'moduleId', 'type', 'status', 'timestamp']) {
    if (!String(event[field] || '').trim()) throw new Error(`Execution event ${field} is required.`);
  }
  if (!EXECUTION_EVENT_TYPES.includes(event.type)) throw new Error(`Unsupported execution event type: ${event.type}`);
  if (!EXECUTION_STATUSES.includes(event.status)) throw new Error(`Unsupported execution event status: ${event.status}`);
  if (!Array.isArray(event.blockerIds) || event.blockerIds.some(item => !String(item || '').trim())) throw new Error('Execution event blockerIds must be a string array.');
  return Object.freeze(clone(event));
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function required(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`Execution event ${name} is required.`);
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { EXECUTION_STATUSES, EXECUTION_EVENT_TYPES, createExecutionEvent, validateExecutionEvent };
