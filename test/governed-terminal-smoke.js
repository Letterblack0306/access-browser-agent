'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { GovernedTerminal, parseTerminalCommand, DEFAULT_ALLOWED_COMMANDS } = require('../src/system/governed-terminal');
const { MachineEnvironment } = require('../src/system/machine-environment');

(async () => {
  assert.deepEqual(parseTerminalCommand('git status --short'), { command: 'git', args: ['status', '--short'] });
  assert.throws(() => parseTerminalCommand('git status | findstr M'), /Shell operators/);
  assert.throws(() => parseTerminalCommand('powershell -Command Get-ChildItem'), /not available/);
  assert.deepEqual(DEFAULT_ALLOWED_COMMANDS, [], 'default execution must not define a baked machine capability allowlist');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-governed-terminal-'));
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin, { recursive:true });
  const customName = process.platform === 'win32' ? 'custom-capability.exe' : 'custom-capability';
  const customPath = path.join(bin, customName);
  await fs.copyFile(process.execPath, customPath);
  if (process.platform !== 'win32') await fs.chmod(customPath, 0o755);
  const machine = new MachineEnvironment({
    env:{ ...process.env, PATH:bin, Path:bin, PATHEXT:process.platform === 'win32' ? '.EXE' : process.env.PATHEXT },
  });

  const terminal = new GovernedTerminal({ workspaceRoot: root, receiptsDirectory: path.join(root, 'receipts'), machineEnvironment:machine });
  const preview = await terminal.preview('custom-capability -e "console.log(\'DYNAMIC_TERMINAL_OK\')"');
  assert.equal(preview.lbe.decision, 'allow');
  assert.equal(path.resolve(preview.executable.resolved), path.resolve(customPath));
  const result = await terminal.execute(preview);
  assert.equal(result.ok, true);
  assert.match(result.output, /DYNAMIC_TERMINAL_OK/);
  assert.equal(result.cwd, path.resolve(root));
  assert.equal(path.resolve(result.resolvedExecutable), path.resolve(customPath));
  assert.equal((await fs.readFile(result.receipt.file, 'utf8')).includes(result.receipt.hash), true);

  const narrowed = new GovernedTerminal({ workspaceRoot:root, receiptsDirectory:path.join(root,'receipts-narrow'), machineEnvironment:machine, allowedCommands:['node'] });
  await assert.rejects(() => narrowed.preview('custom-capability --version'), /explicitly narrowed executable set/);
  await assert.rejects(() => terminal.preview('definitely-not-installed-access-agent-test --version'), /not found in the active machine PATH/);

  console.log('Governed terminal smoke PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
