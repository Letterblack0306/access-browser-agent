'use strict';

const { IdePreferences } = require('../system/ide-preferences');
const { readClineProviderCredentials } = require('./ClineProviderStore');

class ClineAuthSession {
  constructor({ loadCore, onAuth, onProgress, onPrompt, onPersist, preferencesPath = '', clineProvidersPath = '' } = {}) {
    this.loadCore = loadCore || (() => import('@cline/core'));
    this.onAuth = typeof onAuth === 'function' ? onAuth : () => {};
    this.onProgress = typeof onProgress === 'function' ? onProgress : () => {};
    this.onPrompt = typeof onPrompt === 'function'
      ? onPrompt
      : async prompt => String(prompt?.defaultValue || '');
    this.onPersist = typeof onPersist === 'function' ? onPersist : () => {};
    this.preferencesPath = preferencesPath;
    this.clineProvidersPath = clineProvidersPath;
    this.credentials = null;
    this.lastError = null;
    this._loaded = false;
    this._persisted = false;
  }

  async load() {
    if (this._loaded) return this.status();
    this._loaded = true;
    if (!this.preferencesPath) return this.status();
    try {
      const prefs = new IdePreferences(this.preferencesPath);
      const saved = await prefs.load();
      if (saved?.clineAuth?.accessToken) {
        this.credentials = {
          access: saved.clineAuth.accessToken,
          refresh: saved.clineAuth.refreshToken,
          expires: saved.clineAuth.expiresAt,
          accountId: saved.clineAuth.accountId,
          email: saved.clineAuth.email,
          providerMetadata: saved.clineAuth.providerMetadata
        };
        this._persisted = true;
      } else {
        const imported = await readClineProviderCredentials(this.clineProvidersPath);
        if (imported.credentials) {
          this.credentials = imported.credentials;
          this._persisted = false;
          this._authSource = 'cline-provider-store';
        }
      }
      return this.status();
    } catch (error) {
      this._persisted = false;
      return this.status();
    }
  }

  status() {
    return {
      authenticated: Boolean(this.credentials?.access),
      accountId: this.credentials?.accountId || null,
      email: this.credentials?.email || null,
      expiresAt: Number.isFinite(this.credentials?.expires)
        ? new Date(this.credentials.expires).toISOString()
        : null,
      error: this.lastError,
      persisted: this._persisted === true
      ,source: this._authSource || (this._persisted ? 'access-agent-preferences' : null)
    };
  }

  async login() {
    this.lastError = null;
    try {
      const core = await this.loadCore();
      const handler = core.getProviderAuthHandler?.('cline');
      if (!handler || typeof handler.login !== 'function') {
        throw new Error('Installed @cline/core does not expose Cline OAuth login.');
      }
      const credentials = await handler.login({
        callbacks: {
          onAuth: info => {
            try {
              const result = this.onAuth(info || {});
              if (result && typeof result.catch === 'function') result.catch(() => {});
            } catch {}
          },
          onPrompt: prompt => this.onPrompt(prompt || {}),
          onProgress: message => this.onProgress(String(message || '')),
          onManualCodeInput: () => this.onPrompt({ message: 'Enter authorization code', defaultValue: '' }),
        },
      });
      if (!credentials?.access) throw new Error('Cline OAuth login returned no access token.');
      this.credentials = credentials;
      this._authSource = 'access-agent-oauth';
      await this._saveCredentials();
      return this.status();
    } catch (error) {
      this.lastError = error?.message || String(error);
      throw error;
    }
  }

  async getApiKey() {
    // Load persisted credentials if not already loaded
    if (!this._loaded) {
      await this.load();
    }

    if (!this.credentials?.access) throw new Error('Cline account is not authenticated.');
    const core = await this.loadCore();
    const handler = core.getProviderAuthHandler?.('cline');
    if (!handler) throw new Error('Installed @cline/core does not expose Cline authentication.');

    if (Number.isFinite(this.credentials.expires) && this.credentials.expires <= Date.now() + 60_000) {
      if (typeof handler.refresh !== 'function') throw new Error('Cline credentials expired and refresh is unavailable.');
      const refreshed = await handler.refresh({
        settings: { provider: 'cline' },
        credentials: this.credentials,
        forceRefresh: true,
      });
      if (!refreshed?.access) throw new Error('Cline credential refresh failed.');
      this.credentials = refreshed;
      await this._saveCredentials();
    }

    if (typeof core.formatProviderOAuthApiKey === 'function') {
      return core.formatProviderOAuthApiKey('cline', this.credentials);
    }
    if (typeof handler.getApiKey === 'function') {
      const apiKey = handler.getApiKey({ provider: 'cline', auth: { accessToken: this.credentials.access } });
      if (apiKey) return apiKey;
    }
    return this.credentials.access;
  }

  async logout() {
    this.credentials = null;
    this._authSource = null;
    this.lastError = null;
    await this._clearCredentials();
    this._persisted = false;
    return this.status();
  }

  _notifyPersisted(clineAuth) {
    try {
      const result = this.onPersist({
        clineAuth: {
          accessToken: String(clineAuth?.accessToken || ''),
          refreshToken: String(clineAuth?.refreshToken || ''),
          expiresAt: Number(clineAuth?.expiresAt || 0),
          accountId: String(clineAuth?.accountId || ''),
          email: String(clineAuth?.email || ''),
          providerMetadata: { ...(clineAuth?.providerMetadata || {}) },
        },
      });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  }

  async _saveCredentials() {
    if (!this.preferencesPath) return;
    try {
      const prefs = new IdePreferences(this.preferencesPath);
      const current = await prefs.load();
      const updated = {
        ...current,
        clineAuth: {
          accessToken: this.credentials.access || '',
          refreshToken: this.credentials.refresh || '',
          expiresAt: this.credentials.expires || 0,
          accountId: this.credentials.accountId || '',
          email: this.credentials.email || '',
          providerMetadata: this.credentials.providerMetadata || {}
        }
      };
      await prefs.save(updated, { preserveClineAuth:false });
      this._persisted = true;
      this._notifyPersisted(updated.clineAuth);
    } catch (error) {
      this._persisted = false;
      // Credentials remain usable in memory even if persistence fails
    }
  }

  async _clearCredentials() {
    if (!this.preferencesPath) return;
    try {
      const prefs = new IdePreferences(this.preferencesPath);
      const current = await prefs.load();
      const updated = {
        ...current,
        clineAuth: {
          accessToken: '',
          refreshToken: '',
          expiresAt: 0,
          accountId: '',
          email: '',
          providerMetadata: {}
        }
      };
      await prefs.save(updated, { preserveClineAuth:false });
      this._notifyPersisted(updated.clineAuth);
    } catch (error) {
      this._persisted = true;
      this.lastError = 'Could not clear persisted Cline credentials: ' + (error?.message || String(error));
      throw new Error(this.lastError);
    }
  }
}

module.exports = { ClineAuthSession };
