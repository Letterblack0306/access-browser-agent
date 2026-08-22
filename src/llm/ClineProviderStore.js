'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const DEFAULT_CLINE_PROVIDERS_PATH = path.join(
  os.homedir(),
  '.cline',
  'data',
  'settings',
  'providers.json'
);

function resolveClineProvidersPath(explicitPath = '') {
  return path.resolve(String(explicitPath || process.env.CLINE_PROVIDERS_PATH || DEFAULT_CLINE_PROVIDERS_PATH));
}

function credentialsFromProviderStore(value) {
  const auth = value?.providers?.cline?.settings?.auth;
  if (!auth || typeof auth !== 'object' || !String(auth.accessToken || '')) return null;
  return {
    access: String(auth.accessToken),
    refresh: String(auth.refreshToken || ''),
    expires: Number.isFinite(Number(auth.expiresAt)) ? Number(auth.expiresAt) : undefined,
    accountId: String(auth.accountId || ''),
    email: String(auth.metadata?.email || auth.email || ''),
    providerMetadata: auth.metadata && typeof auth.metadata === 'object' ? { ...auth.metadata } : {},
  };
}

async function readClineProviderCredentials(explicitPath = '') {
  const filePath = resolveClineProvidersPath(explicitPath);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const credentials = credentialsFromProviderStore(parsed);
    return { credentials, filePath, error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { credentials: null, filePath, error: null };
    return { credentials: null, filePath, error: error?.message || String(error) };
  }
}

module.exports = {
  DEFAULT_CLINE_PROVIDERS_PATH,
  resolveClineProvidersPath,
  credentialsFromProviderStore,
  readClineProviderCredentials,
};
