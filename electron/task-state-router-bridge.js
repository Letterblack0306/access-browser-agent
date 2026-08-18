'use strict';

function isBrowserInstruction(input) {
  return Boolean(
    input && typeof input === 'object'
    && input.source === 'browser-provider'
    && (input.inbound === 'instruction' || typeof input.instruction === 'string')
  );
}

class TaskStateRouterBridge {
  constructor({ getAgentRuntime, getRuntimeActive } = {}) {
    if (typeof getAgentRuntime !== 'function') {
      throw new Error('TaskStateRouterBridge requires getAgentRuntime.');
    }
    this._getAgentRuntime = getAgentRuntime;
    this._getRuntimeActive = typeof getRuntimeActive === 'function' ? getRuntimeActive : () => true;
  }

  _assertExecutionAllowed() {
    if (this._getRuntimeActive() !== true) {
      const error = new Error('Runtime is stopped. Start the runtime before browser-initiated execution.');
      error.code = 'RUNTIME_INACTIVE';
      error.classification = 'USER_SETUP';
      throw error;
    }
  }

  async submitInstruction(input) {
    this._assertExecutionAllowed();
    const runtime = this._getAgentRuntime();
    if (!runtime || typeof runtime.run !== 'function') {
      const error = new Error('Reasoning runtime is unavailable.');
      error.code = 'AGENT_RUNTIME_UNAVAILABLE';
      error.classification = 'AGENT';
      throw error;
    }

    if (typeof input === 'string') {
      const instruction = input.trim();
      if (!instruction) {
        const error = new Error('Instruction is required.');
        error.code = 'INSTRUCTION_REQUIRED';
        error.classification = 'USER_SETUP';
        throw error;
      }
      return runtime.run({ instruction, objective: instruction, source: 'bridge' });
    }

    if (!input || typeof input !== 'object') {
      const error = new Error('Structured instruction input is required.');
      error.code = 'INSTRUCTION_REQUIRED';
      error.classification = 'USER_SETUP';
      throw error;
    }

    // This bridge transports already-validated work into the reasoning runtime.
    // It does not classify prose, infer task lifecycle, decide whether work is
    // actionable, or convert conversational text into semantic states.
    return runtime.run(input);
  }

  registerIpc() {
    // Intentionally empty. The rebuild has no task-state semantic-control IPC.
  }

  onWorkspaceChanged() {
    // No semantic router state exists to reset.
  }
}

module.exports = { TaskStateRouterBridge, isBrowserInstruction };
