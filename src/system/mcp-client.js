'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * McpClient is a minimal Model Context Protocol (MCP) stdio client. It spawns a
 * configured MCP server command, performs the JSON-RPC initialize handshake,
 * lists the server's tools, tracks a real connected/disconnected lifecycle and
 * routes tool executions through `tools/call`. It emits `tools` (fresh tool
 * list) and `disconnected` events so live capability can follow availability.
 */
class McpClient extends EventEmitter {
  constructor({ serverCommand, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super();
    this.serverCommand = String(serverCommand || '').trim();
    this.timeoutMs = Math.max(500, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    this.child = null;
    this._pending = new Map();
    this._buffer = '';
    this._requestId = 0;
    this._started = false;
    this.connected = false;
    this.error = null;
    this.tools = [];
  }

  status() {
    return {
      enabled: Boolean(this.serverCommand),
      connected: this.connected,
      status: this.serverCommand ? (this.connected ? 'connected' : 'disconnected') : 'disabled',
      tools: this.tools.map(tool => tool && tool.name),
      error: this.error,
    };
  }

  async start() {
    if (this._started) return this.status();
    if (!this.serverCommand) {
      this.error = 'No MCP server command configured.';
      return this.status();
    }
    this._started = true;
    this.connected = false;
    this.error = null;
    this.tools = [];

    this.child = spawn(this.serverCommand, { shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', chunk => this._onData(String(chunk)));
    this.child.stderr.on('data', chunk => { this.error = String(chunk).slice(-2000); });
    this.child.on('exit', code => { this.connected = false; this.emit('disconnected', { code }); });
    this.child.on('error', err => { this.error = err.message; this.connected = false; this.emit('disconnected', { error: err.message }); });

    try {
      await this._request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'access-agent', version: '0.1.0' },
      });
      this._notify('notifications/initialized', {});
      const result = await this._request('tools/list', {});
      this.tools = Array.isArray(result && result.tools) ? result.tools : [];
      this.connected = true;
      this.error = null;
      this.emit('tools', this.tools.map(normalizeTool));
    } catch (err) {
      this.error = err.message || String(err);
      this.connected = false;
      this.emit('disconnected', { error: this.error });
    }
    return this.status();
  }

  async callTool(name, args = {}) {
    if (!this.connected) throw new Error('MCP server is not connected.');
    const result = await this._request('tools/call', { name: String(name || ''), arguments: args || {} });
    const content = Array.isArray(result && result.content) ? result.content : [];
    const text = content.map(item => {
      if (item && typeof item.text === 'string') return item.text;
      if (item && typeof item === 'object') return JSON.stringify(item);
      return '';
    }).filter(Boolean).join('\n');
    const isError = Boolean(result && result.isError);
    return { ok: !isError, output: { ok: !isError, name, text, data: text }, isError };
  }

  async stop() {
    this._started = false;
    this.connected = false;
    for (const pending of this._pending.values()) clearTimeout(pending.timer);
    this._pending.clear();
    const child = this.child;
    this.child = null;
    if (child) {
      try { child.kill(); } catch {}
    }
    this.emit('disconnected', { reason: 'stopped' });
    return this.status();
  }

  _onData(chunk) {
    this._buffer += chunk;
    let index;
    while ((index = this._buffer.indexOf('\n')) >= 0) {
      const line = this._buffer.slice(0, index).trim();
      this._buffer = this._buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message && message.id && this._pending.has(message.id)) {
        const pending = this._pending.get(message.id);
        clearTimeout(pending.timer);
        this._pending.delete(message.id);
        if (message.error) pending.reject(new Error(String(message.error.message || 'MCP server error.')));
        else pending.resolve(message.result);
      }
    }
  }

  _notify(method, params) { this._send({ jsonrpc: '2.0', method, params }); }

  _send(payload) {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) throw new Error('MCP server is not running.');
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  _request(method, params) {
    const id = (this._requestId += 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, this.timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      try {
        this._send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(error);
      }
    });
  }
}

function normalizeTool(tool) {
  const name = String(tool && tool.name || '').trim();
  if (!name) return null;
  return { name, description: String(tool && tool.description || ''), inputSchema: (tool && tool.inputSchema) || { type: 'object', properties: {} } };
}

module.exports = { McpClient };
