'use strict';

const { execSync } = require('node:child_process');
const { BROWSER_TOOL_UNAVAILABLE } = require('./TaskMode');
const { getCdpPort } = require('../core/port-config');

/**
 * TaskSessionController handles physical browser process lifetimes, CDP port discovery,
 * and clean task session allocations.
 */
class TaskSessionController {
  constructor(options = {}) {
    const configuredDefaultPort = getCdpPort();
    const normalizedOptions =
      options && typeof options === 'object'
        ? options
        : { port: options };

    this.defaultPort = normalizePort(
      normalizedOptions.port,
      configuredDefaultPort,
    );
    this.mode = normalizedOptions.mode || 'standard';
    this.cdp = normalizedOptions.cdp || null;
    this.relayServer = normalizedOptions.relayServer || null;
    this.onLog = normalizedOptions.onLog || (() => {});
    this.recoveryStepTimeoutMs =
      normalizedOptions.recoveryStepTimeoutMs || 2500;
  }

  /**
   * Scans local network sockets to verify if a CDP endpoint is already active on the designated port.
   */
  isPortActive(port = this.defaultPort) {
    // Validate port is a safe numeric integer before shell interpolation
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return false;
    }
    try {
      const cmd = process.platform === 'win32'
        ? `netstat -ano | findstr :${portNum}`
        : `lsof -i :${portNum}`;
      const output = execSync(cmd, { encoding: 'utf8', timeout: 3000 });
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Ensures that a usable CDP browser is present on the specified port.
   * If the port is not active, it can notify the user or initiate a managed instance launch.
   */
  async ensureSession(port = this.defaultPort) {
    const resolvedPort = normalizePort(port, this.defaultPort);
    const isActive = this.isPortActive(resolvedPort);

    if (isActive) {
      return {
        ok: true,
        port: resolvedPort,
        message: `Existing browser session detected and bound on CDP port: ${resolvedPort}`
      };
    }

    return {
      ok: false,
      errorCode: 'BROWSER_TOOL_UNAVAILABLE',
      error: `No responsive browser detected on CDP port ${resolvedPort}. Please run Chrome with "--remote-debugging-port=${resolvedPort}" to allow secure agent attachments.`
    };
  }

  /* --- Backward Compatibility Layer for LetterblackAgent --- */

  start(goal) {
    this.goal = String(goal || '');
    return this.mode;
  }

  isBrowserOnly() {
    return this.mode === 'browser_only';
  }

  checkTool(toolName) {
    return { ok: true };
  }

  filterTools(tools) {
    if (!Array.isArray(tools)) return [];
    const TaskMode = require('./TaskMode');
    const tm = new TaskMode(this.mode);
    return tools.filter(t => tm.isToolPermitted(t.name));
  }

  shouldReturnBrowserUnavailable(observation) {
    if (!observation) return false;

    const code = String(observation.code || '').toUpperCase();
    const errorCode = String(observation.errorCode || '').toUpperCase();
    const message = String(observation.error || observation.message || '').toLowerCase();

    const isTimeout = code === 'BRIDGE_TIMEOUT' || errorCode === 'BROWSER_TOOL_UNAVAILABLE';
    const hasKeywords =
      message.includes('bridge timeout') ||
      message.includes('browser unavailable') ||
      message.includes('relay unavailable') ||
      message.includes('cdp unavailable');

    return isTimeout || hasKeywords;
  }

  async recoverBrowserTransport(ctx = {}, cdpPort = this.defaultPort) {
    const bridge = ctx.bridge || this.cdp || ctx.cdp || null;
    const relayServer = ctx.relayServer || this.relayServer || null;
    const port = normalizePort(cdpPort, this.defaultPort);
    const timeoutMs = this.recoveryStepTimeoutMs || 2500;

    this.onLog?.('[TaskSessionController] Initiating browser connection recovery sequence...', 'info');

    if (bridge && typeof bridge.connect === 'function') {
      try {
        this.onLog?.(`[TaskSessionController] Step 1: Connecting bridge to port ${port}...`, 'info');
        const res = await withTimeout(
          bridge.connect(port),
          timeoutMs,
          `bridge.connect(${port}) timed out`
        );

        if (res && res.ok) {
          this.onLog?.('[TaskSessionController] Bridge connected successfully.', 'info');
          return true;
        }
      } catch (err) {
        this.onLog?.(`[TaskSessionController] Bridge connection step failed: ${err.message}`, 'warn');
      }
    }

    if (bridge && typeof bridge.focusProviderTab === 'function') {
      try {
        this.onLog?.('[TaskSessionController] Step 2: Focusing provider tab...', 'info');
        await withTimeout(
          bridge.focusProviderTab(),
          timeoutMs,
          'bridge.focusProviderTab() timed out'
        );
      } catch (err) {
        this.onLog?.(`[TaskSessionController] Focus provider tab step failed: ${err.message}`, 'warn');
      }
    }

    if (relayServer && typeof relayServer.rotateToken === 'function') {
      try {
        this.onLog?.('[TaskSessionController] Step 3: Verifying relay token status...', 'info');

        if (!relayServer.sessionToken) {
          relayServer.rotateToken();
        }
      } catch (err) {
        this.onLog?.(`[TaskSessionController] Relay status verification failed: ${err.message}`, 'warn');
      }
    }

    return !!(bridge && bridge.connected);
  }

  handleBridgeTimeout() {
    const isBrowser = this.isBrowserOnly();

    return {
      terminal: isBrowser,
      state: { mode: this.mode, reason: 'bridge-timeout' },
      message: '[Agent] Bridge unavailable — waiting for GPT browser reconnection.',
      observation: {
        ok: false,
        code: isBrowser ? BROWSER_TOOL_UNAVAILABLE : 'BRIDGE_TIMEOUT',
        error: 'Bridge timed out. Retry the browser/session tool or adapt your approach.',
      },
      returnValue: BROWSER_TOOL_UNAVAILABLE
    };
  }

  systemPromptBlock() {
    if (this.mode === 'browser_only') {
      return 'TASK MODE: browser_only (STRICT BOUNDARY — you are strictly restricted to browser execution tools. You MUST use browser.navigate, browser.snapshot, browser.act, or browser.accessibility to interact with the environment. Direct shell command execution and file writes are completely forbidden.)';
    }
    return `TASK MODE: ${this.mode} (guidance — all tools remain available)`;
  }
}

function normalizePort(value, fallback) {
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port <= 65535) return port;

  const fallbackPort = Number(fallback);
  if (Number.isInteger(fallbackPort) && fallbackPort > 0 && fallbackPort <= 65535) {
    return fallbackPort;
  }

  return getCdpPort();
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;

  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

module.exports = TaskSessionController;
