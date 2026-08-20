'use strict';

// Minimal DOM stub sufficient to exercise renderToolCall's string-building
// logic and failToolCall's shape without pulling in a full DOM implementation.
// agent-workflow-view.js runs as an IIFE but guards its browser-only bootstrap
// (typeof window/document checks), so requiring it from Node only defines the
// closure functions and populates module.exports with the pure render helpers.
class FakeElement {
  constructor() { this.className = ''; this.dataset = {}; this._innerHTML = ''; }
  set innerHTML(v) { this._innerHTML = v; }
  get innerHTML() { return this._innerHTML; }
}
global.document = { createElement: () => new FakeElement() };

const assert = require('node:assert/strict');
const {
  humanToolLabel, looksLikeDiff, renderDiffLines, renderToolCall, failToolCall,
} = require('../electron/agent-workflow-view.js');

// --- humanToolLabel ---
assert.equal(
  humanToolLabel({ name: 'str_replace', input: { path: 'src/router.js' } }),
  'Editing file \u2014 src/router.js',
);
assert.equal(humanToolLabel({ name: 'some_custom_tool', input: {} }), 'some_custom_tool');

// --- looksLikeDiff ---
assert.equal(looksLikeDiff('--- a/x\n+++ b/x\n+added\n-removed'), true);
assert.equal(looksLikeDiff('just some plain output text'), false);

// --- renderDiffLines colors +/- lines ---
const diffHtml = renderDiffLines('+added line\n-removed line\n unchanged');
assert.match(diffHtml, /text-green">\+added line/);
assert.match(diffHtml, /text-red">-removed line/);
assert.doesNotMatch(diffHtml, /text-(green|red)">\s*unchanged/);

// --- renderToolCall: collapsed by default on success ---
const okTool = { id: 't1', name: 'view', status: 'completed', input: { path: 'a.js' }, output: 'file contents here' };
const okDiv = renderToolCall(okTool);
assert.doesNotMatch(okDiv.innerHTML, /tool-call-details open/, 'successful tool call must not auto-expand');
assert.match(okDiv.innerHTML, /Reading file \u2014 a\.js/, 'must use human label, not raw tool name');

// --- renderToolCall: auto-expands on error ---
const errTool = { id: 't2', name: 'bash_tool', status: 'error', error: 'exit code 1' };
const errDiv = renderToolCall(errTool);
assert.match(errDiv.innerHTML, /tool-call-details open/, 'errored tool call must auto-expand');
assert.match(errDiv.innerHTML, /text-red/, 'error must be styled');

// --- renderToolCall: diff-shaped output renders as colored diff, not raw JSON dump ---
const diffTool = { id: 't3', name: 'str_replace', status: 'completed', output: '--- a/x\n+++ b/x\n+new\n-old' };
const diffDiv = renderToolCall(diffTool);
assert.match(diffDiv.innerHTML, /class="diff-text"/);
assert.match(diffDiv.innerHTML, /text-green">\+new/);

// --- failToolCall exists (this was the ReferenceError bug). updateToolCall
// lives in the closure and is DOM-backed, so it is not invoked here. ---
assert.equal(typeof failToolCall, 'function', 'failToolCall must be defined (this was the ReferenceError bug)');

console.log('agent-workflow-view patch tests PASS');
