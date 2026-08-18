'use strict';

const assert = require('node:assert/strict');
const {
  COST_CLASSES,
  normalizeModelCatalogEntry,
  pricingFromInfo,
} = require('../src/llm/ModelCatalog');
const OpenAICompatibleProvider = require('../src/llm/OpenAICompatibleProvider');
const { ClineLlmsProvider } = require('../src/llm/ClineLlmsProvider');
const { createProvider } = require('../src/llm/ProviderFactory');

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

function testPricingClassification() {
  assert.equal(pricingFromInfo({ metadata: { free: true } }).classification, COST_CLASSES.FREE);
  assert.equal(pricingFromInfo({ pricing: { input: 0, output: 0 } }).classification, COST_CLASSES.FREE);
  assert.equal(pricingFromInfo({ pricing: { input: 1, output: 2 } }).classification, COST_CLASSES.PAID);
  assert.equal(pricingFromInfo({}).classification, COST_CLASSES.UNKNOWN);
  assert.equal(pricingFromInfo({}, { local: true }).classification, COST_CLASSES.LOCAL);
}

function testNormalizedShape() {
  const raw = { name: 'Example Model', pricing: { input: 0, output: 0 }, extra: { preserved: true } };
  const item = normalizeModelCatalogEntry({
    providerId: 'provider-a',
    providerKind: 'hosted',
    modelId: 'model-a',
    info: raw,
  });
  assert.equal(item.id, 'model-a');
  assert.equal(item.modelId, 'model-a');
  assert.equal(item.displayName, 'Example Model');
  assert.equal(item.providerId, 'provider-a');
  assert.equal(item.providerKind, 'hosted');
  assert.equal(item.free, true);
  assert.equal(item.pricing.classification, 'free');
  assert.equal(item.readiness.status, 'unverified');
  assert.equal(item.readiness.agentReady, false);
  assert.equal(item.availability.discovered, true);
  assert.equal(item.capabilities.toolCalling, 'unknown');
  assert.deepEqual(item.info, raw);
  assert.deepEqual(item.rawProviderMetadata, raw);
}

async function testOpenAiCompatibleCatalog() {
  const provider = new OpenAICompatibleProvider({
    providerId: 'remote-compatible',
    providerKind: 'openai-compatible',
    baseUrl: 'https://models.example.test/v1',
    model: 'alpha',
    endpointPolicy: 'any-http',
    fetch: async () => response({
      data: [
        { id: 'alpha', name: 'Alpha', pricing: { input: 1, output: 2 }, context_window: 32000 },
        { id: 'local-free', metadata: { free: true }, custom: 'kept' },
        { id: 'alpha', name: 'duplicate ignored' },
      ],
    }),
  });
  const catalog = await provider.listModelCatalog();
  assert.deepEqual(catalog.map(item => item.id), ['alpha', 'local-free']);
  assert.equal(catalog[0].pricing.classification, 'paid');
  assert.equal(catalog[0].rawProviderMetadata.context_window, 32000);
  assert.equal(catalog[1].pricing.classification, 'free');
  assert.equal(catalog[1].rawProviderMetadata.custom, 'kept');
  assert.deepEqual(await provider.listModels(), ['alpha', 'local-free']);
}

async function testClineCatalog() {
  const provider = new ClineLlmsProvider({
    providerId: 'cline',
    model: 'free-model',
    apiKeyProvider: async () => 'token',
    loadLlms: async () => ({
      getModelsForProvider: async () => ({
        'free-model': { displayName: 'Free Model', pricing: { input: 0, output: 0 }, family: 'demo' },
        'paid-model': { pricing: { input: 0.5, output: 1 } },
      }),
    }),
  });
  const catalog = await provider.listModelCatalog();
  assert.equal(catalog[0].providerKind, 'cline');
  assert.equal(catalog[0].displayName, 'Free Model');
  assert.equal(catalog[0].pricing.classification, 'free');
  assert.equal(catalog[0].rawProviderMetadata.family, 'demo');
  assert.equal(catalog[1].pricing.classification, 'paid');
}

async function testLmStudioFactoryCatalogIdentity() {
  const provider = createProvider({
    providerKind: 'lm-studio',
    lmStudioBaseUrl: 'http://127.0.0.1:1234/v1',
    lmStudioModel: 'local-model',
  });
  assert.equal(provider.providerId, 'lm-studio');
  assert.equal(provider.providerKind, 'lm-studio');
  assert.equal(provider.local, true);
  const item = normalizeModelCatalogEntry({
    providerId: provider.providerId,
    providerKind: provider.providerKind,
    modelId: 'local-model',
    info: { id: 'local-model' },
    local: provider.local,
  });
  assert.equal(item.pricing.classification, 'local');
  assert.equal(item.free, false);
}

(async () => {
  testPricingClassification();
  testNormalizedShape();
  await testOpenAiCompatibleCatalog();
  await testClineCatalog();
  await testLmStudioFactoryCatalogIdentity();
  console.log('Model catalog smoke PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
