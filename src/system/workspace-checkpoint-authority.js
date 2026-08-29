'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const execFileAsync = promisify(execFile);

const CHECKPOINT_DIR = '.gpt-sync';
const CHECKPOINT_REPO = 'checkpoint-shadow';
const MAX_CHECKPOINTS = 50;

class WorkspaceCheckpointAuthority {
  constructor({ workspaceRoot } = {}) {
    if (!workspaceRoot) throw new Error('workspaceRoot is required');
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.shadowRoot = path.join(this.workspaceRoot, CHECKPOINT_DIR, CHECKPOINT_REPO);
    this._initialized = false;
    this._initPromise = null;
  }

  async ensure() {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doEnsure();
    try { await this._initPromise; } finally { this._initPromise = null; }
  }

  async _doEnsure() {
    if (this._initialized) return;
    await fs.mkdir(this.shadowRoot, { recursive: true });
    const gitDir = path.join(this.shadowRoot, '.git');
    try {
      await fs.access(gitDir);
    } catch {
      await this._git(['init'], this.shadowRoot);
      await this._git(['config', 'user.email', 'checkpoint@access-agent.local'], this.shadowRoot);
      await this._git(['config', 'user.name', 'Access Agent Checkpoints'], this.shadowRoot);
      await this._git(['config', 'core.autocrlf', 'false'], this.shadowRoot);
    }
    this._initialized = true;
  }

