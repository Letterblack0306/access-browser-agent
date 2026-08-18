'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PATHEXT = Object.freeze(['.COM', '.EXE', '.BAT', '.CMD']);
const MAX_REQUESTED_EXECUTABLES = 32;

class MachineEnvironment {
  constructor({ env = process.env, platform = process.platform, arch = process.arch, access = fsp.access, existsSync = fs.existsSync, osImpl = os } = {}) {
    this.env = env || {};
    this.platform = String(platform || process.platform);
    this.arch = String(arch || process.arch);
    this.access = access;
    this.existsSync = existsSync;
    this.os = osImpl;
  }

  pathEntries() {
    const value = String(this.env.PATH || this.env.Path || this.env.path || '');
    return unique(value.split(path.delimiter).map(item => item.trim()).filter(Boolean).map(item => path.resolve(item)));
  }

  pathExts() {
    if (this.platform !== 'win32') return [''];
    const configured = String(this.env.PATHEXT || '').split(';').map(item => item.trim()).filter(Boolean);
    return unique((configured.length ? configured : DEFAULT_PATHEXT).map(item => item.startsWith('.') ? item.toUpperCase() : `.${item.toUpperCase()}`));
  }

  shellIdentity() {
    if (this.platform === 'win32') return String(this.env.ComSpec || this.env.COMSPEC || 'cmd.exe');
    return String(this.env.SHELL || '');
  }

  snapshot() {
    return {
      platform:this.platform,
      arch:this.arch,
      release:safeCall(() => this.os.release?.(), ''),
      shell:this.shellIdentity(),
      pathDelimiter:path.delimiter,
      pathEntryCount:this.pathEntries().length,
      pathExt:this.pathExts(),
      node:{ version:process.version },
    };
  }

  async resolveExecutable(name) {
    const requested = normalizeExecutableName(name);
    for (const resolved of this._candidatePaths(requested)) {
      if (await this._accessible(resolved)) {
        return { available:true, requested, resolved, kind:executableKind(resolved, this.platform), source:'PATH' };
      }
    }
    return { available:false, requested, resolved:null, kind:null, source:'PATH' };
  }

  resolveExecutableSync(name) {
    const requested = normalizeExecutableName(name);
    for (const resolved of this._candidatePaths(requested)) {
      try {
        if (this.existsSync(resolved)) return { available:true, requested, resolved, kind:executableKind(resolved, this.platform), source:'PATH' };
      } catch {}
    }
    return { available:false, requested, resolved:null, kind:null, source:'PATH' };
  }

  resolveInteractiveShellSync() {
    if (this.platform === 'win32') {
      const explicit = String(this.env.PWSH_EXE || '').trim();
      if (explicit && this.existsSync(explicit)) return { executable:path.resolve(explicit), source:'PWSH_EXE' };
      for (const name of ['pwsh','powershell']) {
        const resolved = this.resolveExecutableSync(name);
        if (resolved.available) return { executable:resolved.resolved, source:'PATH', requested:name };
      }
      const comspec = String(this.env.ComSpec || this.env.COMSPEC || '').trim();
      if (comspec && this.existsSync(comspec)) return { executable:path.resolve(comspec), source:'ComSpec' };
      return { executable:'cmd.exe', source:'platform_fallback', requested:'cmd' };
    }

    const explicit = String(this.env.SHELL || '').trim();
    if (explicit && this.existsSync(explicit)) return { executable:path.resolve(explicit), source:'SHELL' };
    for (const name of ['bash','zsh','fish','sh']) {
      const resolved = this.resolveExecutableSync(name);
      if (resolved.available) return { executable:resolved.resolved, source:'PATH', requested:name };
    }
    return { executable:'/bin/sh', source:'platform_fallback', requested:'sh' };
  }

  async inspect({ executables = [] } = {}) {
    const requested = unique((Array.isArray(executables) ? executables : []).map(String).map(item => item.trim()).filter(Boolean)).slice(0, MAX_REQUESTED_EXECUTABLES);
    const resolved = [];
    for (const name of requested) resolved.push(await this.resolveExecutable(name));
    return { ok:true, environment:this.snapshot(), executables:resolved };
  }

  _candidatePaths(requested) {
    const candidates = this._candidateNames(requested);
    return this.pathEntries().flatMap(entry => candidates.map(candidate => path.resolve(entry, candidate)));
  }

  _candidateNames(requested) {
    if (this.platform !== 'win32') return [requested];
    const extension = path.extname(requested);
    if (extension) return [requested];
    return this.pathExts().map(ext => `${requested}${ext.toLowerCase()}`);
  }

  async _accessible(file) {
    try {
      await this.access(file, this.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function normalizeExecutableName(value) {
  const name = String(value || '').trim();
  if (!name) throw Object.assign(new Error('Executable name is required.'), { code:'EXECUTABLE_REQUIRED' });
  if (name.length > 260 || path.isAbsolute(name) || name.includes('/') || name.includes('\\') || !/^[a-z0-9][a-z0-9._+-]{0,259}$/iu.test(name)) {
    throw Object.assign(new Error('Executable discovery accepts one bare executable name.'), { code:'EXECUTABLE_NAME_INVALID' });
  }
  return name;
}

function executableKind(file, platform) {
  const ext = path.extname(file).toLowerCase();
  if (platform === 'win32' && ['.cmd','.bat'].includes(ext)) return 'script-wrapper';
  if (platform === 'win32' && ['.exe','.com'].includes(ext)) return 'native';
  return 'executable';
}

function unique(items) { return [...new Set(items)]; }
function safeCall(fn, fallback) { try { return fn() ?? fallback; } catch { return fallback; } }

module.exports = { MachineEnvironment, normalizeExecutableName, executableKind, MAX_REQUESTED_EXECUTABLES };
