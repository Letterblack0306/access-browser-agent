'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildLiveToolContext } = require('../src/agent/executive/LiveToolContext');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'live-tool-patch-'));
  await fs.writeFile(path.join(root, 'file.txt'), 'one\ntwo\n', 'utf8');
  await fs.mkdir(path.join(root, 'docs', 'change-intents'), { recursive:true });
  const { registry } = buildLiveToolContext({ workspaceRoot: root });

  const providerTools = registry.openAiTools();
  assert.equal(providerTools[3]?.function?.name, 'applyPatch', 'the provider rejection index must map to applyPatch');
  assert.deepEqual(providerTools[3].function.parameters.properties.edits, {
    type:'array',
    minItems:1,
    items:{
      type:'object',
      properties:{
        startLine:{type:'integer',minimum:1},
        endLine:{type:'integer',minimum:1},
        text:{type:'string'},
      },
      required:['startLine','endLine','text'],
      additionalProperties:false,
    },
  }, 'applyPatch edits must expose a complete provider-compatible array item schema');
  for (const declaration of providerTools) {
    for (const [propertyName, propertySchema] of Object.entries(declaration.function.parameters?.properties || {})) {
      if (propertySchema?.type === 'array') {
        assert.ok(propertySchema.items, `${declaration.function.name}.${propertyName} array schema must declare items`);
      }
    }
  }

  const environmentTool = registry.get('inspectEnvironment');
  assert.ok(environmentTool, 'machine environment discovery must be exposed as a current callable adapter');
  assert.match(environmentTool.description, /does not grant execution authority/u);
  const environment = await registry.execute('inspectEnvironment', { executables:['node'] }, { workspaceRoot:root });
  assert.equal(environment.ok, true, 'environment discovery must not require mutation governance');
  assert.equal(environment.output.environment.platform, process.platform);
  assert.equal(Array.isArray(environment.output.executables), true);

  const blocked = await registry.execute('applyPatch', { path: 'file.txt', edits: [{ startLine: 2, endLine: 2, text: 'changed' }] }, { workspaceRoot:root });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.output.observation, 'BLOCKED');
  assert.equal(blocked.output.error.code, 'CHANGE_INDEX_MISSING');
  assert.equal(await fs.readFile(path.join(root, 'file.txt'), 'utf8'), 'one\ntwo\n', 'blocked mutation must not touch the file');

  const blockedCreate = await registry.execute('createFile', { path:'ordinary.txt', content:'must not exist' }, { workspaceRoot:root });
  assert.equal(blockedCreate.ok,false);
  assert.equal(blockedCreate.output.error.code,'CHANGE_INDEX_MISSING');
  await assert.rejects(fs.readFile(path.join(root,'ordinary.txt'),'utf8'), error=>error.code==='ENOENT');

  const intentBody=[
    '# Change Intent', '',
    '## Change ID', '', '`patch-test`', '',
    '## Status', '', '`in_progress`', '',
    '## Requested outcome', '', 'Patch one declared file.', '',
    '## Target files', '', '- `file.txt`', '- `ordinary.txt`', '',
    '## Intent', '', 'Verify the mutation blocker.', '',
    '## Planned changes', '', '- Patch line 2.', '- Create one declared file.', '',
    '## Why', '', 'Regression proof.', '',
    '## Post-change update', '', 'Pending implementation.', '',
    '## Validation evidence', '', 'Pending implementation.', '',
  ].join('\n');
  const intentCreate=await registry.execute('createFile',{path:'docs/change-intents/patch-test.md',content:intentBody},{workspaceRoot:root});
  assert.equal(intentCreate.ok,true,'governance intent creation must be allowed before an active change exists');
  assert.equal(intentCreate.output.verified,true);

  const indexBody=[
    '# Workspace Change Index', '',
    '| Change ID | Status | Requested outcome | Intent document |',
    '| --- | --- | --- | --- |',
    '| `patch-test` | `in_progress` | Patch one declared file. | `docs/change-intents/patch-test.md` |',
    '',
  ].join('\n');
  const indexCreate=await registry.execute('createFile',{path:'docs/CHANGE_INDEX.md',content:indexBody},{workspaceRoot:root});
  assert.equal(indexCreate.ok,true,'governance index creation must be allowed through the bootstrap exception');

  const result = await registry.execute('applyPatch', { path: 'file.txt', edits: [{ startLine: 2, endLine: 2, text: 'changed' }] }, { workspaceRoot:root });
  assert.equal(result.ok, true);
  assert.equal(result.output.verified, true);
  assert.equal(await fs.readFile(path.join(root, 'file.txt'), 'utf8'), 'one\nchanged\n');

  const created=await registry.execute('createFile',{path:'ordinary.txt',content:'declared and governed'},{workspaceRoot:root});
  assert.equal(created.ok,true);
  assert.equal(created.output.verified,true);
  assert.equal(await fs.readFile(path.join(root,'ordinary.txt'),'utf8'),'declared and governed');
  console.log('live-tool-context-patch-smoke: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
