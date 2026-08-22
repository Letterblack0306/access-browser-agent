'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const main = read('electron/main.js');
const preload = read('electron/preload.js');
const index = read('electron/index.html');
const renderer = read('electron/rebuild-renderer.js');
const legacyRenderer = read('electron/renderer.js');
const uiRegistry = read('src/system/ui-id-registry.js');

assert.doesNotMatch(main, /ide:birdeye|WorkspaceHandoffService|handoffService/u);
assert.doesNotMatch(preload, /sendBirdEye|birdEyeStatus|ide:birdeye/u);
assert.doesNotMatch(index, /BirdEye|birdEye|sendBirdEye/u);
assert.doesNotMatch(renderer, /sendBirdEye|birdEye|BirdEye/u);
assert.doesNotMatch(legacyRenderer, /sendBirdEye|birdEye|BirdEye/u);
assert.doesNotMatch(uiRegistry, /sendBirdEye|birdEyeStatus/u);
assert.equal(fs.existsSync(path.join(root, 'electron', 'birdeye-status-view.js')), false);

console.log('external UI surface removal smoke PASS');
