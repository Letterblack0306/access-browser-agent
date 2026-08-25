'use strict';

const chokidar = require('chokidar');
const path = require('node:path');
const { emitDiagnostic } = require('./runtime-diagnostic-bus');

const DEFAULT_IGNORED = /(^|[\\/])(\.git|node_modules|dist|build|out|coverage|agent-state)([\\/]|$)|(^|[\\/])\./u;

function normalizeWatchPathsLocal(value) {
  const source = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? ['.'] : [value];
  const paths = source.map(item => String(item || '').trim()).filter(Boolean);
  return paths.length ? [...new Set(paths)] : ['.'];
}

class AutoPlanService {
  constructor({
    workspaceRoot,
    watchPaths = [],
    getAgentRuntime,
    getPrompt,
    onTrigger,
    debounceMs = 500,
  } = {}) {
    this.workspaceRoot = workspaceRoot ? path.resolve(workspaceRoot) : '';
    this.watchPaths = normalizeWatchPathsLocal(watchPaths);
    this.getAgentRuntime = typeof getAgentRuntime === 'function' ? getAgentRuntime : () => null;
    this.getPrompt = typeof getPrompt === 'function' ? getPrompt : () => '';
    this.onTrigger = onTrigger || (() => {});
    this.debounceMs = Math.max(100, Number(debounceMs) || 500);
    this.enabled = false;
    this.running = false;
    this.ready = Promise.resolve();
    this.watcher = null;
    this.debounceTimer = null;
    this.pendingPaths = [];
  }

  setWorkspaceRoot(root) {
    const next = root ? path.resolve(root) : '';
    if (next === this.workspaceRoot) return;
    this.workspaceRoot = next;
    if (this.enabled) {
      this.disable();
      this.enable();
    }
  }

  enable() {
    if (this.enabled) return;
    if (!this.workspaceRoot) {
      emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'enable', phase:'failed', severity:'error', data:{ error:'No workspace root set' } });
      throw new Error('Auto-Plan requires a workspace root.');
    }
    try {
      this.watcher = chokidar.watch(this.watchTargets(), {
        ignored: DEFAULT_IGNORED,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      });
      this.watcher.on('change', target => this._onChange(target));
      this.watcher.on('add', target => this._onChange(target));
      this.watcher.on('unlink', target => this._onChange(target));
      this.watcher.on('error', error => emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'watch', phase:'failed', severity:'error', data:{ error:error?.message || String(error) } }));
      this.enabled = true;
      this.ready = new Promise(resolve => this.watcher.once('ready', resolve));
      emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'enable', phase:'success', data:{ workspaceRoot:this.workspaceRoot, watchPaths:this.watchPaths } });
    } catch (error) {
      this.watcher = null;
      emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'enable', phase:'failed', severity:'error', data:{ error:error?.message || String(error) } });
      throw error;
    }
  }

  disable() {
    if (this.watcher) {
      this.watcher.close().catch(() => {});
      this.watcher = null;
    }
    this.enabled = false;
    this.ready = Promise.resolve();
    this.pendingPaths = [];
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'disable', phase:'success' });
  }

  watchTargets() {
    if (!this.workspaceRoot) return [];
    return this.watchPaths.map(item => path.resolve(this.workspaceRoot, item));
  }

  _onChange(target) {
    if (!this.enabled) return;
    this.pendingPaths.push(String(target));
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const paths = [...this.pendingPaths];
      this.pendingPaths = [];
      this.debounceTimer = null;
      this._trigger(paths);
    }, this.debounceMs);
  }

  async _trigger(paths) {
    if (this.running) {
      emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'trigger', phase:'skipped', severity:'warn', data:{ reason:'A previous auto-plan run is still active.', paths } });
      return;
    }
    const runtime = this.getAgentRuntime();
    if (!runtime || typeof runtime.run !== 'function') {
      emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'trigger', phase:'failed', severity:'error', data:{ error:'Agent runtime unavailable' } });
      this.onTrigger({ ok:false, error:new Error('Agent runtime unavailable.'), paths });
      return;
    }
    const prompt = String(this.getPrompt() || '').trim();
    if (!prompt) {
      emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'trigger', phase:'skipped', severity:'warn', data:{ reason:'Prompt empty', paths } });
      return;
    }
    const fileList = paths.map(item => `- ${item}`).join('\n');
    const instruction = `${prompt}\n\nChanged files:\n${fileList}`;
    emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'trigger', phase:'start', data:{ paths } });
    this.running = true;
    try {
      const result = await runtime.run({ instruction, source:'auto-plan' });
      this.onTrigger({ ok:true, result, paths });
      emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'trigger', phase:'success', data:{ paths, summary:result?.summary || result?.text || null } });
    } catch (error) {
      this.onTrigger({ ok:false, error, paths });
      emitDiagnostic({ source:'auto-plan', category:'auto-plan', action:'trigger', phase:'failed', severity:'error', data:{ paths, error:error?.message || String(error) }, error });
    } finally {
      this.running = false;
    }
  }

  status() {
    return {
      enabled:this.enabled,
      watching:Boolean(this.enabled && this.watcher),
      running:this.running,
      workspaceRoot:this.workspaceRoot,
      watchPaths:[...this.watchPaths],
      pendingPaths:[...this.pendingPaths],
    };
  }
}

module.exports = { AutoPlanService };
