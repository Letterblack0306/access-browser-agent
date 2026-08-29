'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWorkbenchLayout } = require('../src/system/workbench-layout');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const main = read('electron/main.js');
const preload = read('electron/preload.js');
const html = read('electron/index.html');
const renderer = read('electron/rebuild-renderer.js');
const shell = read('electron/rebuild-shell.js');
const layout = parseWorkbenchLayout(read('electron/workbench.layout.json'));

for (const required of ['contextIsolation: true', 'nodeIntegration: false', "'ide:status'", "'ide:runtime-start'", "'ide:browser-relay-start'", "'ide:agent-status'"]) {
  assert.match(main, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), `Electron main is missing: ${required}`);
}
assert.match(main, /ipcMain\.handle\('ide:get-models',\s*\(\)\s*=>\s*agentRuntime\.discoverModels\(\)\)/u, 'model discovery must remain available while runtime execution is stopped');
assert.match(main, /ipcMain\.handle\('ide:agent-start',\s*\(_event, input = \{\}\)\s*=> \{ assertRuntimeActive\(\);/u, 'agent execution must remain runtime-gated');
for (const required of ["'ide:status'", "'ide:runtime-start'", "'ide:browser-open-exact-chat'", "'ide:browser-relay-start'", "'ide:agent-execution-trace'", "'ide:terminal-create'"]) {
  assert.match(preload, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), `Preload route is missing: ${required}`);
}

for (const forbidden of ['sendBirdEye', 'birdEyeStatus', 'ide:birdeye', 'BirdEye', 'WorkspaceHandoffService']) {
  assert.doesNotMatch(`${main}\n${preload}\n${html}\n${renderer}`, new RegExp(forbidden, 'i'), `External UI surface remains: ${forbidden}`);
}

for (const required of ['rebuild-runtime-state.js', 'rebuild-shell.js', 'rebuild-renderer.js', 'rebuild-settings.js', 'rebuild-ide-reference.css']) {
  assert.match(html, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
}
for (const required of ['access-agent.rebuild-layout.v1', 'showCenter', 'showBottom', 'bindResizer', 'updateViewMeta']) {
  assert.match(shell, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
}
assert.ok(!shell.includes('showRight(view)'), 'right-rail view navigation must be removed');
for (const required of ['RebuildRuntimeState', 'render', 'refreshStatus', 'startExactLoop', 'onAgentEvent']) {
  assert.match(renderer, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
}

const retained = new Set(['explorer', 'task', 'execution', 'editor', 'browser-loop', 'runtime', 'settings', 'terminal', 'events', 'problems']);
assert.ok(layout.modules.every(module => retained.has(module.id)), 'layout contains an external module');
assert.ok(layout.modules.some(module => module.id === 'browser-loop' && module.content === 'browser'));
assert.ok(layout.modules.some(module => module.id === 'task' && module.content === 'agent'));
assert.ok(layout.modules.some(module => module.id === 'runtime' && module.content === 'liveAgent'));

console.log('Electron rebuild shell smoke PASS');
