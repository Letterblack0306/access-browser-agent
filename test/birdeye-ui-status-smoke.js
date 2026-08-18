'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const main = read('electron/main.js');
const preload = read('electron/preload.js');
const index = read('electron/index.html');
const view = read('electron/birdeye-status-view.js');

assert.match(main, /ipcMain\.handle\('ide:birdeye-send', \(\) => handoffService\.create\(workspaceRoot\)\)/u);
assert.match(main, /ipcMain\.handle\('ide:birdeye-status', \(\) => handoffService\.status\(\)\)/u);
assert.match(preload, /birdEyeStatus: \(\) => ipcRenderer\.invoke\('ide:birdeye-status'\)/u);
assert.match(index, /<script src="\.\/birdeye-status-view\.js"><\/script>/u);

assert.match(view, /BirdEye queued/u);
assert.match(view, /BirdEye received/u);
assert.match(view, /BirdEye indexed/u);
assert.match(view, /BirdEye failed/u);
assert.match(view, /BirdEye local only/u);
assert.match(view, /window\.accessIde\.birdEyeStatus\(\)/u);
assert.match(view, /addEventListener\('click', send, \{ capture: true \}\)/u);
assert.match(view, /event\.stopImmediatePropagation\(\)/u);
assert.match(view, /result\.state === 'queued'/u);
assert.doesNotMatch(view, /setInterval/u);

console.log('BirdEye UI status smoke PASS');
