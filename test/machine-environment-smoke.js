'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MachineEnvironment, normalizeExecutableName } = require('../src/system/machine-environment');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-machine-environment-'));
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin, { recursive:true });
  const name = process.platform === 'win32' ? 'custom-capability.exe' : 'custom-capability';
  const target = path.join(bin, name);
  await fs.copyFile(process.execPath, target);
  if (process.platform !== 'win32') await fs.chmod(target, 0o755);

  const env = {
    ...process.env,
    PATH:bin,
    Path:bin,
    PATHEXT:process.platform === 'win32' ? '.EXE;.CMD' : process.env.PATHEXT,
  };
  if (process.platform === 'win32') env.PWSH_EXE = target;
  else env.SHELL = target;
  const machine = new MachineEnvironment({ env });
  const snapshot = machine.snapshot();
  assert.equal(snapshot.platform, process.platform);
  assert.equal(snapshot.arch, process.arch);
  assert.equal(snapshot.pathEntryCount, 1);
  assert.equal(Object.hasOwn(snapshot,'hostname'), false, 'environment snapshot must not expose host identity by default');
  assert.equal(Object.hasOwn(snapshot,'home'), false, 'environment snapshot must not expose user home by default');
  assert.equal(Object.hasOwn(snapshot.node,'executable'), false, 'environment snapshot must not expose Node installation path by default');

  const requested = 'custom-capability';
  const resolved = await machine.resolveExecutable(requested);
  assert.equal(resolved.available, true);
  assert.equal(path.resolve(resolved.resolved), path.resolve(target));
  assert.ok(['native','executable'].includes(resolved.kind));
  const resolvedSync = machine.resolveExecutableSync(requested);
  assert.equal(resolvedSync.available, true);
  assert.equal(path.resolve(resolvedSync.resolved), path.resolve(target));

  const shell = machine.resolveInteractiveShellSync();
  assert.equal(path.resolve(shell.executable), path.resolve(target));
  assert.ok(['PWSH_EXE','SHELL'].includes(shell.source));

  const missing = await machine.resolveExecutable('definitely-not-installed-access-agent-test');
  assert.equal(missing.available, false);
  const inspected = await machine.inspect({ executables:[requested,'definitely-not-installed-access-agent-test'] });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.executables.length, 2);
  assert.equal(inspected.executables[0].available, true);
  assert.equal(inspected.executables[1].available, false);

  assert.throws(() => normalizeExecutableName('../escape'), /bare executable name/);
  assert.throws(() => normalizeExecutableName(path.resolve(target)), /bare executable name/);

  const repoRoot = path.resolve(__dirname, '..');
  const rebuildMain = fsSync.readFileSync(path.join(repoRoot, 'electron', 'rebuild-main.js'), 'utf8');
  const managedChrome = fsSync.readFileSync(path.join(repoRoot, 'src', 'system', 'managed-chrome.js'), 'utf8');
  assert.match(rebuildMain, /resolveInteractiveShellSync/u, 'active rebuild must resolve interactive shell from the current host');
  assert.match(rebuildMain, /selectFreeLoopbackPort/u, 'active rebuild must select a free internal bridge port when no override is configured');
  assert.match(rebuildMain, /workspace_bridge_port_selected/u);
  assert.doesNotMatch(rebuildMain, /DEFAULT_ALLOWED_COMMANDS/u, 'active quick command path must not restore a static executable universe');
  assert.doesNotMatch(managedChrome, /'C:\\\\Program Files'/u, 'managed browser must not hard-code one development-machine Chrome location');
  assert.match(managedChrome, /resolveChromeExecutable/u);
  assert.match(managedChrome, /google-chrome-stable/u);

  console.log('Machine environment smoke PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
