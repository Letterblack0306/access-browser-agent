'use strict';

const { TaskStateController } = require('./TaskStateController');

/**
 * TaskStateRouter
 *
 * Wraps TaskStateController with typed event routing.
 * Returns a RouterEvent from handle() — no EventEmitter dependency.
 *
 * BrowserChatProvider
 *         ↓
 * TaskStateRouter.handle(replyText)
 *         ↓
 *  ┌────────────┬────────────┬────────────┐
 * idle/update  decision    AgentLoop
 */

const LEVEL_COMPLETE_CHECK_IN =
  'DONE. Are there further levels or tasks remaining, or is the overall goal complete?';

class TaskStateRouter {
  constructor(workspace) {
    this._controller = new TaskStateController(workspace);
  }

  get controller() { return this._controller; }

  /**
   * Call with raw browser reply text.
   * Returns a RouterEvent — one of:
   *   { type: 'idle_update', snapshot }
   *   { type: 'actionable', intent, snapshot }
   *   { type: 'decision', prompt, snapshot }
   *   { type: 'blocked', description, snapshot }
   *   { type: 'level_complete', checkInMessage, snapshot }
   *   { type: 'task_complete', snapshot }
   *   { type: 'unknown', raw, snapshot }
   */
  handle(reply) {
    const classification = this._controller.process(reply);
    const snapshot = this._controller.getUISnapshot();
    return this._toEvent(classification, reply, snapshot);
  }

  _toEvent(c, raw, snapshot) {
    switch (c.kind) {
      case 'blocked':
        return { type: 'blocked', description: c.blockerDescription || raw.slice(0, 200), snapshot };

      case 'needs_decision':
        return { type: 'decision', prompt: c.decisionPrompt || raw.slice(0, 200), snapshot };

      case 'task_complete':
        return { type: 'task_complete', snapshot };

      case 'level_complete':
        return { type: 'level_complete', checkInMessage: LEVEL_COMPLETE_CHECK_IN, snapshot, intent: c.intent || null };

      case 'actionable':
        return { type: 'actionable', intent: c.intent || raw, snapshot };

      case 'conversational':
        return { type: 'idle_update', snapshot };

      case 'unknown':
      default:
        return { type: 'unknown', raw, snapshot };
    }
  }
}

module.exports = { TaskStateRouter };
