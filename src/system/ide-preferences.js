'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULT_ALLOWED_COMMANDS, normalizeAllowedCommands } = require('./governed-terminal');
const { DEFAULT_SYNC_EXCLUSIONS, normalizeExclusions } = require('./workspace-clone-sync');

const FILE_NAME = 'ide-preferences.json';
const ENDPOINT_POLICIES = new Set(['loopback', 'private-network', 'any-http']);
const PROVIDER_KINDS = new Set(['lm-studio', 'cline']);

const DEFAULTS = Object.freeze({
  workspaceRoot: '',
  providerKind: 'lm-studio',
  clineAuth: {
    accessToken: '', refreshToken: '', expiresAt: 0, accountId: '', email: '', providerMetadata: {}
  },
  clineProviderId: 'cline',
  clineModel: '',
  lmStudioBaseUrl: 'http://127.0.0.1:1234/v1',
  lmStudioModel: '',
  lmStudioApiKey: '',
  lmStudioEndpointPolicy: 'private-network',
  lmStudioContextLength: null,
  lmStudioTtlSeconds: null,
  lmStudioConversationMode: 'application',
  mcpServerCommand: '',
  browserMode: 'managed',
  browserProfilePath: '',
  browserExecutable: '',
  browserCdpPort: null,
  browserChatUrl: '',
  browserProviderTarget: null,
  workspaceSyncTarget: '',
  workspaceSyncExclusions: DEFAULT_SYNC_EXCLUSIONS,
  terminalAllowedCommands: DEFAULT_ALLOWED_COMMANDS,
  useClineStyle: false,
});

function optionalPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}

function normalize(input = {}) {
  const endpointPolicy = String(input.lmStudioEndpointPolicy || DEFAULTS.lmStudioEndpointPolicy).trim().toLowerCase();
  const providerKind = String(input.providerKind || DEFAULTS.providerKind).trim().toLowerCase();
  return {
    workspaceRoot: String(input.workspaceRoot || '').trim(),
    providerKind: PROVIDER_KINDS.has(providerKind) ? providerKind : DEFAULTS.providerKind,
    clineProviderId: String(input.clineProviderId || DEFAULTS.clineProviderId).trim() || DEFAULTS.clineProviderId,
    clineModel: String(input.clineModel || '').trim(),
    lmStudioBaseUrl: String(input.lmStudioBaseUrl || DEFAULTS.lmStudioBaseUrl).trim(),
    lmStudioModel: String(input.lmStudioModel || '').trim(),
    lmStudioApiKey: String(input.lmStudioApiKey || '').trim(),
    lmStudioEndpointPolicy: ENDPOINT_POLICIES.has(endpointPolicy) ? endpointPolicy : DEFAULTS.lmStudioEndpointPolicy,
    lmStudioContextLength: optionalPositiveInteger(input.lmStudioContextLength),
    lmStudioTtlSeconds: optionalPositiveInteger(input.lmStudioTtlSeconds),
    lmStudioConversationMode: 'application',
    mcpServerCommand: String(input.mcpServerCommand || '').trim(),
    browserMode: input.browserMode === 'existing' ? 'existing' : 'managed',
    browserProfilePath: String(input.browserProfilePath || '').trim(),
    browserExecutable: String(input.browserExecutable || '').trim(),
    browserCdpPort: optionalPositiveInteger(input.browserCdpPort),
    browserChatUrl: normalizeHttpUrl(input.browserChatUrl),
    browserProviderTarget: input.browserProviderTarget && typeof input.browserProviderTarget === 'object' ? {
      targetId: String(input.browserProviderTarget.targetId || '').trim(),
      providerId: String(input.browserProviderTarget.providerId || '').trim(),
      title: String(input.browserProviderTarget.title || '').trim(),
      url: String(input.browserProviderTarget.url || '').trim(),
    } : null,
    workspaceSyncTarget: String(input.workspaceSyncTarget || '').trim(),
    workspaceSyncExclusions: input.workspaceSyncExclusions === undefined ? [...DEFAULT_SYNC_EXCLUSIONS] : normalizeExclusions(input.workspaceSyncExclusions),
    terminalAllowedCommands: normalizeAllowedCommands(input.terminalAllowedCommands),
    useClineStyle: input.useClineStyle === true,
    clineAuth: {
      accessToken: String(input.clineAuth?.accessToken || DEFAULTS.clineAuth.accessToken),
      refreshToken: String(input.clineAuth?.refreshToken || DEFAULTS.clineAuth.refreshToken),
      expiresAt: optionalPositiveInteger(input.clineAuth?.expiresAt),
      accountId: String(input.clineAuth?.accountId || DEFAULTS.clineAuth.accountId),
      email: String(input.clineAuth?.email || DEFAULTS.clineAuth.email),
      providerMetadata: Object.assign({}, DEFAULTS.clineAuth.providerMetadata, input.clineAuth?.providerMetadata)
    }
  };
}

class IdePreferences {
  constructor(directory) { this.file = path.join(directory, FILE_NAME); }
  async load() {
    try { return normalize(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
    catch (error) {
      if (error.code === 'ENOENT') return { ...DEFAULTS };
      throw new Error(`Could not read IDE preferences: ${error.message}`);
    }
  }
  async save(input) {
    const value = normalize(input);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, this.file);
    return value;
  }
}

module.exports = { IdePreferences, DEFAULTS, normalize, optionalPositiveInteger, normalizeHttpUrl };