  async create({ stepId, toolName, reason = '' } = {}) {
    await this.ensure();
    const checkpointId = `cp-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const message = `checkpoint:${checkpointId}:${stepId || 'unknown'}:${toolName || 'manual'}${reason ? ` — ${reason}` : ''}`;
    await this._syncWorkspaceToShadow();
    await this._git(['add', '-A'], this.shadowRoot);
    const { stdout: statusOut } = await this._git(['status', '--porcelain'], this.shadowRoot);
    if (!statusOut.trim()) {
      return { ok: true, checkpointId, stepId, toolName, changed: false, message: 'No file changes to checkpoint.' };
    }
    await this._git(['commit', '-m', message, '--allow-empty-message'], this.shadowRoot);
    const { stdout: shaOut } = await this._git(['rev-parse', 'HEAD'], this.shadowRoot);
    const sha = shaOut.trim();
    await this._pruneOldCheckpoints();
    return { ok: true, checkpointId, sha, stepId, toolName, changed: true, message };
  }

  async list({ limit = MAX_CHECKPOINTS } = {}) {
    await this.ensure();
    try {
      const { stdout } = await this._git(
        ['log', '--oneline', '--format=%H|%s|%aI', `-${Math.min(limit, MAX_CHECKPOINTS)}`],
        this.shadowRoot
      );
      const entries = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [sha, subject, timestamp] = line.split('|');
        const parts = String(subject || '').split(':');
        return { sha, checkpointId: parts[1] || null, stepId: parts[2] || null, toolName: parts[3] || null, timestamp, subject };
      });
      return { ok: true, checkpoints: entries };
    } catch { return { ok: true, checkpoints: [] }; }
  }

  /**
   * Roll back the workspace to a prior checkpoint (shadow git restore).
   * @param {string} checkpointId - A checkpointId (cp-...) or a full commit sha.
   * @returns {{ok:boolean, restored:boolean, sha?:string|null, error?:string}}
   */
  async restore({ checkpointId }) {
    if (!checkpointId) {
      return { ok: false, restored: false, error: 'checkpointId is required' };
    }
    await this.ensure();
    const target = await this._resolveCheckpoint(checkpointId);
    if (!target) {
      return { ok: false, restored: false, checkpointId, error: `Checkpoint not found: ${checkpointId}` };
    }
    try {
      await this._git(['reset', '--hard', target], this.shadowRoot);
      await this._git(['clean', '-fdx'], this.shadowRoot);
      await this._copyWorkingTree(this.shadowRoot, this.workspaceRoot);
      return { ok: true, restored: true, checkpointId, sha: target };
    } catch (err) {
      return { ok: false, restored: false, checkpointId, error: err && err.message ? err.message : String(err) };
    }
  }

  /**
   * Resolve a human checkpointId (cp-...) or a sha into a full commit hash, by
   * grepping commit subjects for the checkpoint marker, or via rev-parse.
   *
   * Strategy:
   * - Raw hex SHA (7-40 chars, no prefix): try rev-parse directly.
   * - Human checkpoint ID (cp-...) or arbitrary string: always search commit
   *   subjects for the matching checkpoint marker, then verify with rev-parse.
   *   Note: cp-... IDs are NOT git objects and cannot be resolved via
   *   rev-parse — they are stored as commit message text only.
   */
  async _resolveCheckpoint(checkpointId) {
    // Case 1: checkpointId is a raw hex SHA (7-40 chars, no prefix).
    // Try rev-parse directly; this is the fastest path for SHA arguments.
    if (/^[a-f0-9]{7,40}$/i.test(checkpointId)) {
      try {
        const { stdout } = await this._git(['rev-parse', `${checkpointId}^{commit}`], this.shadowRoot);
        return stdout.trim() || null;
      } catch { return null; }
    }

    // Case 2: checkpointId is a human checkpoint ID (cp-...) or arbitrary string.
    // Always search commit subjects; cp-... IDs are commit-message-only.
    const { stdout } = await this._git(
      ['log', '--all', '--format=%H|%s', '-1000'],
      this.shadowRoot
    );
    const line = String(stdout).split('\n').find(l => l.includes(`checkpoint:${checkpointId}:`));
    if (!line) return null;
    const sha = line.split('|')[0].trim();
    // Verify the resolved SHA exists (defensive — rev-parse validates the object).
    try {
      await this._git(['rev-parse', `${sha}^{commit}`], this.shadowRoot);
    } catch { return null; }
    return sha;
  }

  async _syncWorkspaceToShadow() {
    await fs.mkdir(this.shadowRoot, { recursive: true });
    const ignore = new Set([
      CHECKPOINT_DIR, 'node_modules', '.git', 'dist', 'build', '.next', '.cache', '.DS_Store', 'Thumbs.db'
    ]);
    const gitignorePatterns = await this._readGitignore();
    await this._wipeWorkingTree(this.shadowRoot);
    await this._copyWorkingTree(this.workspaceRoot, this.shadowRoot, {
      ignore, gitignorePatterns,
      base: this.workspaceRoot,
      nestedShadow: this.shadowRoot,
    });
  }

  async _readGitignore() {
    const p = path.join(this.workspaceRoot, '.gitignore');
    try {
      const raw = await fs.readFile(p, 'utf8');
      return String(raw).split('\n').map(l => l.trim()).filter(Boolean);
    } catch { return []; }
  }

  async _pruneOldCheckpoints() {
    try {
      const { stdout } = await this._git(['rev-list', '--count', 'HEAD'], this.shadowRoot);
      const count = parseInt(String(stdout).trim(), 10) || 0;
      if (count <= MAX_CHECKPOINTS) return;
      const { stdout: oldestOut } = await this._git(
        ['rev-list', '--max-parents=0', '--reverse', 'HEAD'],
        this.shadowRoot
      );
      const commits = String(oldestOut).trim().split('\n').filter(Boolean);
      const excess = count - MAX_CHECKPOINTS;
      const toDrop = commits.slice(0, Math.min(excess, commits.length));
      for (const sha of toDrop) {
        try { await this._git(['rebase', '--onto', `${sha}^`, sha, 'HEAD'], this.shadowRoot); } catch { /* best-effort */ }
      }
    } catch { /* prune is best-effort */ }
  }

  async _git(args, cwd) {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd, env: process.env });
    if (stderr && !stdout) return { stdout: stderr };
    return { stdout, stderr };
  }

  async _wipeWorkingTree(root) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(root, e.name);
      if (e.name === '.git' || e.name === CHECKPOINT_DIR) continue;
      if (e.isDirectory()) await fs.rm(full, { recursive: true, force: true });
      else await fs.unlink(full).catch(() => {});
    }
  }

  async _copyWorkingTree(src, dest, opts = {}) {
    const { ignore = new Set(), gitignorePatterns = [], base = src, nestedShadow } = opts;
    const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => []);
    await fs.mkdir(dest, { recursive: true });
    for (const e of entries) {
      const s = path.join(src, e.name);
      const d = path.join(dest, e.name);
      const rel = path.relative(base, s).replace(/\\/g, '/');
      if (e.name === '.git') continue;
      if (e.name === CHECKPOINT_DIR) continue;
      if (nestedShadow && path.resolve(s) === path.resolve(nestedShadow)) continue;
      if (ignore.has(e.name)) continue;
      if (this._matchesGitignore(rel, gitignorePatterns)) continue;
      if (e.isDirectory()) {
        await this._copyWorkingTree(s, d, opts);
      } else {
        await fs.copyFile(s, d);
      }
    }
  }

  _matchesGitignore(relPath, patterns) {
    if (!patterns || !patterns.length) return false;
    for (const raw of patterns) {
      if (raw.startsWith('#')) continue;
      let pat = raw.replace(/^\//, '');
      if (pat.endsWith('/')) {
        if (relPath.startsWith(pat) || relPath.split('/').includes(pat.replace(/\/$/,''))) return true;
        continue;
      }
      if (pat.includes('*')) {
        if (this._globMatch(relPath, pat)) return true;
        continue;
      }
      if (relPath === pat || relPath.startsWith(pat + '/')) return true;
    }
    return false;
  }

  _globMatch(relPath, pattern) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\0GLOB\0')
      .replace(/\*/g, '[^/]*')
      .replace(/\0GLOB\0/g, '.*');
    try { return new RegExp(`^${escaped}$`).test(relPath); } catch { return false; }
  }
}

module.exports = { WorkspaceCheckpointAuthority };
