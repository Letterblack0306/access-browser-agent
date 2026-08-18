'use strict';

const { randomUUID } = require('node:crypto');

const MAX_STRING_CHARS = 12000;
const MAX_ARRAY_ITEMS = 40;
const MAX_OBJECT_KEYS = 80;
const MAX_DEPTH = 8;

const ACTION_KINDS = Object.freeze({
  FILE_READ: 'file.read',
  FILE_PATCH: 'file.patch',
  FILE_WRITE: 'file.write',
  FILE_DELETE: 'file.delete',
  COMMAND_EXECUTE: 'command.execute',
  DIRECTORY_ENSURE: 'directory.ensure',
  FILE_LIST: 'file.list',
  WORKSPACE_INSPECT: 'workspace.inspect',
  GIT_STATUS: 'git.status',
  USER_QUESTION: 'user.question',
  RUNTIME_INSPECT: 'runtime.inspect',
});

const APPROVAL_DECISIONS = Object.freeze({
  APPROVED: 'approved',
  DENIED: 'denied',
  PENDING: 'pending',
});

function createActionRequest({ kind, payload = {}, threadId = null, turnId = null } = {}) {
  if (!Object.values(ACTION_KINDS).includes(kind)) throw new Error(`Unsupported action kind: ${kind}`);
  return {
    recordType: 'action_request',
    actionId: randomUUID(),
    kind,
    payload: clone(payload),
    threadId,
    turnId,
    createdAt: new Date().toISOString(),
  };
}

function createActionResult(action, { ok, status, output = null, error = null, evidence = {} } = {}) {
  if (!action || !action.actionId) throw new Error('Action request is required');
  return {
    recordType: 'action_result',
    actionId: action.actionId,
    kind: action.kind,
    threadId: action.threadId || null,
    turnId: action.turnId || null,
    ok: ok === true,
    status: status || (ok ? 'completed' : 'failed'),
    output: clone(output),
    error: error ? String(error) : null,
    evidence: clone(evidence),
    completedAt: new Date().toISOString(),
  };
}

function createApprovalRequest({ action, reason, command = null, cwd = null, decision = APPROVAL_DECISIONS.PENDING } = {}) {
  if (!action || !action.actionId) throw new Error('Action request is required');
  return {
    recordType: 'approval',
    approvalId: randomUUID(),
    actionId: action.actionId,
    threadId: action.threadId || null,
    turnId: action.turnId || null,
    decision,
    reason: String(reason || 'Approval required'),
    command,
    cwd,
    createdAt: new Date().toISOString(),
  };
}

function clone(value) {
  if (value === undefined) return null;
  return compact(value, 0);
}

function compact(value, depth) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS)}… (truncated)` : value;
  }
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map(item => compact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).slice(0, MAX_OBJECT_KEYS).map(([key, item]) => [key, compact(item, depth + 1)])
  );
}

module.exports = {
  ACTION_KINDS,
  APPROVAL_DECISIONS,
  createActionRequest,
  createActionResult,
  createApprovalRequest,
};
