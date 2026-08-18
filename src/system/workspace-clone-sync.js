'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_SYNC_EXCLUSIONS = Object.freeze(['node_modules', '.env', 'desktop.ini']);

function normalizeExclusions(input) {
  const entries = Array.isArray(input) ? input : String(input ?? '').split(/[\r\n,]+/u);
  const normalized = entries
    .map(value => String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/^\/+|\/+$/gu, ''))
    .filter(value => value && !path.isAbsolute(value) && !value.split('/').includes('..'));
  return [...new Set(normalized.map(value => value.toLowerCase()))];
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

class WorkspaceCloneSync {
  constructor({ watch = fs.watch, debounceMs = 180 } = {}) {
    this.watch = watch;
    this.debounceMs = debounceMs;
    this.watcher = null;
    this.timer = null;
    this.pending = new Set();
    this.sourceRoot = null;
    this.targetRoot = null;
    this.exclusions = [...DEFAULT_SYNC_EXCLUSIONS];
    this.running = false;
    this.lastSyncAt = null;
    this.lastEvent = null;
    this.error = null;
  }

  status() {
    return {
      running: this.running,
      sourceRoot: this.sourceRoot,
      targetRoot: this.targetRoot,
      exclusions: [...this.exclusions],
      pendingCount: this.pending.size,
      lastSyncAt: this.lastSyncAt,
      lastEvent: this.lastEvent,
      error: this.error,
    };
  }

  isExcluded(relativePath) {
    const relative = String(relativePath || '').replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '').toLowerCase();
    if (!relative) return false;
    const segments = relative.split('/');
    return this.exclusions.some(exclusion => relative === exclusion || relative.startsWith(`${exclusion}/`) || segments.includes(exclusion));
  }

  async start({ sourceRoot, targetRoot, exclusions = DEFAULT_SYNC_EXCLUSIONS } = {}) {
    const sourceText = String(sourceRoot || '').trim();
    const targetText = String(targetRoot || '').trim();
    if (!sourceText) throw new Error('Select a source workspace before starting sync.');
    if (!targetText) throw new Error('Choose a copy destination before starting sync.');

    const source = path.resolve(sourceText);
    const target = path.resolve(targetText);
    if (isWithin(source, target) || isWithin(target, source)) {
      throw new Error('The copy destination must be outside the source workspace.');
    }
    const sourceInfo = await fsp.stat(source);
    if (!sourceInfo.isDirectory()) throw new Error('The selected source workspace is not a directory.');

    this.stop();
    this.sourceRoot = source;
    this.targetRoot = target;
    this.exclusions = normalizeExclusions(exclusions);
    this.error = null;
    await fsp.mkdir(target, { recursive: true });
    await this.syncTree('');

    try {
      this.watcher = this.watch(source, { recursive: true }, (_eventType, filename) => {
        if (filename) this.queue(filename.toString());
      });
      this.watcher.on('error', error => {
        this.error = error?.message || String(error);
        this.stop();
      });
      this.running = true;
      this.lastEvent = 'Initial copy completed; watching for source changes.';
      return this.status();
    } catch (error) {
      this.error = error?.message || String(error);
      this.stop();
      throw new Error(`Could not watch the source workspace: ${this.error}`);
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    if (this.watcher) this.watcher.close();
    this.watcher = null;
    this.running = false;
    return this.status();
  }

  queue(relativePath) {
    const normalized = String(relativePath || '').replace(/\\/gu, '/');
    if (!this.running || !normalized || this.isExcluded(normalized)) return;
    this.pending.add(normalized);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(error => {
      this.error = error?.message || String(error);
    }), this.debounceMs);
  }

  async flush() {
    this.timer = null;
    const pending = [...this.pending];
    this.pending.clear();
    for (const relativePath of pending) await this.syncPath(relativePath);
  }

  async syncTree(relativePath) {
    const sourceDirectory = path.join(this.sourceRoot, relativePath);
    const entries = await fsp.readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(relativePath, entry.name);
      if (this.isExcluded(child) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await this.syncTree(child);
      else if (entry.isFile()) await this.copyFile(child);
    }
    this.lastSyncAt = new Date().toISOString();
  }

  async copyFile(relativePath) {
    const source = path.join(this.sourceRoot, relativePath);
    const target = path.join(this.targetRoot, relativePath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(source, target);
    this.lastSyncAt = new Date().toISOString();
    this.lastEvent = `Copied ${relativePath.replace(/\\/gu, '/')}`;
  }

  async syncPath(relativePath) {
    if (!this.sourceRoot || !this.targetRoot || this.isExcluded(relativePath)) return;
    const source = path.join(this.sourceRoot, relativePath);
    const target = path.join(this.targetRoot, relativePath);
    try {
      const info = await fsp.lstat(source);
      if (info.isSymbolicLink()) return;
      if (info.isDirectory()) {
        await fsp.mkdir(target, { recursive: true });
        await this.syncTree(relativePath);
      } else if (info.isFile()) {
        await this.copyFile(relativePath);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await fsp.rm(target, { recursive: true, force: true });
      this.lastSyncAt = new Date().toISOString();
      this.lastEvent = `Removed ${String(relativePath).replace(/\\/gu, '/')}`;
    }
  }
}

module.exports = { WorkspaceCloneSync, DEFAULT_SYNC_EXCLUSIONS, normalizeExclusions };
