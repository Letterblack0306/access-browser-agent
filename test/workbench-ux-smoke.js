'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read('electron/index.html');
const ideAdapter = read('electron/rebuild-ide-reference.js');
const ideCss = read('electron/rebuild-ide-reference.css');
const shellCss = read('electron/rebuild-shell.css');
const stabilityCss = read('electron/rebuild-ui-stability.css');

for (const label of ['Files', 'Agent task', 'Execution', 'Editor', 'Browser loop', 'Runtime', 'Settings']) {
  assert.match(html, new RegExp(`aria-label="${label}"`, 'u'));
}
for (const marker of ['data-ide-activity-rail', 'data-ide-target', 'aria-pressed', 'data-resizer']) {
  assert.match(html, new RegExp(marker, 'u'));
}
for (const marker of ['activity', 'data-ide-target', 'is-active']) {
  assert.match(ideAdapter, new RegExp(marker, 'u'));
}
for (const marker of ['activity', 'ide-activity', 'is-active', 'rail']) {
  assert.match(ideCss, new RegExp(marker, 'iu'));
}
for (const marker of ['--top-h', '--status-h', 'focus-visible', 'resizer']) {
  assert.match(shellCss, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'u'));
}
for (const marker of ['.live-session-stream', '.runtime-truth-row', 'presentation only']) {
  assert.match(stabilityCss, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'iu'));
}
assert.doesNotMatch(html, /BirdEye|sendBirdEye|ide:birdeye/u);
assert.doesNotMatch(html, /external node|project graph|cloud handoff/iu);

console.log('Workbench UX smoke PASS');
