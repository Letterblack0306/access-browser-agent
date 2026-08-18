'use strict';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function localUrl(value, label) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error(`${label} must be a valid local HTTP URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${label} must use a loopback HTTP URL.`);
  }
  return url;
}

function withPath(base, pathName) {
  const url = new URL(base.toString());
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${pathName.replace(/^\/+/, '')}`;
  url.search = '';
  url.hash = '';
  return url;
}

class LocalRuntimeDiagnostics {
  constructor(options = {}) {
    this.fetch = options.fetch || global.fetch;
  }

  async listModels(baseUrl) {
    const base = localUrl(baseUrl, 'LM Studio base URL');
    const response = await this.fetch(withPath(base, 'models'), {
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`LM Studio responded ${response.status}.`);
    const models = Array.isArray(payload?.data)
      ? payload.data
      : (Array.isArray(payload?.models) ? payload.models : []);
    return [...new Set(models
      .map(model => String(model?.id || model?.key || '').trim())
      .filter(Boolean))]
      .sort();
  }
}

module.exports = { LocalRuntimeDiagnostics, localUrl, withPath };
