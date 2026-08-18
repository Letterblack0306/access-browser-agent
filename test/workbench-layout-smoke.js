'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWorkbenchLayout } = require('../src/system/workbench-layout');

const layout = parseWorkbenchLayout(fs.readFileSync(path.join(__dirname, '..', 'electron', 'workbench.layout.json'), 'utf8'));

assert.equal(layout.version, 2);
assert.deepEqual(layout.modules.map(module => module.id), [
  'explorer', 'task', 'execution', 'editor', 'browser-loop', 'runtime', 'settings', 'terminal', 'events', 'problems'
]);
assert.equal(layout.modules.find(module => module.id === 'explorer').placement, 'left');
assert.equal(layout.modules.find(module => module.id === 'task').placement, 'right');
assert.equal(layout.modules.find(module => module.id === 'browser-loop').placement, 'right-agent');
assert.equal(layout.modules.filter(module => module.placement === 'bottom' && module.visible).length, 1);
assert.equal(layout.modules.find(module => module.id === 'terminal').content, 'terminal');
assert.equal(layout.modules.find(module => module.id === 'events').visible, false);
assert.equal(layout.modules.find(module => module.id === 'problems').visible, false);

assert.throws(
  () => parseWorkbenchLayout('{"version":2,"modules":[{"id":"editor","content":"editor","placement":"right","order":1,"visible":true,"title":"Editor","icon":"ED"}]}'),
  /requires visible left/u
);
assert.throws(
  () => parseWorkbenchLayout('{"version":2,"modules":[{"id":"explorer","content":"explorer","placement":"left","order":1,"visible":true,"title":"Explorer","icon":"EX"},{"id":"editor","content":"editor","placement":"right","order":1,"visible":true,"title":"Editor","icon":"ED"},{"id":"terminal","content":"terminal","placement":"bottom","order":3,"visible":true,"title":"Terminal","icon":">_"}]}'),
  /order must be unique/u
);

console.log('Workbench layout smoke PASS');
