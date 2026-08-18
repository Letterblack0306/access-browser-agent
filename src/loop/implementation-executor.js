'use strict';

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { GovernedTerminal } = require('../system/governed-terminal');

const execFileAsync = promisify(execFile);
const SAFE_OPERATIONS = new Set(['inspect_status', 'read_file', 'read_range', 'search_workspace', 'run_validation', 'read_artifact', 'apply_patch', 'run_command']);

function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }

function resolveInside(root, candidate = '.') {
  const base = path.resolve(root);
  const resolved = path.resolve(base, String(candidate || '.'));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Target path escapes the allowed working directory.');
  }
  return resolved;
}

async function atomicWrite(filePath, content) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, filePath);
}

class ImplementationExecutor {
  constructor(options = {}) {
    this.maxOutputBytes = Math.max(1024, Number(options.maxOutputBytes) || 256 * 1024);
    // Undefined means machine-adaptive discovery. Supplying an explicit array
    // intentionally narrows this executor for a specialized caller.
    this.allowedCommands = Array.isArray(options.allowedCommands) ? options.allowedCommands : undefined;
  }

  async execute(action) {
    if (!action || action.action_type !== 'implementation') throw new Error('Implementation action is required.');
    if (!SAFE_OPERATIONS.has(action.operation)) throw new Error(`Implementation operation is not enabled: ${action.operation}`);
    const root = path.resolve(String(action.working_directory || '').trim());
    if (!root) throw new Error('Implementation working_directory is required.');

    switch (action.operation) {
      case 'inspect_status': return this.inspectStatus(root);
      case 'read_file': return this.readFile(root, action);
      case 'read_artifact': return this.readFile(root, action);
      case 'read_range': return this.readRange(root, action);
      case 'search_workspace': return this.searchWorkspace(root, action);
      case 'apply_patch': return this.applyPatch(root, action);
      case 'run_command': return this.runCommand(root, action);
      case 'run_validation': return this.runValidation(root, action);
      default: throw new Error(`Unsupported implementation operation: ${action.operation}`);
    }
  }

