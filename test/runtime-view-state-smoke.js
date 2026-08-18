'use strict';

const assert = require('node:assert/strict');
const viewState = require('../electron/runtime-view-state');

let state = viewState.create();
assert.equal(state.runtime.status, 'starting');
assert.equal(state.relay.status, 'stopped');

state = viewState.fromSnapshot(state, { workspaceRoot: 'G:\\Demo', agent: { status: 'stopped', running: false }, provider: { configured: false } });
assert.equal(state.runtime.status, 'stopped');
assert.equal(state.workspace.status, 'connected');
assert.equal(state.provider.status, 'unconfigured');

state = viewState.fromSnapshot(state, { workspaceRoot: 'G:\\Demo', agent: { status: 'running', running: true }, provider: { configured: true, reachable: false, healthy: false } });
assert.equal(state.runtime.status, 'running');
assert.equal(state.provider.status, 'unavailable');

state = viewState.fromSnapshot(state, { workspaceRoot: 'G:\\Demo', agent: { status: 'completed', running: false }, provider: { configured: true, healthy: true } });
assert.equal(state.runtime.status, 'completed');
assert.equal(state.provider.status, 'ready');
state = viewState.fromSnapshot(state, { workspaceRoot: 'G:\\Demo', agent: { status: 'idle', running: false }, runtimeControl: { active: true }, provider: { configured: true, healthy: true } });
assert.equal(state.runtime.status, 'ready');
assert.equal(state.runtime.active, true);

state = viewState.withRelay(state, 'running', 'Relay watching provider tab.');
assert.equal(state.relay.status, 'running');
state = viewState.withRelay(state, 'stopped', 'Relay stopped.');
assert.equal(state.relay.status, 'stopped');
state = viewState.withRelayFeedback(state, 'ready', 'One provider tab found.');
assert.equal(state.relay.status, 'stopped', 'discovery feedback must not mark the relay connected');
assert.equal(state.relayFeedback.message, 'One provider tab found.');
state = viewState.withBrowserSession(state, 'blocked', 'Managed Chrome must be launched.');
assert.equal(state.browserSession.status, 'blocked');
state = viewState.fromSnapshot(state, { workspaceRoot: 'G:\\Demo', agent: {}, provider: {}, browser: { lifecycle:'ready', endpoint:'http://127.0.0.1:7330', pid:42 }, browserRelay: { lifecycle:'running', running:true, target:{ targetId:'tab-1', providerId:'chatgpt' } } });
assert.equal(state.browser.lifecycle, 'ready');
assert.equal(state.browser.selectedTarget.targetId, 'tab-1');
assert.equal(state.relay.status, 'running');
state = viewState.fromSnapshot(state, { workspaceRoot: 'G:\\Demo', agent: {}, provider: {}, browser: { lifecycle:'stopped', endpoint:null, pid:null }, browserRelay: { lifecycle:'unavailable', running:false, target:null } });
assert.equal(state.browser.lifecycle, 'stopped');
assert.equal(state.relay.status, 'unavailable');
state = viewState.withBrowserTargets(state, [{ targetId:'one', providerId:'chatgpt' }, { targetId:'two', providerId:'gemini' }]);
assert.equal(state.browser.selectedTarget, null, 'enumeration must not select the first target');
state = viewState.withBrowserTargets(state, state.browser.targets, state.browser.targets[1]);
assert.equal(state.browser.selectedTarget.targetId, 'two');

console.log('runtime-view-state-smoke: PASS');
