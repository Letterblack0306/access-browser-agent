'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RuntimeDiagnosticLog, sanitize, classify } = require('../src/system/runtime-diagnostic-log');
const { sameChatIdentity, normalizedChatIdentity } = require('../src/browser/provider-channel');
const { normalize } = require('../src/system/ide-preferences');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.equal(sameChatIdentity('https://chatgpt.com/c/abc?x=1', 'https://chatgpt.com/c/abc#fragment'), true);
assert.equal(sameChatIdentity('https://chatgpt.com/c/abc', 'https://chatgpt.com/c/xyz'), false);
assert.equal(normalizedChatIdentity('https://chatgpt.com/c/abc/'), 'https://chatgpt.com/c/abc');

const prefs = normalize({ browserChatUrl:'https://chatgpt.com/c/abc', browserCdpPort:9222 });
assert.equal(prefs.browserChatUrl, 'https://chatgpt.com/c/abc');
assert.equal(normalize({ browserChatUrl:'javascript:alert(1)' }).browserChatUrl, '');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'access-agent-diag-'));
let tick = 0;
const log = new RuntimeDiagnosticLog({ root:temp, sessionId:'session-test', pid:99, clock:()=>`2026-08-14T10:00:0${tick++}.000Z` });
const first = log.write({ source:'renderer', category:'ui', action:'click', phase:'event', data:{ id:'loopStart' } });
const second = log.write({ source:'managed-chrome', category:'browser', action:'start', phase:'failed', error:Object.assign(new Error('Choose a Chrome profile folder'), { code:'CHROME_PROFILE_MISSING', classification:'USER_SETUP' }) });
assert.equal(first.seq, 1);
assert.equal(second.seq, 2);
assert.equal(second.classification, 'USER_SETUP');
assert.equal(log.readRecent(10).length, 2);
assert.equal(classify({ source:'browser-relay', category:'delivery', action:'send', phase:'failed' }), 'TRANSPORT');
const redacted = sanitize({ apiKey:'sk-proj-abcdefghijklmnopqrstuvwxyz', authorization:'Bearer topsecret', nested:{ password:'abc' } });
assert.equal(redacted.apiKey, '[REDACTED]');
assert.equal(redacted.authorization, '[REDACTED]');
assert.equal(redacted.nested.password, '[REDACTED]');

const html = read('electron/index.html');
const renderer = read('electron/rebuild-renderer.js');
const preload = read('electron/preload.js');
const settings = read('electron/rebuild-settings.js');
const managedChrome = read('src/system/managed-chrome.js');
const mainWrapper = read('electron/rebuild-main.js');

for (const id of ['chatUrl','btn-start','btn-stop','recoverLoop','diagnosticList','diagnosticFilter','openDiagnosticFolder']) assert.ok(html.includes(`id="${id}"`), `missing user-facing observability control ${id}`);
assert.ok(renderer.includes('startExactLoop'));
assert.ok(renderer.includes('browserOpenExactChat'));
assert.ok(renderer.includes("api.savePreferences({ browserChatUrl"));
assert.ok(renderer.includes("api.browserStop().catch"));
assert.ok(renderer.includes("classification:'USER_SETUP'"));
assert.ok(renderer.includes("uiDiagnostic('click'"));
assert.ok(renderer.includes('diagnosticRecent(5000)'));
assert.ok(preload.includes("diagnostic({ source:'preload', category:'ipc'"));
assert.ok(preload.includes("'ide:browser-open-exact-chat'"));
assert.ok(preload.includes('diagnosticReveal'));
assert.ok(mainWrapper.includes("ipcMain.handle('ide:browser-open-exact-chat'"));
assert.ok(mainWrapper.includes('waitForExactChat'));
assert.ok(settings.includes('saved_chat_loaded'));
assert.ok(settings.includes("source:'agent-event'"));
assert.ok(settings.includes("source:'agent-state'"));
assert.ok(settings.includes("source:'terminal'"));
assert.ok(!settings.includes('restoreBrowserTarget'));
assert.ok(managedChrome.includes("'--remote-debugging-port=0'"));
assert.ok(managedChrome.includes('const ownsGeneration=this.generation===generation'));
assert.ok(managedChrome.includes('if(!ownsGeneration)return'));

console.log('rebuild-diagnostic-contract-smoke: PASS');
