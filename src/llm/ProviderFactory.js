'use strict';

const OpenAICompatibleProvider = require('./OpenAICompatibleProvider');
const { ClineLlmsProvider } = require('./ClineLlmsProvider');

const PROVIDER_KINDS = Object.freeze({
  LM_STUDIO: 'lm-studio',
  CLINE: 'cline',
});

function normalizeProviderKind(value) {
  const normalized = String(value || PROVIDER_KINDS.LM_STUDIO).trim().toLowerCase();
  if (['lmstudio', 'lm_studio', 'local'].includes(normalized)) return PROVIDER_KINDS.LM_STUDIO;
  if (normalized === PROVIDER_KINDS.CLINE) return PROVIDER_KINDS.CLINE;
  return PROVIDER_KINDS.LM_STUDIO;
}

function createProvider(input = {}, { clineAuth = null, previous = null } = {}) {
  const kind = normalizeProviderKind(input.providerKind);
  if (kind === PROVIDER_KINDS.CLINE) {
    const explicitApiKey = String(input.clineApiKey || process.env.CLINE_API_KEY || '').trim();
    return new ClineLlmsProvider({
      providerId: String(input.clineProviderId || 'cline').trim() || 'cline',
      model: String(input.clineModel || '').trim(),
      apiKeyProvider: async () => {
        if (explicitApiKey) return explicitApiKey;
        if (!clineAuth || typeof clineAuth.getApiKey !== 'function') return '';
        return clineAuth.getApiKey();
      },
      timeoutMs: previous?.timeoutMs,
    });
  }

  return new OpenAICompatibleProvider({
    providerId: PROVIDER_KINDS.LM_STUDIO,
    providerKind: PROVIDER_KINDS.LM_STUDIO,
    local: true,
    baseUrl: input.lmStudioBaseUrl,
    model: input.lmStudioModel,
    apiKey: input.lmStudioApiKey || input.apiKey,
    endpointPolicy: input.lmStudioEndpointPolicy,
    contextLength: input.lmStudioContextLength,
    ttlSeconds: input.lmStudioTtlSeconds,
    timeoutMs: previous?.timeoutMs,
    fetch: previous?.fetch,
  });
}

module.exports = { PROVIDER_KINDS, normalizeProviderKind, createProvider };
