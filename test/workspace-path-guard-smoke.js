'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateWorkspacePath } = require('../src/system/workspace-path-guard');

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-browser-agent-path-'));
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'app.js'), 'module.exports = {};\n', 'utf8');

    assert.equal((await validateWorkspacePath(root, 'src/app.js', { expectedKind: 'file' })).ok, true);
    assert.equal((await validateWorkspacePath(root, 'src', { expectedKind: 'file' })).code, 'WRONG_PATH_KIND');
    assert.equal((await validateWorkspacePath(root, '../outside.js')).code, 'OUTSIDE_WORKSPACE');
    assert.equal((await validateWorkspacePath(root, 'missing.js')).code, 'PATH_NOT_FOUND');
    assert.equal((await validateWorkspacePath(root, 'new/file.js', { mustExist: false, expectedKind: 'file' })).missing, true);

    console.log('Workspace path guard smoke PASS');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
