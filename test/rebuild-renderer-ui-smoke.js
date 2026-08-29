'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const html = read('electron/index.html');
const renderer = read('electron/rebuild-renderer.js');
const css = read('electron/rebuild-shell.css');

// --- Navigation consolidation: right rail must be gone, 7 center tabs present ---
assert.match(html, /data-center-tab[^>]*data-view="task"/u);
for (const view of ['task', 'execution', 'manager', 'editor', 'loop', 'runtime', 'settings']) {
  assert.match(html, new RegExp(`data-center-tab[^>]*data-view="${view}"`, 'u'), `center tab ${view} must exist`);
  assert.match(html, new RegExp(`data-center-view[^>]*data-view="${view}"`, 'u'), `center view ${view} must exist`);
}
assert.doesNotMatch(html, /right-region/u, 'scattered right rail must be removed from the shell');
assert.doesNotMatch(css, /grid-template-columns:.*var\(--right-w\)/u, 'workbench grid must not reference right rail width');
assert.match(css, /\.right-region\s*\{\s*display:\s*none/u, 'right region must stay hidden');
assert.match(css, /\.right-region,\s*\.resizer\.right\s*\{\s*display:\s*none|\.resizer\.right\s*\{\s*display:\s*none/u, 'right resizer must stay hidden');
assert.match(css, /\.center-region\s*\{\s*grid-column:\s*3/u, 'center region must span the full primary grid column');

// --- Start/Stop are singular and authoritative in the top bar ---
assert.match(html, /id="btn-start"/u, 'top-bar Start Agent control must exist');
assert.match(html, /id="btn-stop"/u, 'top-bar Stop control must exist');
assert.doesNotMatch(html, /id="loopStart"/u, 'duplicate Loop-tab Start control must be removed');
assert.match(renderer, /btn-start/u);
assert.match(renderer, /btn-stop/u);
assert.doesNotMatch(renderer, /\$\('loopStart'\)/u, 'renderer must not bind legacy loopStart control');

// --- Current-location indicator (#view-meta) exists and is updated by render ---
assert.match(html, /id="view-meta"/u);
assert.match(renderer, /getElementById\('view-meta'\)/u, 'renderer must update the current-location indicator');

// --- Pinned live feed: live-stream follow bar and is-pinned wiring ---
assert.match(renderer, /live-stream-follow-bar/u);
assert.match(renderer, /live-stream-follow-toggle/u);
assert.match(renderer, /is-pinned/u);
assert.match(css, /\.live-stream-follow-bar/u);
assert.match(css, /\.conversation\.is-pinned/u, 'conversation must have bounded pinned CSS');
assert.match(css, /\.view-meta/u, 'view-meta indicator must be styled');

// --- Settings accessible via center tab (not right rail) ---
assert.match(html, /data-center-view[^>]*data-view="settings"/u);
assert.match(html, /data-center-tab[^>]*data-view="settings"/u);
assert.match(renderer, /settings:\s*'Settings'/u, 'view-meta label map must know the Settings view');

console.log('rebuild-renderer-ui-smoke: PASS');