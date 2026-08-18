'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire, createEvalRequire } = require('../src/system/require');

try {
  const pathRequire = createRequire(__filename);
  assert.equal(typeof pathRequire('node:path').join, 'function');

  const registry = require('../src/system/module-registry');
  assert.doesNotThrow(() => registry.assertFeature('node:path', 'join'));
  assert.throws(() => registry.assertFeature('node:path', 'does-not-exist'), /blocked untracked feature/);

  const evil = createRequire(__filename);
  assert.throws(() => evil('some-unknown-module'), /blocked untracked module/);
  const evalRequire = createEvalRequire(__filename);
  assert.throws(() => evalRequire('another-unknown-module'), /blocked untracked module/);

  const runtime=registry.RUNTIME_MODULES;
  assert.ok(runtime && Object.keys(runtime).length >= 25, 'active runtime ownership registry must cover the rebuilt mutation and execution owners');
  const owners=new Set();
  for(const [modulePath,contract] of Object.entries(runtime)){
    assert.ok(fs.existsSync(path.join(__dirname,'..',modulePath)),`registered runtime module missing: ${modulePath}`);
    for(const key of ['owner','behavior','success','failure'])assert.ok(String(contract[key]||'').trim(),`${modulePath} missing ${key}`);
    assert.ok(!owners.has(contract.owner),`duplicate runtime owner: ${contract.owner}`);owners.add(contract.owner);
    for(const parent of contract.parents||[])assert.ok(runtime[parent],`${modulePath} references unregistered parent ${parent}`);
  }
  assert.ok(runtime['src/agent/guards/ChangeGovernanceGuard.js'],'change governance guard must be an owned runtime module');
  assert.ok(runtime['src/app/workspace-bridge-server.js'],'direct workspace HTTP mutation boundary must be registered');
  assert.ok(runtime['src/system/workspace-reader.js'],'filesystem mutation authority must be registered');
  assert.match(runtime['src/agent/ToolRegistry.js'].behavior,/change governance/u);
  assert.match(runtime['src/agent/guards/ChangeGovernanceGuard.js'].behavior,/parallel active changes/u);
  assert.match(runtime['src/app/workspace-bridge-server.js'].behavior,/direct hash-guarded PUT writes/u);
  assert.match(runtime['src/system/workspace-reader.js'].behavior,/create\/write/u);

  console.log('module-registry-smoke: PASS');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
