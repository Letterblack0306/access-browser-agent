'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createExecutionEvent } = require('./ExecutionEventSchema');
const { projectSession, reduceSessionEvent } = require('./AgentSessionState');

const DEFAULT_STATE_DIR = '.gpt-sync';
const SESSION_DIR = 'agent-sessions';

class AgentEventStore {
  constructor({ workspaceRoot, stateRoot, sessionId, stateDir = DEFAULT_STATE_DIR } = {}) {
    if (!workspaceRoot) throw new Error('workspaceRoot is required');
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.stateBase = stateRoot ? path.resolve(stateRoot) : this.workspaceRoot;
    this.sessionId = normalizeSessionId(sessionId);
    this.rootDir = path.join(this.stateBase, stateDir, SESSION_DIR, this.sessionId);
    this.eventsPath = path.join(this.rootDir, 'events.jsonl');
    this.snapshotPath = path.join(this.rootDir, 'snapshot.json');
    this.checkpointsDir = path.join(this.rootDir, 'checkpoints');
    this._writeQueue = Promise.resolve();
    this._queueError = null;
    this._sessionProjection = null;
    this._executionTransitions = new Map();
    this._executionTransitionsLoaded = false;
  }

  async ensure() {
    await fs.mkdir(this.checkpointsDir, { recursive: true });
  }

  async loadEvents() {
    await this.ensure();
    let text = '';
    try {
      text = await fs.readFile(this.eventsPath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
    const events = [];
    const lines = text.split(/\r?\n/u);
    const lastContentLine = findLastContentLine(lines);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event && typeof event === 'object') events.push(event);
      } catch (error) {
        if (index === lastContentLine) {
          await this._recoverTruncatedTrailingEvent(text, events);
          break;
        }
        const parseError = new Error(`Invalid agent event JSON at ${this.eventsPath}:${index + 1}`);
        parseError.code = 'AGENT_EVENT_LOG_CORRUPT';
        throw parseError;
      }
    }
    projectSession(events);
    validateExecutionEventSequence(events);
    return events;
  }

  async _recoverTruncatedTrailingEvent(originalText, validEvents) {
    const backupPath = path.join(this.rootDir, `events.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`);
    const recoveredText = validEvents.length
      ? `${validEvents.map(event => JSON.stringify(event)).join('\n')}\n`
      : '';
    await fs.writeFile(backupPath, originalText, 'utf8');
    await atomicWriteText(this.eventsPath, recoveredText);
  }

  append(type, data = {}, metadata = {}) {
    if (!type || typeof type !== 'string') return Promise.reject(new Error('event type is required'));
    if (this._queueError) return Promise.reject(this._queueError);
    const event = Object.freeze({
      eventId: String(metadata.eventId || randomUUID()),
      sessionId: this.sessionId,
      type: String(type),
      createdAt: String(metadata.createdAt || new Date().toISOString()),
      data: cloneJson(data),
    });
    const write = async () => {
      await this.ensure();
      if (this._sessionProjection === null) {
        const existing = await this.loadEvents();
        this._sessionProjection = existing.length ? projectSession(existing) : null;
      }
      const nextEvent = { ...event, data: cloneJson(data) };
      const nextProjection = reduceSessionEvent(this._sessionProjection, nextEvent);
      await fs.appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
      this._sessionProjection = nextProjection;
      return event;
    };
    // FIX: Error propagation. The previous implementation reassigned
    // _writeQueue to a .catch() that returned undefined, which caused
    // subsequent writes to be chained onto a fulfilled promise — so a
    // failed write was silently absorbed and the next write appeared OK
    // even though its event was never persisted. Now:
    //   1. The current caller receives the rejected pending promise and
    //      observes the error.
    //   2. The write queue head becomes a rejected promise so any later
    //      enqueue (which chains via .then(write, write)) sees the error.
    //      The safeWrite wrapper detects that case and rejects immediately,
    //      preventing a corrupted event from being written after a failure.
    //   3. Debug logging is preserved.
    const safeWrite = async (arg) => {
      if (arg instanceof Error) throw arg;
      return write();
    };
    const pending = this._writeQueue.then(safeWrite, safeWrite);
    this._writeQueue = pending.catch(error => {
      console.error('AgentEventStore append write failed:', error);
      this._queueError ||= error;
    });
    return pending;
  }

  appendExecution(input = {}) {
    let execution;
    try { execution = createExecutionEvent(input); }
    catch (error) { return Promise.reject(error); }
    return this._ensureExecutionTransitions().then(() => {
      const key = `${execution.sessionId}:${execution.toolCallId}`;
      const previous = this._executionTransitions.get(key) || null;
      validateExecutionTransition(previous, execution);
      this._executionTransitions.set(key, execution);
      return this.append(execution.type, execution, { eventId: execution.eventId, createdAt: execution.timestamp })
        .catch(error => {
          if (this._executionTransitions.get(key) === execution) {
            if (previous) this._executionTransitions.set(key, previous);
            else this._executionTransitions.delete(key);
          }
          throw error;
        });
    });
  }

  async _ensureExecutionTransitions() {
    if (this._executionTransitionsLoaded) return;
    const events = await this.loadEvents();
    for (const event of events) {
      if (!String(event?.type || '').startsWith('execution.')) continue;
      const execution = event.data && typeof event.data === 'object' ? event.data : event;
      const key = `${execution.sessionId}:${execution.toolCallId}`;
      const previous = this._executionTransitions.get(key) || null;
      validateExecutionTransition(previous, execution);
      this._executionTransitions.set(key, execution);
    }
    this._executionTransitionsLoaded = true;
  }

  async loadExecutionEvents() {
    const events = await this.loadEvents();
    return events.map(event => event && event.type && event.type.startsWith('execution.') ? event.data : null).filter(Boolean);
  }

  writeSnapshot(snapshot) {
    if (this._queueError) return Promise.reject(this._queueError);
    const write = async () => {
      await this.ensure();
      await atomicWriteJson(this.snapshotPath, snapshot);
      return snapshot;
    };
    const pending = this._writeQueue.then(write, write);
    this._writeQueue = pending.catch(error => {
      console.error('AgentEventStore snapshot write failed:', error);
      this._queueError ||= error;
    });
    return pending;
  }

  async readSnapshot() {
    await this.ensure();
    try {
      const text = await fs.readFile(this.snapshotPath, 'utf8');
      return JSON.parse(text);
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  checkpoint(snapshot, metadata = {}) {
    if (this._queueError) return Promise.reject(this._queueError);
    const checkpointId = String(metadata.checkpointId || `checkpoint-${Date.now()}-${randomUUID().slice(0, 8)}`);
    const checkpointPath = path.join(this.checkpointsDir, `${sanitizeFileName(checkpointId)}.json`);
    const checkpoint = { checkpointId, sessionId: this.sessionId, createdAt: String(metadata.createdAt || new Date().toISOString()), snapshot: cloneJson(snapshot) };
    const write = async () => {
      await this.ensure();
      await atomicWriteJson(checkpointPath, checkpoint);
      await atomicWriteJson(this.snapshotPath, checkpoint.snapshot);
      return checkpoint;
    };
    const pending = this._writeQueue.then(write, write);
    this._writeQueue = pending.catch(error => {
      console.error('AgentEventStore checkpoint write failed:', error);
      this._queueError ||= error;
    });
    return pending;
  }

  async listCheckpoints() {
    await this.ensure();
    const names = await fs.readdir(this.checkpointsDir);
    return names.filter(name => name.endsWith('.json')).sort();
  }

  async flush() {
    await this._writeQueue;
    if (this._queueError) throw this._queueError;
  }
}

function findLastContentLine(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (String(lines[index] || '').trim()) return index;
  }
  return -1;
}

