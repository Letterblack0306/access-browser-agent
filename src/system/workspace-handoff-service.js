'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { BirdEyeRequestClient } = require('./birdeye-request-client');

const execFileAsync = promisify(execFile);

class WorkspaceHandoffService {
  constructor(options = {}) {
    this.stateRoot = path.resolve(options.stateRoot || path.join(process.cwd(), '.access-browser-agent'));
    this.targetRepository = options.targetRepository || process.env.ACCESS_BROWSER_AGENT_BIRDEYE_REPOSITORY || 'Letterblack0306/Letterblack_BirdEye';
    this.latestStatePath = path.join(this.stateRoot, 'birdeye-handoffs', 'latest-request.json');
    this.client = options.client || new BirdEyeRequestClient({
      repository: this.targetRepository,
      branch: options.targetBranch,
      workspaceId: options.workspaceId,
      validationProfile: options.validationProfile,
    });
  }

  async create(workspaceRoot) {
    const root = path.resolve(workspaceRoot);
    const [topLevel, headSha, baseSha, branch, status, diff] = await Promise.all([
      this.git(root, ['rev-parse', '--show-toplevel']),
      this.git(root, ['rev-parse', 'HEAD']),
      this.resolveBaseSha(root),
      this.git(root, ['branch', '--show-current']),
      this.git(root, ['status', '--short', '--untracked-files=all']),
      this.git(root, ['diff', '--binary', '--no-ext-diff', 'HEAD'])
    ]);

    if (path.resolve(topLevel) !== root) {
      throw new Error('Selected workspace must be the Git repository root before sending to BirdEye.');
    }

    const createdAt = new Date().toISOString();
    const handoffId = crypto.randomUUID();
    const payload = {
      schemaVersion: 1,
      handoffId,
      createdAt,
      target: {
        repository: this.targetRepository,
        purpose: 'workspace_sha_diff_inspection'
      },
      workspace: {
        root,
        repositoryName: path.basename(root),
        branch: branch || null,
        baseSha,
        headSha,
        dirty: Boolean(status.trim()),
        status
      },
      diff: {
        format: 'git-binary-diff',
        sha256: crypto.createHash('sha256').update(diff, 'utf8').digest('hex'),
        bytes: Buffer.byteLength(diff, 'utf8'),
        content: diff
      }
    };

    const directory = path.join(this.stateRoot, 'birdeye-handoffs');
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `${handoffId}.json`);
    const temporary = `${filePath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, filePath);

    const local = {
      handoffId,
      filePath,
      targetRepository: this.targetRepository,
      baseSha,
      headSha,
      diffSha256: payload.diff.sha256,
      diffBytes: payload.diff.bytes,
      dirty: payload.workspace.dirty
    };

    try {
      const queued = await this.client.enqueue(local);
      const result = {
        ok: true,
        state: 'queued',
        localCreated: true,
        ...local,
        requestId: queued.requestId,
        requestPath: queued.requestPath,
        birdEyeRepository: queued.repository,
        birdEyeBranch: queued.branch,
        workspaceId: queued.workspaceId,
        expiresAt: queued.expiresAt,
      };
      await this.writeLatestState({
        schemaVersion: 1,
        requestId: result.requestId,
        handoffId,
        workspaceRoot: root,
        state: result.state,
        createdAt,
        expiresAt: result.expiresAt,
        repository: result.birdEyeRepository,
        branch: result.birdEyeBranch,
        workspaceId: result.workspaceId,
      });
      return result;
    } catch (error) {
      const result = {
        ok: false,
        state: 'local_created',
        localCreated: true,
        ...local,
        error: error?.message || String(error),
        code: error?.code || 'BIRDEYE_QUEUE_FAILED',
      };
      await this.writeLatestState({
        schemaVersion: 1,
        requestId: null,
        handoffId,
        workspaceRoot: root,
        state: result.state,
        createdAt,
        error: result.error,
        code: result.code,
      });
      return result;
    }
  }

  async status(requestId) {
    const id = String(requestId || '').trim();
    try {
      if (!id) return this.latestStatus();
      const result = await this.client.status(id);
      const latest = await this.readLatestState();
      if (latest?.requestId === id) {
        await this.writeLatestState({ ...latest, ...this.statusProjection(result), checkedAt: new Date().toISOString() });
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        state: 'status_failed',
        requestId: id || null,
        error: error?.message || String(error),
        code: error?.code || 'BIRDEYE_STATUS_FAILED',
      };
    }
  }

  async latestStatus() {
    const latest = await this.readLatestState();
    if (!latest) {
      return { ok: true, state: 'idle', requestId: null, received: false, indexed: false, responseAvailable: false };
    }
    if (!latest.requestId) {
      return {
        ok: latest.state !== 'local_created',
        ...latest,
        received: false,
        indexed: false,
        responseAvailable: false,
      };
    }
    try {
      const remote = await this.client.status(latest.requestId);
      const projected = { ...latest, ...this.statusProjection(remote), checkedAt: new Date().toISOString() };
      await this.writeLatestState(projected);
      return { ...remote, handoffId: latest.handoffId || null, workspaceId: latest.workspaceId || remote.workspaceId || null };
    } catch (error) {
      return {
        ok: false,
        state: 'status_failed',
        requestId: latest.requestId,
        handoffId: latest.handoffId || null,
        error: error?.message || String(error),
        code: error?.code || 'BIRDEYE_STATUS_FAILED',
      };
    }
  }

  statusProjection(result = {}) {
    return {
      state: result.state || 'unknown',
      received: result.received === true,
      indexed: result.indexed === true,
      responseAvailable: result.responseAvailable === true,
      machineId: result.machineId || null,
      verdict: result.verdict || null,
      completedAt: result.completedAt || null,
      error: result.error || null,
    };
  }

  async readLatestState() {
    try {
      const raw = await fs.readFile(this.latestStatePath, 'utf8');
      const value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : null;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeLatestState(value) {
    await fs.mkdir(path.dirname(this.latestStatePath), { recursive: true });
    const temporary = `${this.latestStatePath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, this.latestStatePath);
  }

  async resolveBaseSha(root) {
    for (const candidate of ['@{upstream}', 'origin/HEAD', 'HEAD']) {
      try {
        return await this.git(root, ['merge-base', 'HEAD', candidate]);
      } catch {
        // Continue to the next deterministic fallback.
      }
    }
    return this.git(root, ['rev-parse', 'HEAD']);
  }

  async git(cwd, args) {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    });
    return String(stdout || '').trimEnd();
  }
}

module.exports = { WorkspaceHandoffService };
