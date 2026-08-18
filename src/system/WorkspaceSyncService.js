'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_INTERVAL_MS = 1200;
const MAX_LOGS = 500;
const DEFAULT_EXCLUDES = [
  '.git/**',
  'node_modules/**',
  '.gpt-sync/**',
  '.audit/**',
];

class WorkspaceSyncService {
  constructor({ sourceRoot, configPath, onLog, intervalMs } = {}) {
    this.sourceRoot = path.resolve(sourceRoot || process.cwd());
    this.configPath = configPath ? path.resolve(configPath) : null;
    this.onLog = typeof onLog === 'function' ? onLog : () => {};
    this.intervalMs = Number.isFinite(intervalMs) && intervalMs >= 250
      ? Math.floor(intervalMs)
      : DEFAULT_INTERVAL_MS;
    this.running = false;
    this.phase = 'STOPPED';
    this.lastError = null;
    this.startedAt = null;
    this.lastSyncAt = null;
    this._timer = null;
    this._busy = false;
    this._inventory = new Map();
    this._logs = [];
    this._sequence = 0;
    this.config = this._loadConfig();
  }

  setSourceRoot(root) {
    const next = path.resolve(String(root || '').trim() || process.cwd());
    if (next === this.sourceRoot) return;
    this.sourceRoot = next;
    this._inventory.clear();
    this._log('info', 'source.changed', `Source workspace changed to ${next}`);
  }

  getStatus() {
    return {
      ok: true,
      running: this.running,
      phase: this.phase,
      sourceRoot: this.sourceRoot,
      destinationRoot: this.config.destinationRoot,
      excludes: [...this.config.excludes],
      deleteRemoved: this.config.deleteRemoved,
      intervalMs: this.intervalMs,
      startedAt: this.startedAt,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      trackedFiles: this._inventory.size,
      latestSequence: this._sequence,
    };
  }

  getLogs(after = 0, limit = 200) {
    const cursor = Number(after) || 0;
    const safeLimit = Math.max(1, Math.min(MAX_LOGS, Number(limit) || 200));
    return {
      ok: true,
      logs: this._logs.filter(item => item.sequence > cursor).slice(-safeLimit),
      latestSequence: this._sequence,
    };
  }

  configure(input = {}) {
    if (this.running) {
      return { ok: false, code: 'SYNC_RUNNING', error: 'Stop W_sync before changing its configuration.' };
    }
    const destinationRoot = String(input.destinationRoot || '').trim();
    if (!destinationRoot) {
      return { ok: false, code: 'DESTINATION_REQUIRED', error: 'Destination folder is required.' };
    }
    const resolvedDestination = path.resolve(destinationRoot);
    const relation = validateRootRelationship(this.sourceRoot, resolvedDestination);
    if (!relation.ok) return relation;

    const excludes = normalizeExcludes(input.excludes);
    this.config = {
      destinationRoot: resolvedDestination,
      excludes,
      deleteRemoved: input.deleteRemoved === true,
    };
    this._saveConfig();
    this._inventory.clear();
    this._log('info', 'config.saved', `Destination configured: ${resolvedDestination}`);
    return this.getStatus();
  }

  async start(input = {}) {
    if (this.running) return { ...this.getStatus(), alreadyRunning: true };
    if (input && Object.keys(input).length) {
      const configured = this.configure(input);
      if (configured.ok === false) return configured;
    }
    if (!fs.existsSync(this.sourceRoot) || !fs.statSync(this.sourceRoot).isDirectory()) {
      return { ok: false, code: 'SOURCE_INVALID', error: `Source workspace does not exist: ${this.sourceRoot}` };
    }
    if (!this.config.destinationRoot) {
      return { ok: false, code: 'DESTINATION_REQUIRED', error: 'Configure a destination folder before starting W_sync.' };
    }
    const relation = validateRootRelationship(this.sourceRoot, this.config.destinationRoot);
    if (!relation.ok) return relation;

    fs.mkdirSync(this.config.destinationRoot, { recursive: true });
    this.running = true;
    this.phase = 'STARTING';
    this.startedAt = new Date().toISOString();
    this.lastError = null;
    this._log('info', 'sync.started', `Watching ${this.sourceRoot}`);

    try {
      await this._syncOnce(true);
      this.phase = 'WATCHING';
      this._schedule();
      return this.getStatus();
    } catch (error) {
      this.running = false;
      this.phase = 'FAILED';
      this.lastError = error?.message || String(error);
      this._log('error', 'sync.failed', this.lastError);
      return { ...this.getStatus(), ok: false, error: this.lastError };
    }
  }

  async stop(reason = 'Stopped by user') {
    const wasRunning = this.running;
    this.running = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this.phase = 'STOPPED';
    this._log('info', 'sync.stopped', reason);
    return { ...this.getStatus(), stopped: wasRunning };
  }

  async syncNow() {
    if (this._busy) return { ...this.getStatus(), skipped: true };
    try {
      await this._syncOnce(this._inventory.size === 0);
      return this.getStatus();
    } catch (error) {
      this.lastError = error?.message || String(error);
      this.phase = 'FAILED';
      this._log('error', 'sync.failed', this.lastError);
      return { ...this.getStatus(), ok: false, error: this.lastError };
    }
  }

