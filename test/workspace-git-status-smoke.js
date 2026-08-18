'use strict';

const assert = require('node:assert/strict');
const { WorkspaceGitStatus } = require('../src/system/workspace-git-status');

const responses = new Map([
  ['status --short --branch', '## main...origin/main\n M src/app.js\nM  staged.js\n?? note.md\n'],
  ['rev-parse --show-toplevel', 'C:/workspace\n'],
  ['rev-parse HEAD', '0123456789abcdef\n'],
  ['log --format=%H%x1f%h%x1f%an%x1f%ad%x1f%s --date=short -n 20', '0123456789abcdef\x1f0123456\x1fAda\x1f2026-08-03\x1fInitial commit\n'],
  ['diff --no-ext-diff --unified=3 -- src/app.js', '@@ -1 +1 @@\n-old\n+new\n'],
  ['diff --cached --no-ext-diff --unified=3 -- staged.js', '@@ -1 +1 @@\n-old\n+new\n']
]);
const status = new WorkspaceGitStatus('C:/workspace', { execFile: (_file, args, _options, callback) => {
  assert.deepEqual(args.slice(0, 2), ['-C', 'C:/workspace']);
  const key = args.slice(2).join(' ');
  callback(null, responses.get(key) || '', '');
} });

(async () => {
  const overview = await status.read();
  assert.equal(overview.branch, 'main...origin/main');
  assert.equal(overview.commits[0].author, 'Ada');
  assert.deepEqual(overview.changes, [{ status: ' M', path: 'src/app.js' }, { status: 'M ', path: 'staged.js' }, { status: '??', path: 'note.md' }]);
  assert.match((await status.diff('src/app.js')).diff, /\+new/);
  assert.equal((await status.diff('note.md')).diff, 'Untracked file: Git has no diff base for this path.');
  await assert.rejects(() => status.diff('other.js'), /not a current Git change/);
  const nonGit = new WorkspaceGitStatus('C:/plain', { execFile: (_file, _args, _options, callback) => { const error = new Error('exit 128'); callback(error, '', 'fatal: not a git repository'); } });
  assert.deepEqual(await nonGit.read(), { available: false, reason: 'The active workspace is not a Git repository.', workspaceRoot: '', branch: '', head: '', changes: [], commits: [] });
  console.log('Workspace Git status smoke PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
