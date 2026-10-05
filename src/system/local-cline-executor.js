'use strict';

const { execFile: execFileCb } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

function clampTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 600000;
  return Math.min(3600000, Math.max(10000, Math.trunc(n)));
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim() || 'http://127.0.0.1:1234/v1';
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('LM Studio base URL must use HTTP(S).');
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    const error = new Error('Local Cline execution requires a loopback LM Studio endpoint.');
    error.code = 'LM_STUDIO_NOT_LOOPBACK';
    throw error;
  }
  return url.toString().replace(/\/+$/u, '');
}

function modelsUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
}

function uniqueModels(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.models) ? payload.models : []);
  return [...new Set(rows.map(item => String(item?.id || item?.key || '').trim()).filter(Boolean))].sort();
}

function extractJsonEvents(stdout) {
  const events = [];
  for (const line of String(stdout || '').split(/\r?\n/u)) {
    const text = line.trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) continue;
    try { events.push(JSON.parse(text)); } catch {}
  }
  return events.slice(-200);
}

class LocalClineExecutor {
  constructor({
    workspaceRoot,
    getSettings = () => ({}),
    execFile = promisify(execFileCb),
    fetch = global.fetch,
    maxOutputBytes = 256 * 1024,
  } = {}) {
    if (!workspaceRoot) throw new Error('LocalClineExecutor requires workspaceRoot.');
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.getSettings = typeof getSettings === 'function' ? getSettings : () => ({});
    this.execFile = execFile;
    this.fetch = fetch;
    this.maxOutputBytes = Math.max(8192, Number(maxOutputBytes) || 256 * 1024);
  }

  settings() {
    const settings = this.getSettings() || {};
    return {
      executable: String(settings.clineExecutable || 'cline').trim() || 'cline',
      baseUrl: normalizeBaseUrl(settings.lmStudioBaseUrl),
      model: String(settings.lmStudioModel || '').trim(),
      autoApprove: settings.clineLocalAutoApprove !== false,
    };
  }

  async status() {
    const cfg = this.settings();
    const result = {
      ok: false,
      workspaceRoot: this.workspaceRoot,
      cline: { available:false, executable:cfg.executable, version:null, error:null },
      lmStudio: { reachable:false, baseUrl:cfg.baseUrl, model:cfg.model || null, modelAvailable:false, models:[], error:null },
      ready: false,
    };

    try {
      const version = await this.execFile(cfg.executable, ['--version'], {
        cwd: this.workspaceRoot,
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      result.cline.available = true;
      result.cline.version = String(version?.stdout || version?.stderr || '').trim() || null;
    } catch (error) {
      result.cline.error = String(error?.message || error);
    }

    try {
      const response = await this.fetch(modelsUrl(cfg.baseUrl), { headers:{ Accept:'application/json' } });
      const text = await response.text();
      if (!response.ok) throw new Error(`LM Studio responded ${response.status}: ${text.slice(0,500)}`);
      const payload = JSON.parse(text);
      result.lmStudio.models = uniqueModels(payload);
      result.lmStudio.reachable = true;
      result.lmStudio.modelAvailable = Boolean(cfg.model && result.lmStudio.models.includes(cfg.model));
      if (!cfg.model) result.lmStudio.error = 'No LM Studio model is selected.';
      else if (!result.lmStudio.modelAvailable) result.lmStudio.error = `Selected model is not available from LM Studio: ${cfg.model}`;
    } catch (error) {
      result.lmStudio.error = String(error?.message || error);
    }

    result.ready = result.cline.available && result.lmStudio.reachable && result.lmStudio.modelAvailable;
    result.ok = result.ready;
    return result;
  }

  async execute({ task, acceptance = [], timeoutMs } = {}) {
    const objective = String(task || '').trim();
    if (!objective) return { ok:false, code:'CLINE_TASK_REQUIRED', error:'Cline task is required.' };

    const preflight = await this.status();
    if (!preflight.ready) {
      return { ok:false, code:'CLINE_LOCAL_PREFLIGHT_FAILED', error:'Local Cline + LM Studio preflight failed.', preflight };
    }

    const cfg = this.settings();
    const timeout = clampTimeoutMs(timeoutMs);
    const acceptanceLines = (Array.isArray(acceptance) ? acceptance : [])
      .map(item => String(item || '').trim()).filter(Boolean).slice(0,20);
    const prompt = [
      'You are a bounded coding executor invoked by Access Browser Agent.',
      `Workspace: ${this.workspaceRoot}`,
      `Use the already-configured local LM Studio provider and model: ${cfg.model}.`,
      'Do not change provider configuration. Do not operate outside this workspace.',
      'Inspect before editing. Make only changes required for the task. Run relevant local checks before returning.',
      '',
      'TASK:',
      objective,
      acceptanceLines.length ? '' : null,
      acceptanceLines.length ? 'ACCEPTANCE:' : null,
      ...acceptanceLines.map((item, index) => `${index + 1}. ${item}`),
    ].filter(value => value !== null).join('\n');

    const seconds = Math.max(10, Math.ceil(timeout / 1000));
    const args = ['--json', '--auto-approve', cfg.autoApprove ? 'true' : 'false', '--model', cfg.model, '--timeout', String(seconds), prompt];

    let commandResult;
    try {
      commandResult = await this.execFile(cfg.executable, args, {
        cwd: this.workspaceRoot,
        windowsHide: true,
        timeout: timeout + 5000,
        maxBuffer: this.maxOutputBytes,
      });
    } catch (error) {
      return {
        ok:false,
        code:String(error?.code || 'CLINE_EXECUTION_FAILED'),
        error:String(error?.message || error),
        cwd:this.workspaceRoot,
        executable:cfg.executable,
        model:cfg.model,
        stdout:String(error?.stdout || '').slice(-this.maxOutputBytes),
        stderr:String(error?.stderr || '').slice(-this.maxOutputBytes),
        exitCode:Number.isInteger(error?.code) ? error.code : null,
        preflight,
      };
    }

    const stdout = String(commandResult?.stdout || '').slice(-this.maxOutputBytes);
    const stderr = String(commandResult?.stderr || '').slice(-this.maxOutputBytes);
    let gitStatus = '';
    try {
      const git = await this.execFile('git', ['status', '--short'], {
        cwd:this.workspaceRoot, windowsHide:true, timeout:10000, maxBuffer:1024*1024,
      });
      gitStatus = String(git?.stdout || '').trim();
    } catch {}

    return {
      ok:true,
      cwd:this.workspaceRoot,
      executable:cfg.executable,
      model:cfg.model,
      exitCode:0,
      stdout,
      stderr,
      events:extractJsonEvents(stdout),
      gitStatusAfter:gitStatus,
      preflight,
      verificationRequired:true,
      message:'Cline completed. Independently inspect the diff/tests/browser state before claiming task completion.',
    };
  }
}

module.exports = { LocalClineExecutor, clampTimeoutMs, normalizeBaseUrl, modelsUrl, uniqueModels, extractJsonEvents };
