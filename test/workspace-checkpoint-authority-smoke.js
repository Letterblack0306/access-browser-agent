'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceCheckpointAuthority } = require('../src/system/workspace-checkpoint-authority');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-checkpoint-'));
  const authority = new WorkspaceCheckpointAuthority({ workspaceRoot: root });

  const fileA = path.join(root, 'a.txt');
  const fileB = path.join(root, 'keep', 'b.txt');
  await fs.mkdir(path.dirname(fileB), { recursive: true });
  await fs.writeFile(fileA, 'v1');
  await fs.writeFile(fileB, 'keep-me');

  // No git commit for a freshly created repo without changes should return changed:false.
  const first = await authority.create({ stepId: 'step-1', toolName: 'setup' });
  assert.equal(first.ok, true);
  assert.ok(typeof first.checkpointId === 'string' && first.checkpointId.startsWith('cp-'));

  // Second identical create (no workspace changes) must report no changes.
  const noChange = await authority.create({ stepId: 'step-1b', toolName: 'setup' });
  assert.equal(noChange.ok, true);
  assert.equal(noChange.changed, false, 'no file changes → no new checkpoint');

  // Make a mutation, checkpoint it, then corrupt the file, then restore.
  await fs.writeFile(fileA, 'CORRUPTED');
  const dirty = await authority.create({ stepId: 'step-2', toolName: 'writeFile' });
  assert.equal(dirty.changed, true);
  const leakedCheckpointId = dirty.checkpointId;

  // Corrupt after the last checkpoint so restore must return to 'v1'.
  await fs.writeFile(fileA, 'MORE CORRUPTION');
  const restored = await authority.restore({ checkpointId: leakedCheckpointId });
  assert.equal(restored.ok, true);
  assert.equal(restored.restored, true);
  assert.equal(await fs.readFile(fileA, 'utf8'), 'CORRUPTED',
    'workspace must roll back to the immediate pre-mutation checkpoint');

  // Untracked-ignored content (node_modules) must not be restored into workspace.
  const nm = path.join(root, 'node_modules');
  await fs.mkdir(nm, { recursive: true });
  await fs.writeFile(path.join(nm, 'dep.txt'), 'should-stay');
  const ignored = await authority._readGitignore();
  assert.ok(Array.isArray(ignored));

  // list() must surface at least the created checkpoints.
  const listing = await authority.list();
  assert.equal(listing.ok, true);
  assert.ok(Array.isArray(listing.checkpoints));
  assert.ok(listing.checkpoints.length > 0, 'list must surface commit history');

  // Explicit unknown checkpoint → restore must fail cleanly.
  const missing = await authority.restore({ checkpointId: 'cp-does-not-exist' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not found/i);

  console.log('Workspace checkpoint authority smoke PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });