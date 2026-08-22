'use strict';

const { normalizeProviderKind } = require('./ProviderFactory');

function selectionIdentity(input = {}) {
  const providerKind = normalizeProviderKind(input.providerKind);
  const providerId = providerKind === 'cline'
    ? String(input.clineProviderId || 'cline').trim() || 'cline'
    : 'lm-studio';
  const modelId = providerKind === 'cline'
    ? String(input.clineModel || '').trim()
    : String(input.lmStudioModel || '').trim();
  const endpoint = providerKind === 'cline'
    ? ''
    : String(input.lmStudioBaseUrl || '').trim();
  return JSON.stringify({ providerKind, providerId, endpoint, modelId });
}

function selectionForCatalogItem(input = {}, item = {}) {
  const providerKind = normalizeProviderKind(input.providerKind);
  const modelId = String(item.modelId || item.id || '').trim();
  return providerKind === 'cline'
    ? { ...input, providerKind, clineProviderId:String(input.clineProviderId || item.providerId || 'cline').trim() || 'cline', clineModel:modelId }
    : { ...input, providerKind, lmStudioModel:modelId };
}

function normalizeReadiness(value = {}, fallbackModel = '') {
  const capabilities = value.capabilities || {};
  const failureReasons = value.failureReasons || value.evidence?.failureReasons || {};
  const agentReady = value.agentReady === true;
  const checkedAt = value.checkedAt || value.evidence?.checkedAt || null;
  return {
    status: agentReady ? 'agent_ready' : (checkedAt ? 'capability_failed' : 'unverified'),
    agentReady,
    checkedAt,
    model:String(value.model || fallbackModel || '').trim() || null,
    capabilities:{
      completion:String(capabilities.completion || 'unknown'),
      toolCalling:String(capabilities.toolCalling || 'unknown'),
      structuredOutput:String(capabilities.structuredOutput || 'unknown'),
      imageInput:String(capabilities.imageInput || 'unknown'),
    },
    failureReasons:{ ...failureReasons },
  };
}

class ModelReadinessRegistry {
  constructor() { this.entries = new Map(); }

  clear() { this.entries.clear(); }

  set(selection = {}, readiness = {}) {
    const key = selectionIdentity(selection);
    const modelId = normalizeProviderKind(selection.providerKind) === 'cline'
      ? String(selection.clineModel || '').trim()
      : String(selection.lmStudioModel || '').trim();
    const normalized = normalizeReadiness(readiness, modelId);
    this.entries.set(key, normalized);
    return { ...normalized, capabilities:{ ...normalized.capabilities }, failureReasons:{ ...normalized.failureReasons } };
  }

  get(selection = {}) {
    const stored = this.entries.get(selectionIdentity(selection));
    return stored ? { ...stored, capabilities:{ ...stored.capabilities }, failureReasons:{ ...stored.failureReasons } } : null;
  }

  projectCatalog(catalog = [], selection = {}) {
    return (Array.isArray(catalog) ? catalog : []).map(item => {
      const projectedSelection = selectionForCatalogItem(selection, item);
      const readiness = this.get(projectedSelection) || normalizeReadiness(item.readiness, item.modelId || item.id);
      return {
        ...item,
        readiness,
        capabilities:{ ...(item.capabilities || {}), ...(readiness.capabilities || {}) },
      };
    });
  }
}

module.exports = {
  ModelReadinessRegistry,
  normalizeReadiness,
  selectionIdentity,
  selectionForCatalogItem,
};
