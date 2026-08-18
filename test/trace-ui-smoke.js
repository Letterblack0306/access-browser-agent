'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWorkbenchLayout } = require('../src/system/workbench-layout');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'electron', 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'electron', 'styles.css'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const layout = parseWorkbenchLayout(fs.readFileSync(path.join(root, 'electron', 'workbench.layout.json'), 'utf8'));

const trace = layout.modules.find(module => module.id === 'logs');
assert.ok(trace && trace.content === 'trace' && trace.placement === 'right' && trace.visible === true);
for (const marker of [
  'trace: () =>', 'traceStatusFilter', 'traceToolFilter', 'traceModuleFilter', 'traceTurnFilter',
  'function refreshTrace', 'function renderTrace', 'traceEvents.splice', 'traceEvents.filter',
  'execution.tool.approval_requested', 'execution.tool.failed', 'blockerIds', 'receiptId', 'textContent'
]) assert.ok(renderer.includes(marker), `renderer trace marker missing: ${marker}`);
for (const marker of ['.module-trace', '.trace-filters', '.trace-list']) assert.ok(styles.includes(marker), `trace style missing: ${marker}`);
assert.match(preload, /agentExecutionTrace:\s*sessionId\s*=>\s*ipcRenderer\.invoke\('ide:agent-execution-trace'/);
assert.match(main, /ipcMain\.handle\('ide:agent-execution-trace'/);
console.log('trace-ui-smoke: PASS');
