'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function encodePath(value) {
  return String(value || '').split('/').map(part => encodeURIComponent(part)).join('/');
}

async function defaultTokenProvider() {
  const fromEnv = String(process.env.BIRDEYE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

class BirdEyeRequestClient {
  constructor(options = {}) {
    this.fetch = options.fetch || global.fetch;
    this.repository = String(options.repository || process.env.ACCESS_BROWSER_AGENT_BIRDEYE_REPOSITORY || 'Letterblack0306/Letterblack_BirdEye').trim();
    this.branch = String(options.branch || process.env.ACCESS_BROWSER_AGENT_BIRDEYE_BRANCH || 'runtime/dev-main').trim();
    this.workspaceId = String(options.workspaceId || process.env.ACCESS_BROWSER_AGENT_BIRDEYE_WORKSPACE_ID || 'access-browser-agent').trim();
    this.validationProfile = String(options.validationProfile || process.env.ACCESS_BROWSER_AGENT_BIRDEYE_VALIDATION_PROFILE || 'default').trim();
    this.tokenProvider = options.tokenProvider || defaultTokenProvider;
    this.now = options.now || (() => new Date());
    this.ttlMs = Math.max(60_000, Number(options.ttlMs) || 15 * 60_000);
  }

  async token() {
    const token = String(await this.tokenProvider() || '').trim();
    if (!token) {
      const error = new Error('BirdEye GitHub credentials are unavailable. Set BIRDEYE_GITHUB_TOKEN or authenticate GitHub CLI.');
      error.code = 'BIRDEYE_AUTH_MISSING';
      throw error;
    }
    return token;
  }

  async request(method, path, body) {
    const token = await this.token();
    const url = `https://api.github.com/repos/${this.repository}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`;
    const response = await this.fetch(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Access-Browser-Agent-BirdEye/1',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 404) return null;
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(value?.message || `BirdEye GitHub request failed (${response.status}).`);
      error.code = 'BIRDEYE_GITHUB_ERROR';
      error.status = response.status;
      throw error;
    }
    return value;
  }

  async readJson(path) {
    const item = await this.request('GET', path);
    if (!item || typeof item !== 'object' || !item.content) return null;
    const raw = Buffer.from(String(item.content).replace(/\s+/g, ''), 'base64').toString('utf8');
    return JSON.parse(raw);
  }

  async writeJson(path, value, message) {
    const existing = await this.request('GET', path);
    const payload = {
      message,
      branch: this.branch,
      content: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8').toString('base64'),
      ...(existing?.sha ? { sha: existing.sha } : {}),
    };
    return this.request('PUT', path, payload);
  }

  async enqueue(handoff = {}) {
    const now = this.now();
    const requestId = `aba-${now.getTime()}-${String(handoff.handoffId || '').slice(0, 8) || 'handoff'}`;
    const request = {
      schemaVersion: 1,
      requestId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
      workspaceId: this.workspaceId,
      operation: 'workspace_diagnosis',
      scope: {
        validationProfile: this.validationProfile,
        handoffId: handoff.handoffId || null,
        headSha: handoff.headSha || null,
        diffSha256: handoff.diffSha256 || null,
      },
      mutationAllowed: false,
    };
    const requestPath = `requests/pending/${requestId}.json`;
    await this.writeJson(requestPath, request, `browser-agent: request BirdEye diagnosis ${requestId}`);
    return {
      ok: true,
      state: 'queued',
      requestId,
      requestPath,
      repository: this.repository,
      branch: this.branch,
      workspaceId: this.workspaceId,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    };
  }

  async responseFor(requestId) {
    const root = await this.request('GET', 'responses');
    if (!Array.isArray(root)) return null;
    for (const item of root.slice(0, 50)) {
      if (item?.type !== 'dir' || !item?.name) continue;
      const machineId = String(item.name);
      const response = await this.readJson(`responses/${machineId}/${requestId}/result.json`);
      if (response) return { machineId, response };
    }
    return null;
  }

  async status(requestId) {
    const id = String(requestId || '').trim();
    if (!id) return { ok: true, state: 'idle', requestId: null, received: false, indexed: false, responseAvailable: false };
    const found = await this.responseFor(id);
    if (!found) return { ok: true, state: 'queued', requestId: id, received: false, indexed: false, responseAvailable: false };
    const response = found.response || {};
    const failed = response.status === 'failed' || response.verdict === 'FAIL';
    return {
      ok: !failed,
      state: failed ? 'failed' : 'response_available',
      requestId: id,
      machineId: found.machineId,
      received: true,
      indexed: response?.index?.available === true,
      responseAvailable: true,
      verdict: response.verdict || null,
      completedAt: response.completedAt || null,
      error: response.error || null,
      response,
    };
  }
}

module.exports = { BirdEyeRequestClient, defaultTokenProvider, encodePath };
