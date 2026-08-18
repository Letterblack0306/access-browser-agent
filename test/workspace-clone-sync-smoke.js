'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceCloneSync, DEFAULT_SYNC_EXCLUSIONS, normalizeExclusions } = require('../src/system/workspace-clone-sync');

async function exists(file) {
  return fs.access(file).then(() => true).catch(() => false);
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-workspace-sync-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  await fs.mkdir(path.join(source, 'nested'), { recursive: true });
  await fs.mkdir(path.join(source, 'node_modules', 'package'), { recursive: true });
  await fs.writeFile(path.join(source, 'nested', 'copied.txt'), 'first');
  await fs.writeFile(path.join(source, 'node_modules', 'package', 'skip.txt'), 'skip');
  await fs.writeFile(path.join(source, '.env'), 'secret');
  await fs.writeFile(path.join(source, 'desktop.ini'), 'system');

  let emit;
  let closed = false;
  const sync = new WorkspaceCloneSync({
    debounceMs: 1,
    watch(_root, _options, listener) {
      emit = listener;
      return { close() { closed = true; }, on() {} };
    },
  });
  const status = await sync.start({ sourceRoot: source, targetRoot: target, exclusions: DEFAULT_SYNC_EXCLUSIONS });
  assert.equal(status.running, true);
  assert.equal(await fs.readFile(path.join(target, 'nested', 'copied.txt'), 'utf8'), 'first');
  assert.equal(await exists(path.join(target, 'node_modules', 'package', 'skip.txt')), false);
  assert.equal(await exists(path.join(target, '.env')), false);
  assert.equal(await exists(path.join(target, 'desktop.ini')), false);

  await fs.writeFile(path.join(source, 'nested', 'copied.txt'), 'second');
  emit('change', path.join('nested', 'copied.txt'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(await fs.readFile(path.join(target, 'nested', 'copied.txt'), 'utf8'), 'second');
  await fs.rm(path.join(source, 'nested', 'copied.txt'));
  emit('rename', path.join('nested', 'copied.txt'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(await exists(path.join(target, 'nested', 'copied.txt')), false);
  assert.deepEqual(normalizeExclusions(['node_modules', '.env', 'desktop.ini']), DEFAULT_SYNC_EXCLUSIONS);
  await assert.rejects(() => sync.start({ sourceRoot: source, targetRoot: path.join(source, 'copy') }), /outside the source workspace/);
  sync.stop();
  assert.equal(closed, true);
  await fs.rm(root, { recursive: true, force: true });
  console.log('Workspace clone sync smoke PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
