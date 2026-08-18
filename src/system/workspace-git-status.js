'use strict';

const { execFile } = require('node:child_process');

class WorkspaceGitStatus {
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = String(workspaceRoot || '').trim();
    this.execFile = options.execFile || execFile;
  }

  async read() {
    if (!this.workspaceRoot) throw new Error('Workspace root is required for Git status.');
    try {
      const status = parseStatus((await this.git(['status', '--short', '--branch'])).stdout);
      const [root, head, log] = await Promise.all([
        this.git(['rev-parse', '--show-toplevel']),
        this.git(['rev-parse', 'HEAD']),
        this.git(['log', '--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s', '--date=short', '-n', '20'])
      ]);
      return { available: true, workspaceRoot: root.stdout.trim(), branch: status.branch, head: head.stdout.trim(), changes: status.changes, commits: parseLog(log.stdout) };
    } catch (error) {
      const output = `${error.stdout || ''}\n${error.stderr || ''}`;
      if (/not a git repository/i.test(output)) return unavailable();
      throw new Error(`Could not read Git workspace: ${error.message}`);
    }
  }

  async diff(relativePath) {
    const status = await this.read();
    if (!status.available) return { available: false, reason: status.reason, path: '', diff: '' };
    const change = status.changes.find(item => item.path === String(relativePath || ''));
    if (!change) throw new Error('The selected path is not a current Git change. Refresh Git and select a listed file.');
    if (change.status === '??') return { available: true, path: change.path, diff: 'Untracked file: Git has no diff base for this path.' };
    const staged = change.status[0] !== ' ';
    const result = await this.git([staged ? 'diff' : 'diff', ...(staged ? ['--cached'] : []), '--no-ext-diff', '--unified=3', '--', change.path]);
    return { available: true, path: change.path, staged, diff: result.stdout || 'No textual diff is available for this change.' };
  }

  git(args) { return run(this.execFile, 'git', ['-C', this.workspaceRoot, ...args]); }
}

function unavailable() { return { available: false, reason: 'The active workspace is not a Git repository.', workspaceRoot: '', branch: '', head: '', changes: [], commits: [] }; }
function parseStatus(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  const branchLine = lines.shift() || '';
  return { branch: branchLine.startsWith('## ') ? branchLine.slice(3) : '', changes: lines.map(line => ({ status: line.slice(0, 2), path: line.slice(3) })).filter(change => change.path) };
}
function parseLog(stdout) { return String(stdout || '').split(/\r?\n/).filter(Boolean).map(line => { const [sha, shortSha, author, date, subject] = line.split('\x1f'); return { sha, shortSha, author, date, subject }; }).filter(commit => commit.sha && commit.shortSha); }
function run(exec, file, args) { return new Promise((resolve, reject) => { exec(file, args, { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => { if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); return; } resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') }); }); }); }

module.exports = { WorkspaceGitStatus, parseStatus, parseLog, run };
