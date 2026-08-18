'use strict';

const assert = require('node:assert/strict');
const {
  ModelReadinessRegistry,
  normalizeReadiness,
  selectionIdentity,
} = require('../src/llm/ModelReadinessRegistry');

const registry = new ModelReadinessRegistry();

const clineA = { providerKind:'cline', clineProviderId:'cline', clineModel:'model-a' };
const clineB = { providerKind:'cline', clineProviderId:'cline', clineModel:'model-b' };
const localA = { providerKind:'lm-studio', lmStudioBaseUrl:'http://127.0.0.1:1234/v1', lmStudioModel:'model-a' };
const remoteSameModel = { providerKind:'lm-studio', lmStudioBaseUrl:'http://192.168.1.50:1234/v1', lmStudioModel:'model-a' };

assert.notEqual(selectionIdentity(clineA), selectionIdentity(clineB), 'different models must have different readiness identities');
assert.notEqual(selectionIdentity(clineA), selectionIdentity(localA), 'different providers must have different readiness identities');
assert.notEqual(selectionIdentity(localA), selectionIdentity(remoteSameModel), 'different OpenAI-compatible endpoints must not share readiness proof');

const readyA = registry.set(clineA, {
  agentReady:true,
  checkedAt:'2026-08-17T00:00:00.000Z',
  model:'model-a',
  capabilities:{ completion:'verified', toolCalling:'verified', structuredOutput:'unsupported' },
});
assert.equal(readyA.status, 'agent_ready');
assert.equal(registry.get(clineA).agentReady, true);
assert.equal(registry.get(clineB), null, 'readiness must not leak to another model');
assert.equal(registry.get(localA), null, 'readiness must not leak to another provider');

registry.set(clineB, {
  agentReady:false,
  checkedAt:'2026-08-17T00:01:00.000Z',
  model:'model-b',
  capabilities:{ completion:'verified', toolCalling:'unsupported', structuredOutput:'unknown' },
  failureReasons:{ toolCalling:'No tool call emitted.' },
});

const projected = registry.projectCatalog([
  { id:'model-a', modelId:'model-a', readiness:{ status:'unverified', agentReady:false, checkedAt:null, capabilities:{ completion:'unknown', toolCalling:'unknown', structuredOutput:'unknown' }, failureReasons:{} } },
  { id:'model-b', modelId:'model-b', readiness:{ status:'unverified', agentReady:false, checkedAt:null, capabilities:{ completion:'unknown', toolCalling:'unknown', structuredOutput:'unknown' }, failureReasons:{} } },
  { id:'model-c', modelId:'model-c', readiness:{ status:'unverified', agentReady:false, checkedAt:null, capabilities:{ completion:'unknown', toolCalling:'unknown', structuredOutput:'unknown' }, failureReasons:{} } },
], { providerKind:'cline', clineProviderId:'cline' });

assert.equal(projected[0].readiness.agentReady, true);
assert.equal(projected[0].readiness.capabilities.structuredOutput, 'unsupported');
assert.equal(projected[1].readiness.status, 'capability_failed');
assert.equal(projected[1].readiness.failureReasons.toolCalling, 'No tool call emitted.');
assert.equal(projected[2].readiness.status, 'unverified');
assert.equal(projected[2].readiness.checkedAt, null);

const failed = normalizeReadiness({
  agentReady:false,
  checkedAt:'2026-08-17T00:02:00.000Z',
  capabilities:{ completion:'failed', toolCalling:'unknown', structuredOutput:'unknown' },
}, 'model-x');
assert.equal(failed.status, 'capability_failed');
assert.equal(failed.model, 'model-x');

registry.clear();
assert.equal(registry.get(clineA), null, 'runtime reset must clear ephemeral readiness evidence');

console.log('model-readiness-registry-smoke: PASS');
