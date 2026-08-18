'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ImplementationExecutor } = require('../src/loop/implementation-executor');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-impl-exec-'));
  const file = path.join(root, 'sample.txt');
  await fs.writeFile(file, 'line1\nline2\nline3\nline4\n');
  const executor = new ImplementationExecutor();
  assert.equal(executor.allowedCommands, undefined, 'default executor must use machine-adaptive executable discovery rather than an explicit empty allowlist');

  const read = await executor.execute({
    action_type: 'implementation',
    operation: 'read_file',
    working_directory: root,
    targets: ['sample.txt']
  });
  assert.equal(read.content, 'line1\nline2\nline3\nline4\n');

  const patched = await executor.execute({
    action_type: 'implementation',
    operation: 'apply_patch',
    working_directory: root,
    targets: ['sample.txt'],
    arguments: { edits: [{ startLine: 3, endLine: 3, text: 'line3-EDITED' }] }
  });
  assert.equal(patched.operation, 'apply_patch');
  assert.equal(patched.beforeSha256.length, 64);
  assert.equal(patched.afterSha256.length, 64);
  assert.match(await fs.readFile(file, 'utf8'), /line3-EDITED/);

  const command = await executor.execute({
    action_type: 'implementation',
    operation: 'run_command',
    working_directory: root,
    command: 'node -e "console.log(\'COMMAND_OK\')"'
  });
  assert.equal(command.ok, true);
  assert.match(command.output, /COMMAND_OK/);
  assert.ok(command.resolvedExecutable, 'run_command must preserve discovered executable identity');

  const narrowed = new ImplementationExecutor({ allowedCommands:['git'] });
  await assert.rejects(
    narrowed.execute({
      action_type:'implementation',
      operation:'run_command',
      working_directory:root,
      command:'node -e "console.log(1)"'
    }),
    /explicitly narrowed executable set/u,
    'specialized callers must still be able to narrow execution explicitly'
  );

  await assert.rejects(
    executor.execute({
      action_type: 'implementation',
      operation: 'read_file',
      working_directory: root,
      targets: ['../outside.txt']
    }),
    /escapes the allowed working directory/
  );

  await assert.rejects(
    executor.execute({ action_type: 'implementation', operation: 'brew', working_directory: root }),
    /not enabled/
  );

  console.log('Implementation executor smoke PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