async function atomicWriteJson(filePath, value) {
  const text = `${JSON.stringify(cloneJson(value), null, 2)}\n`;
  await atomicWriteText(filePath, text);
}

async function atomicWriteText(filePath, text) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, String(text || ''), 'utf8');
  await fs.rename(tempPath, filePath);
}

function normalizeSessionId(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('sessionId is required');
  if (!/^[a-zA-Z0-9._-]+$/u.test(text)) throw new Error('sessionId contains unsupported characters');
  return text;
}

function sanitizeFileName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'checkpoint';
}

function cloneJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function validateExecutionTransition(previous, event) {
  const type = String(event.type || '');
  if (type === 'execution.phase.changed') return true;
  if (!previous) {
    if (type !== 'execution.tool.started') throw new Error(`Execution event ${type} arrived before execution.tool.started for ${event.toolCallId}.`);
    return true;
  }
  const previousType = String(previous.type || '');
  if (previousType === 'execution.tool.completed' || previousType === 'execution.tool.failed') {
    throw new Error(`Execution event ${type} is not allowed after terminal tool state for ${event.toolCallId}.`);
  }
  if (type === 'execution.tool.approval_requested' && previousType !== 'execution.tool.started') {
    throw new Error(`Execution approval request is out of order for ${event.toolCallId}.`);
  }
  if (type === 'execution.tool.approval_decided' && previousType !== 'execution.tool.approval_requested') {
    throw new Error(`Execution approval decision is out of order for ${event.toolCallId}.`);
  }
  if ((type === 'execution.tool.completed' || type === 'execution.tool.failed') && ![
    'execution.tool.started', 'execution.tool.approval_decided',
  ].includes(previousType)) {
    throw new Error(`Execution terminal event ${type} is out of order for ${event.toolCallId}.`);
  }
  return true;
}

function validateExecutionEventSequence(events) {
  const transitions = new Map();
  for (const event of events || []) {
    if (!String(event?.type || '').startsWith('execution.')) continue;
    const execution = event.data && typeof event.data === 'object' ? event.data : event;
    const key = `${execution.sessionId}:${execution.toolCallId}`;
    const previous = transitions.get(key) || null;
    validateExecutionTransition(previous, execution);
    transitions.set(key, execution);
  }
}

module.exports = AgentEventStore;
module.exports.DEFAULT_STATE_DIR = DEFAULT_STATE_DIR;
module.exports.SESSION_DIR = SESSION_DIR;
module.exports.findLastContentLine = findLastContentLine;
module.exports.validateExecutionTransition = validateExecutionTransition;
