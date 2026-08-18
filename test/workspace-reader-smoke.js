'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const WorkspaceReader = require('../src/system/workspace-reader');

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-browser-agent-reader-'));
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'src', 'app.js'), 'const feature = "workspace reader";\n', 'utf8');
    await fs.writeFile(path.join(root, 'node_modules', 'ignored.js'), 'workspace reader', 'utf8');

    const reader = new WorkspaceReader(root, { maxReadBytes: 128 });
    const listing = await reader.list('.');
    assert.deepEqual(listing.items, [{ name: 'src', path: 'src', type: 'directory' }]);

    const full = await reader.read('src/app.js');
    assert.equal(full.ok, true);
    assert.match(full.sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof full.modifiedAt, 'string');

    const truncated = await new WorkspaceReader(root, { maxReadBytes: 20 }).read('src/app.js');
    assert.equal(truncated.truncated, true);
    assert.equal(truncated.content, 'const feature = "wor');

    const saved = await reader.write('src/app.js', 'const feature = "editable";\n', full.sha256);
    assert.equal(saved.ok, true);
    assert.match(saved.sha256, /^[a-f0-9]{64}$/);
    assert.equal(await fs.readFile(path.join(root, 'src', 'app.js'), 'utf8'), 'const feature = "editable";\n');

    const conflict = await reader.write('src/app.js', 'stale write\n', full.sha256);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, 'FILE_CHANGED_EXTERNALLY');

    const search = await reader.search('editable');
    assert.deepEqual(search.matches.map(match => match.path), ['src/app.js']);
    assert.equal((await reader.search('')).code, 'QUERY_REQUIRED');
    assert.deepEqual(await reader.inspect('.'), {
      ok: true,
      path: '.',
      files: 1,
      directories: 1,
      bytes: 28,
      limited: false,
      extensions: [{ extension: '.js', count: 1 }]
    });

    console.log('Workspace reader smoke PASS');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
