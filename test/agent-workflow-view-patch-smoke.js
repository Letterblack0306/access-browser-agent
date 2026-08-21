'use strict';

class FakeElement {
  constructor() { this.className = ''; this.dataset = {}; this._innerHTML = ''; }
  set innerHTML(v) { this._innerHTML = v; }
  get innerHTML() { return this._innerHTML; }
}
global.document = { createElement: () => new FakeElement() };

const assert = require('node:assert/strict');
const {
  humanToolLabel, looksLikeDiff, renderDiffLines, renderToolCall, failToolCall,
  terminalStatePresentation, eventDispatchKey,
} = require('../electron/agent-workflow-view.js');

assert.equal(
  humanToolLabel({ name: 'str_replace', input: { path: 'src/router.js' } }),
  'Editing file \u2014 src/router.js',
);
assert.equal(humanToolLabel({ name: 'some_custom_tool', input: {} }), 'some_custom_tool');

assert.equal(looksLikeDiff('--- a/x\n+++ b/x\n+added\n-removed'), true);
assert.equal(looksLikeDiff('just some plain output text'), false);

const diffHtml = renderDiffLines('+added line\n-removed line\n unchanged');
assert.match(diffHtml, /text-green">\+added line/);
assert.match(diffHtml, /text-red">-removed line/);
assert.doesNotMatch(diffHtml, /text-(green|red)">\s*unchanged/);

const okTool = { id: 't1', name: 'view', status: 'completed', input: { path: 'a.js' }, output: 'file contents here' };
const okDiv = renderToolCall(okTool);
assert.doesNotMatch(okDiv.innerHTML, /tool-call-details open/, 'successful tool call must not auto-expand');
assert.match(okDiv.innerHTML, /Reading file \u2014 a\.js/, 'must use human label, not raw tool name');

const errTool = { id: 't2', name: 'bash_tool', status: 'error', error: 'exit code 1' };
const errDiv = renderToolCall(errTool);
assert.match(errDiv.innerHTML, /tool-call-details open/, 'errored tool call must auto-expand');
assert.match(errDiv.innerHTML, /text-red/, 'error must be styled');

const diffTool = { id: 't3', name: 'str_replace', status: 'completed', output: '--- a/x\n+++ b/x\n+new\n-old' };
const diffDiv = renderToolCall(diffTool);
assert.match(diffDiv.innerHTML, /class="diff-text"/);
assert.match(diffDiv.innerHTML, /text-green">\+new/);

assert.equal(typeof failToolCall, 'function', 'failToolCall must be defined');

assert.deepEqual(terminalStatePresentation('blocked', '', 'task'), ['error', 'Task blocked']);
assert.deepEqual(
  terminalStatePresentation('failed', 'Task blocked: governance stopped execution.', 'task'),
  ['error', 'Task blocked: governance stopped execution.'],
);
assert.deepEqual(terminalStatePresentation('failed', '', 'plan'), ['error', 'Plan failed']);
assert.deepEqual(terminalStatePresentation('completed', '', 'plan'), ['completed', 'Plan complete']);
assert.deepEqual(terminalStatePresentation('stopped', '', 'task'), ['idle', 'Stopped']);

// Runtime execution events carry a lifecycle phase such as "running" while
// their semantic event name lives in type. The renderer must dispatch by type
// first or execution.tool.started/completed/failed are silently ignored.
assert.equal(
  eventDispatchKey({ type: 'execution.tool.started', phase: 'running' }),
  'execution.tool.started',
  'semantic event type must outrank generic lifecycle phase',
);
assert.equal(
  eventDispatchKey({ type: 'agent.intent', phase: 'running' }),
  'agent.intent',
);
assert.equal(
  eventDispatchKey({ phase: 'plan.completed' }),
  'plan.completed',
  'phase remains fallback for legacy phase-only events',
);

console.log('agent-workflow-view patch tests PASS');
