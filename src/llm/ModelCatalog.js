'use strict';

const COST_CLASSES = Object.freeze({
  FREE: 'free',
  PAID: 'paid',
  LOCAL: 'local',
  UNKNOWN: 'unknown',
});

// DeepSeek model definitions
const DEEPSEEK_MODELS = {
  'deepseek/deepseek-v4-flash': {
    id: 'deepseek/deepseek-v4-flash',
    displayName: 'DeepSeek 4 Flash',
    provider: 'deepseek',
    providerId: 'deepseek',
    free: true,
    pricing: { input: 0, output: 0 },
    metadata: {
      free: true,
      description: 'DeepSeek V4 Flash - Fast inference',
      contextWindow: 128000,
      capabilities: { completion: true, toolCalling: true }
    }
  },
  'deepseek/deepseek-v3': {
    id: 'deepseek/deepseek-v3',
    displayName: 'DeepSeek V3',
    provider: 'deepseek',
    providerId: 'deepseek',
    free: true,
    pricing: { input: 0, output: 0 },
    metadata: {
      free: true,
      description: 'DeepSeek V3 - High performance',
      contextWindow: 128000,
      capabilities: { completion: true, toolCalling: true }
    }
  },
  'deepseek/deepseek-r1': {
    id: 'deepseek/deepseek-r1',
    displayName: 'DeepSeek R1',
    provider: 'deepseek',
    providerId: 'deepseek',
    free: true,
    pricing: { input: 0, output: 0 },
    metadata: {
      free: true,
      description: 'DeepSeek R1 - Reasoning model',
      contextWindow: 128000,
      capabilities: { completion: true, toolCalling: true }
    }
  }
};

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pricingFromInfo(info = {}, { local = false } = {}) {
  const source = info && typeof info === 'object' ? info : {};
  const pricing = source.pricing && typeof source.pricing === 'object' ? source.pricing : {};
  const input = finiteNumber(pricing.input ?? pricing.inputCost ?? pricing.prompt);
  const output = finiteNumber(pricing.output ?? pricing.outputCost ?? pricing.completion);
  const numericPrices = Object.values(pricing).filter(value => typeof value === 'number' && Number.isFinite(value));
  const explicitlyFree = source?.metadata?.free === true || source.free === true;
  const zeroPriced = numericPrices.length > 0 && numericPrices.every(value => value === 0);
  const positivelyPriced = numericPrices.some(value => value > 0);

  let classification = COST_CLASSES.UNKNOWN;
  let evidenceSource = 'unknown';
  if (local) {
    classification = COST_CLASSES.LOCAL;
    evidenceSource = 'runtime';
  } else if (explicitlyFree || zeroPriced) {
    classification = COST_CLASSES.FREE;
    evidenceSource = explicitlyFree ? 'provider-metadata' : 'provider-pricing';
  } else if (positivelyPriced) {
    classification = COST_CLASSES.PAID;
    evidenceSource = 'provider-pricing';
  }

  return { classification, input, output, source: evidenceSource };
}

function normalizeModelCatalogEntry({ providerId, providerKind, modelId, info = {}, local = false } = {}) {
  const id = String(modelId || info?.id || info?.key || '').trim();
  if (!id) throw new Error('modelId is required');
  const normalizedProviderId = String(providerId || providerKind || '').trim() || 'unknown';
  const normalizedProviderKind = String(providerKind || providerId || '').trim() || 'unknown';
  const rawProviderMetadata = info && typeof info === 'object' && !Array.isArray(info) ? info : {};
  const pricing = pricingFromInfo(rawProviderMetadata, { local });
  const displayName = String(
    rawProviderMetadata.displayName
      || rawProviderMetadata.display_name
      || rawProviderMetadata.name
      || id,
  ).trim() || id;

  return {
    id,
    free: pricing.classification === COST_CLASSES.FREE,
    info: rawProviderMetadata,
    providerId: normalizedProviderId,
    providerKind: normalizedProviderKind,
    modelId: id,
    displayName,
    pricing,
    capabilities: {
      completion: 'unknown',
      toolCalling: 'unknown',
      structuredOutput: 'unknown',
      imageInput: 'unknown',
    },
    readiness: {
      status: 'unverified',
      agentReady: false,
      checkedAt: null,
      failureReasons: {},
    },
    availability: {
      discovered: true,
      reachable: null,
      accountEligible: null,
    },
    rawProviderMetadata,
  };
}

// Get all built-in models (DeepSeek + any future additions)
function getBuiltInModels() {
  return Object.values(DEEPSEEK_MODELS);
}

// Check if a model is free
function isModelFree(modelId) {
  return DEEPSEEK_MODELS[modelId]?.free === true;
}

module.exports = {
  COST_CLASSES,
  normalizeModelCatalogEntry,
  pricingFromInfo,
  DEEPSEEK_MODELS,
  getBuiltInModels,
  isModelFree,
};
