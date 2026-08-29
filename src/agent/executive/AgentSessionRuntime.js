'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const AgentExecutive = require('./AgentExecutive');

const SESSION_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

class AgentSessionRuntime {
  constructor({
    workspaceRoot,
    stateRoot,
    stepRunnerFactory,
    onEvent,
    onState,
    maxRetries,
    retryDelayMs,
  } = {}) {
    if (!workspaceRoot) throw new Error('workspaceRoot is required');
    if (typeof stepRunnerFactory !== 'function') throw new Error('stepRunnerFactory is required');
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.stateBase = stateRoot ? path.resolve(stateRoot) : this.workspaceRoot;
    this.stepRunnerFactory = stepRunnerFactory;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.onState = typeof onState === 'function' ? onState : () => {};
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
    this.sessions = new Map();
    this.currentPath = path.join(this.stateBase, '.gpt-sync', 'agent-sessions', 'current.json');
  }

  async createSession(input = {}) {
    const sessionId = String(input.sessionId || `agent-${Date.now()}-${randomUUID().slice(0, 8)}`);
    const executive = this._createExecutive(sessionId);
    await executive.initialize({
      objective: input.objective || '',
      providerSelection: input.providerSelection || null,
      skills: input.skills || null,
    });
    this.sessions.set(sessionId, executive);
    await this._writeCurrentSessionId(sessionId);
    return executive;
  }

  async getSession(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) throw new Error('sessionId is required');
    if (this.sessions.has(id)) return this.sessions.get(id);
    const executive = this._createExecutive(id);
    await executive.initialize();
    this.sessions.set(id, executive);
    return executive;
  }

  async getCurrentSession() {
    const sessionId = await this._readCurrentSessionId();
    if (!sessionId) return null;
    return this.getSession(sessionId);
  }

  async resetForFreshRuntime({ clearCurrentSession = false } = {}) {
    this.sessions.clear();
    if (clearCurrentSession !== true) {
      return { ok: true, clearedCurrentSession: false };
    }
    try {
      await fs.unlink(this.currentPath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    return { ok: true, clearedCurrentSession: true };
  }

  async submitInstruction(input = {}) {
    let executive = null;
    if (input.sessionId && input.newSession !== true) {
      executive = await this.getSession(input.sessionId);
    } else if (input.newSession !== true) {
      executive = await this.getCurrentSession();
    }
    if (
      !executive ||
      ['stopped', 'cancelled'].includes(executive.getState()?.status)
    ) {
      executive = await this.createSession({
        objective: input.objective || '',
        providerSelection: input.providerSelection || null,
        skills: input.skills || null,
      });
    }
    await this._writeCurrentSessionId(executive.sessionId);
    return executive.submitInstruction(input);
  }

  async approve(sessionId, approvalId, decision, reason) {
    const executive = await this.getSession(sessionId);
    return executive.approve(approvalId, decision, reason);
  }

  async stop(sessionId, reason) {
    const executive = await this.getSession(sessionId);
    return executive.stop(reason);
  }

  async resume(sessionId) {
    const executive = await this.getSession(sessionId);
    await this._writeCurrentSessionId(sessionId);
    return executive.resume();
  }

  async reconcileRecovery(sessionId, options = {}) {
    const executive = await this.getSession(sessionId);
    return executive.reconcileRecovery(options);
  }

  async cancel(sessionId, reason) {
    const executive = await this.getSession(sessionId);
    return executive.cancel(reason);
  }

  async timeout(sessionId, reason) {
    const executive = await this.getSession(sessionId);
    return executive.forceTimeout(reason);
  }

  async status(sessionId) {
    const executive = sessionId ? await this.getSession(sessionId) : await this.getCurrentSession();
    return executive ? executive.getState() : null;
  }

  _createExecutive(sessionId) {
    const stepRunner = this.stepRunnerFactory({ sessionId, workspaceRoot: this.workspaceRoot });
    return new AgentExecutive({
      workspaceRoot: this.workspaceRoot,
      stateRoot: this.stateBase,
      sessionId,
      stepRunner,
      onEvent: this.onEvent,
      onState: this.onState,
      maxRetries: this.maxRetries,
      retryDelayMs: this.retryDelayMs,
    });
  }

  async _readCurrentSessionId() {
    let value;
    try {
      value = JSON.parse(await fs.readFile(this.currentPath, 'utf8'));
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) {
        await this._quarantineInvalidCurrentSession();
        return null;
      }
      throw error;
    }
    const sessionId = String(value?.sessionId || '').trim();
    if (!sessionId) return null;
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      await this._quarantineInvalidCurrentSession();
      return null;
    }
    return sessionId;
  }

  async _quarantineInvalidCurrentSession() {
    const backupPath = `${this.currentPath}.invalid-${Date.now()}-${randomUUID().slice(0, 8)}.bak`;
    try {
      await fs.rename(this.currentPath, backupPath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }

  async _writeCurrentSessionId(sessionId) {
    const normalized = String(sessionId || '').trim();
    if (!SESSION_ID_PATTERN.test(normalized)) throw new Error('sessionId contains unsupported characters');
    await fs.mkdir(path.dirname(this.currentPath), { recursive: true });
    const tempPath = `${this.currentPath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify({ sessionId: normalized, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, this.currentPath);
  }
}

module.exports = AgentSessionRuntime;
module.exports.SESSION_ID_PATTERN = SESSION_ID_PATTERN;