  async inspectStatus(root) {
    await fs.access(root);
    const [branch, status, packageJson] = await Promise.all([
      execFileAsync('git', ['branch', '--show-current'], { cwd: root, windowsHide: true }).catch(error => ({ stdout: '', stderr: error.message })),
      execFileAsync('git', ['status', '--short', '--branch'], { cwd: root, windowsHide: true }).catch(error => ({ stdout: '', stderr: error.message })),
      fs.readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse).catch(() => null)
    ]);
    return {
      operation: 'inspect_status',
      workingDirectory: root,
      branch: String(branch.stdout || '').trim() || null,
      gitStatus: String(status.stdout || status.stderr || '').trim(),
      packageScripts: packageJson?.scripts || null
    };
  }

  async readFile(root, action) {
    const target = action.targets?.[0] || action.arguments?.path;
    if (!target) throw new Error('read_file requires one target path.');
    const absolutePath = resolveInside(root, target);
    const content = await fs.readFile(absolutePath, 'utf8');
    return { operation: 'read_file', path: path.relative(root, absolutePath).replaceAll('\\', '/'), content, sha256: sha256(content) };
  }

  async readRange(root, action) {
    const target = action.targets?.[0] || action.arguments?.path;
    if (!target) throw new Error('read_range requires one target path.');
    const absolutePath = resolveInside(root, target);
    const content = await fs.readFile(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const start = Math.max(1, Number(action.arguments?.startLine) || 1);
    const end = Math.min(lines.length, Math.max(start, Number(action.arguments?.endLine) || start + 199));
    return { operation: 'read_range', path: path.relative(root, absolutePath).replaceAll('\\', '/'), startLine: start, endLine: end, content: lines.slice(start - 1, end).join('\n') };
  }

  async searchWorkspace(root, action) {
    const query = String(action.arguments?.query || '').trim();
    if (!query) throw new Error('search_workspace requires arguments.query.');
    const files = await execFileAsync('git', ['ls-files'], { cwd: root, windowsHide: true });
    const matches = [];
    for (const relativePath of String(files.stdout || '').split(/\r?\n/).filter(Boolean)) {
      if (matches.length >= 100) break;
      const absolutePath = resolveInside(root, relativePath);
      let content;
      try { content = await fs.readFile(absolutePath, 'utf8'); } catch { continue; }
      const index = content.indexOf(query);
      if (index < 0) continue;
      matches.push({ path: relativePath.replaceAll('\\', '/'), preview: content.slice(Math.max(0, index - 120), index + query.length + 240).replace(/\s+/g, ' ') });
    }
    return { operation: 'search_workspace', query, matches };
  }

  async applyPatch(root, action) {
    const target = action.targets?.[0] || action.arguments?.path;
    if (!target) throw new Error('apply_patch requires one target path.');
    const edits = action.arguments?.edits || [];
    if (!Array.isArray(edits) || !edits.length) throw new Error('apply_patch requires arguments.edits (a non-empty array).');
    const absolutePath = resolveInside(root, target);
    const before = await fs.readFile(absolutePath, 'utf8');
    const lines = before.split(/\r?\n/);
    const normalized = edits.map(edit => ({
      startLine: Math.max(1, Number(edit.startLine) || 1),
      endLine: Math.max(1, Number(edit.endLine) || Number(edit.startLine) || 1),
      text: String(edit.text ?? edit.content ?? '')
    })).sort((a, b) => b.startLine - a.startLine);
    for (const edit of normalized) {
      if (edit.startLine < 1 || edit.endLine < edit.startLine || edit.endLine > lines.length) throw new Error('apply_patch edit range is out of bounds.');
      const replacement = edit.text.length ? edit.text.split(/\r?\n/) : [];
      lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...replacement);
    }
    const content = lines.join('\n');
    await atomicWrite(absolutePath, content);
    return {
      operation: 'apply_patch',
      path: path.relative(root, absolutePath).replaceAll('\\', '/'),
      editsApplied: edits.length,
      beforeSha256: sha256(before),
      afterSha256: sha256(content)
    };
  }

  _terminal(root) {
    const receiptsDirectory = path.join(os.tmpdir(), 'access-agent-receipts');
    return new GovernedTerminal({
      workspaceRoot: root,
      receiptsDirectory,
      ...(this.allowedCommands ? { allowedCommands:this.allowedCommands } : {}),
    });
  }

  async runCommand(root, action) {
    const command = String(action.command || action.arguments?.command || '').trim();
    if (!command) throw new Error('run_command requires a command line.');
    const terminal = this._terminal(root);
    const preview = await terminal.preview(command);
    const result = await terminal.execute(preview);
    return { operation: 'run_command', command, ok: result.ok, exitCode: result.exitCode, output: String(result.output || '').slice(-this.maxOutputBytes), error: result.error || null, receipt: result.receipt?.hash || null, resolvedExecutable:result.resolvedExecutable || null };
  }

  async runValidation(root, action) {
    const command = String(action.command || action.arguments?.command || '').trim();
    const allowed = new Set(['npm run check', 'npm test', 'npm run test']);
    if (!allowed.has(command)) throw new Error('run_validation command is not allowlisted.');
    const terminal = this._terminal(root);
    const preview = await terminal.preview(command);
    const result = await terminal.execute(preview);
    return {
      operation:'run_validation',
      command,
      ok:result.ok,
      exitCode:result.exitCode,
      stdout:String(result.stdout || '').slice(-this.maxOutputBytes),
      stderr:String(result.stderr || '').slice(-this.maxOutputBytes),
      error:result.error || null,
      receipt:result.receipt?.hash || null,
      resolvedExecutable:result.resolvedExecutable || null,
    };
  }
}

module.exports = { ImplementationExecutor, SAFE_OPERATIONS, resolveInside };
