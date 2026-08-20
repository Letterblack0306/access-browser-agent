'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AgentRuntimeAdapter } = require('../electron/agent-runtime-adapter');
const { ModelReadinessRegistry } = require('../src/llm/ModelReadinessRegistry');

function readyCandidate(model) {
  let call = 0;
  return {
    providerId: 'cline',
    model,
    getHealth() { return { providerId:'cline', model, configured:true }; },
    async complete() {
      call += 1;
      if (call === 1) return { content:'READY', model, providerRequestId:'completion-1' };
      if (call === 2) return { content:'', model, providerRequestId:'tool-1', toolCalls:[{ name:'diagnostic_probe', arguments:{ value:'PING' } }] };
      if (call === 3) return { content:'{"ready":true}', model, providerRequestId:'structured-1' };
      throw new Error('Unexpected candidate completion call.');
    },
  };
}

function failingCandidate(model) {
  return {
    providerId: 'cline',
    model,
    getHealth() { return { providerId:'cline', model, configured:true }; },
    async complete() { throw new Error('candidate unavailable'); },
  };
}

function createAdapter(activeProvider, activeSelection, candidateProvider) {
  const adapter = Object.create(AgentRuntimeAdapter.prototype);
  adapter.providerCapabilities = new ModelReadinessRegistry();
  adapter.providerSelection = { ...activeSelection };
  adapter.service = { provider:activeProvider, agent:{ provider:activeProvider } };
  adapter.clineAuth = {
    async load() {},
    status() { return { authenticated:true, email:'test@example.com' }; },
  };
  adapter._createProvider = () => candidateProvider;
  adapter._installProvider = () => { throw new Error('Candidate readiness must not install a provider.'); };
  return adapter;
}

async function proveCandidateProbe(candidateProvider, candidateModel, expectedReady) {
  const activeProvider = { providerId:'lm-studio', model:'active-local-model' };
  const activeSelection = {
    providerKind:'lm-studio',
    lmStudioBaseUrl:'http://127.0.0.1:1234/v1',
    lmStudioModel:'active-local-model',
  };
  const adapter = createAdapter(activeProvider, activeSelection, candidateProvider);
  const beforeSelection = JSON.stringify(adapter.providerSelection);

  const result = await adapter.updateProviderSettings({
    providerKind:'cline',
    clineProviderId:'cline',
    clineModel:candidateModel,
    discoverOnly:true,
    probeReadiness:true,
    persist:false,
  });

  assert.equal(result.readinessProbe.agentReady, expectedReady);
  assert.equal(adapter.service.provider, activeProvider, 'candidate probe replaced service.provider');
  assert.equal(adapter.service.agent.provider, activeProvider, 'candidate probe replaced service.agent.provider');
  assert.equal(JSON.stringify(adapter.providerSelection), beforeSelection, 'candidate probe replaced providerSelection');

  const cached = adapter.providerCapabilities.get({
    providerKind:'cline',
    clineProviderId:'cline',
    clineModel:candidateModel,
  });
  assert.ok(cached, 'candidate readiness was not cached by candidate selection identity');
  assert.equal(cached.agentReady, expectedReady);
}

async function main() {
  await proveCandidateProbe(readyCandidate('candidate-ready'), 'candidate-ready', true);
  await proveCandidateProbe(failingCandidate('candidate-fail'), 'candidate-fail', false);

  const settingsPath = path.join(__dirname, '..', 'electron', 'rebuild-settings.js');
  const settings = fs.readFileSync(settingsPath, 'utf8');
  const start = settings.indexOf("$('clineTest')?.addEventListener");
  const end = settings.indexOf("$('clineUse')?.addEventListener", start);
  assert.ok(start >= 0 && end > start, 'Cline Test READY handler not found.');
  const clineTest = settings.slice(start, end);
  assert.match(clineTest, /discoverOnly:true/);
  assert.match(clineTest, /probeReadiness:true/);
  assert.doesNotMatch(clineTest, /api\.providerReadiness\(\)/, 'Cline Test READY must not probe whichever provider is currently active.');
  assert.doesNotMatch(clineTest, /providerConfigure\(\{providerKind:'cline',clineProviderId:'cline',clineModel:model,persist:false\}\)/, 'Legacy authoritative Test READY configure path reappeared.');

  console.log('provider-candidate-readiness-authority-smoke: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