  _schedule() {
    if (!this.running) return;
    this._timer = setTimeout(async () => {
      await this.syncNow();
      if (this.running && this.phase !== 'FAILED') {
        this.phase = 'WATCHING';
        this._schedule();
      }
    }, this.intervalMs);
    this._timer.unref?.();
  }

  async _syncOnce(initial) {
    this._busy = true;
    this.phase = initial ? 'CLONING' : 'SYNCING';
    try {
      const next = await buildInventory(this.sourceRoot, this.config.excludes);
      let copied = 0;
      let removed = 0;

      for (const [relativePath, record] of next) {
        const previous = this._inventory.get(relativePath);
        if (!previous || previous.size !== record.size || previous.mtimeMs !== record.mtimeMs) {
          const destination = safeDestination(this.config.destinationRoot, relativePath);
          await fs.promises.mkdir(path.dirname(destination), { recursive: true });
          await fs.promises.copyFile(record.absolutePath, destination);
          copied += 1;
          this._log('info', previous ? 'file.updated' : 'file.copied', relativePath);
        }
      }

      for (const relativePath of this._inventory.keys()) {
        if (next.has(relativePath)) continue;
        if (this.config.deleteRemoved) {
          const destination = safeDestination(this.config.destinationRoot, relativePath);
          await fs.promises.rm(destination, { force: true });
          removed += 1;
          this._log('warn', 'file.removed', relativePath);
        } else {
          this._log('info', 'file.source_removed', `${relativePath} (destination retained)`);
        }
      }

      this._inventory = next;
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      this.phase = this.running ? 'WATCHING' : 'STOPPED';
      if (initial || copied || removed) {
        this._log('info', 'sync.completed', `copied=${copied} removed=${removed} tracked=${next.size}`);
      }
    } finally {
      this._busy = false;
    }
  }

  _loadConfig() {
    const fallback = { destinationRoot: '', excludes: [...DEFAULT_EXCLUDES], deleteRemoved: false };
    if (!this.configPath) return fallback;
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return {
        destinationRoot: String(raw.destinationRoot || '').trim(),
        excludes: normalizeExcludes(raw.excludes),
        deleteRemoved: raw.deleteRemoved === true,
      };
    } catch {
      return fallback;
    }
  }

  _saveConfig() {
    if (!this.configPath) return;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temp = `${this.configPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, JSON.stringify(this.config, null, 2), 'utf8');
    fs.renameSync(temp, this.configPath);
  }

  _log(level, type, message) {
    const entry = {
      sequence: ++this._sequence,
      timestamp: new Date().toISOString(),
      level,
      type,
      message: String(message || ''),
    };
    this._logs.push(entry);
    if (this._logs.length > MAX_LOGS) this._logs.splice(0, this._logs.length - MAX_LOGS);
    this.onLog(entry);
  }
}

async function buildInventory(root, excludes) {
  const result = new Map();
  async function visit(directory, relativeDirectory = '') {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = normalizeRelative(path.join(relativeDirectory, entry.name));
      const directoryKey = entry.isDirectory() ? `${relativePath}/` : relativePath;
      if (isExcluded(directoryKey, excludes)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(absolutePath);
        result.set(relativePath, { absolutePath, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) });
      }
    }
  }
  await visit(root);
  return result;
}

function normalizeExcludes(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/\r?\n|,/g);
  return [...new Set([...DEFAULT_EXCLUDES, ...items]
    .map(item => String(item || '').trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean))];
}

function normalizeRelative(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isExcluded(relativePath, patterns) {
  const value = normalizeRelative(relativePath);
  return patterns.some(pattern => globToRegExp(pattern).test(value));
}

const globCache = new Map();
function globToRegExp(pattern) {
  const key = String(pattern || '');
  if (globCache.has(key)) return globCache.get(key);
  const escaped = key.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§DOUBLESTAR§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§DOUBLESTAR§§/g, '.*')
    .replace(/\?/g, '[^/]');
  const regex = new RegExp(`^(?:${escaped})(?:$|/)`, 'i');
  globCache.set(key, regex);
  return regex;
}

function validateRootRelationship(sourceRoot, destinationRoot) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  if (source === destination) {
    return { ok: false, code: 'SYNC_ROOT_COLLISION', error: 'Destination must be different from the source workspace.' };
  }
  const sourcePrefix = `${source}${path.sep}`.toLowerCase();
  const destinationPrefix = `${destination}${path.sep}`.toLowerCase();
  if (destinationPrefix.startsWith(sourcePrefix)) {
    return { ok: false, code: 'DESTINATION_INSIDE_SOURCE', error: 'Destination cannot be inside the source workspace.' };
  }
  if (sourcePrefix.startsWith(destinationPrefix)) {
    return { ok: false, code: 'SOURCE_INSIDE_DESTINATION', error: 'Source workspace cannot be inside the destination.' };
  }
  return { ok: true };
}

function safeDestination(root, relativePath) {
  const base = path.resolve(root);
  const candidate = path.resolve(base, relativePath);
  if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Unsafe sync path: ${relativePath}`);
  }
  return candidate;
}

module.exports = WorkspaceSyncService;
module.exports.DEFAULT_EXCLUDES = DEFAULT_EXCLUDES;
module.exports.buildInventory = buildInventory;
module.exports.normalizeExcludes = normalizeExcludes;
module.exports.validateRootRelationship = validateRootRelationship;
