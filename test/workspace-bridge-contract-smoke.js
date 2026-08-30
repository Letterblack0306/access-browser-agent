'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { handleWorkspaceBridgeRequest } = require('../src/app/workspace-bridge-server');

function responseBody(result) { return JSON.parse(result.body); }
function request(method, url, body) {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  stream.method = method; stream.url = url; return stream;
}

async function run() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-bridge-governed-'));
  fs.mkdirSync(path.join(root,'docs','change-intents'),{recursive:true});
  fs.writeFileSync(path.join(root,'docs','CHANGE_INDEX.md'),[
    '# Workspace Change Index','',
    '| Change ID | Status | Requested outcome | Intent document |',
    '| --- | --- | --- | --- |',
    '| `bridge-change` | `in_progress` | Update one bridge-owned file. | `docs/change-intents/bridge-change.md` |','',
  ].join('\n'),'utf8');
  fs.writeFileSync(path.join(root,'docs','change-intents','bridge-change.md'),[
    '# Change Intent','',
    '## Change ID','','`bridge-change`','',
    '## Status','','`in_progress`','',
    '## Requested outcome','','Update one bridge-owned file.','',
    '## Target files','','- `src/app.js`','',
    '## Intent','','Verify direct bridge governance.','',
    '## Planned changes','','- Save src/app.js.','',
    '## Why','','Raw bridge writes must not bypass governance.','',
    '## Post-change update','','Pending implementation.','',
    '## Validation evidence','','Pending implementation.','',
  ].join('\n'),'utf8');

  const calls = [];
  const reader = {
    workspaceRoot: root,
    async list(target) { calls.push(['list', target]); return { ok: true, items: [] }; },
    async read(target) { calls.push(['read', target]); return { ok: true, path:target, content: '', sha256: 'a'.repeat(64), truncated: false }; },
    async write(target, content, expectedSha256) { calls.push(['write', target, content, expectedSha256]); return { ok: true, path:target, sha256: 'b'.repeat(64) }; },
    async search(query, target) { calls.push(['search', query, target]); return { ok: true, query, path:target, matches: [] }; },
    async inspect(target) { calls.push(['inspect', target]); return { ok: true, path:target, files: 0 }; }
  };

  assert.equal((await handleWorkspaceBridgeRequest(request('GET', '/agent/health'), reader)).status, 200);
  assert.deepEqual(
    responseBody(await handleWorkspaceBridgeRequest(request('GET', '/api/runtime/status'), reader)).capabilities,
    ['workspace.list', 'workspace.read', 'workspace.write.hash_guarded.change_governed', 'workspace.search', 'workspace.inspect']
  );

  const blocked=await handleWorkspaceBridgeRequest(request('PUT','/api/workspace/file',{path:'src/undeclared.js',content:'blocked',expectedSha256:'a'.repeat(64)}),reader);
  assert.equal(blocked.status,403);
  assert.equal(responseBody(blocked).classification,'GOVERNANCE');
  assert.equal(responseBody(blocked).code,'TARGET_NOT_DECLARED');
  assert.equal(calls.length,0,'bridge must fail before reader.write side effects');

  const save = await handleWorkspaceBridgeRequest(request('PUT', '/api/workspace/file', {
    path: 'src/app.js', content: 'updated', expectedSha256: 'a'.repeat(64), changeId:'bridge-change'
  }), reader);
  assert.equal(save.status, 200);
  assert.deepEqual(calls, [['write', 'src/app.js', 'updated', 'a'.repeat(64)]]);

  reader.create = async (target, content) => {
    calls.push(['create', target, content]);
    return { ok: true, path: target, sha256: 'c'.repeat(64) };
  };
  const create = await handleWorkspaceBridgeRequest(request('POST', '/api/workspace/create', {
    path: 'src/new.js', content: 'created', changeId:'bridge-change'
  }), reader);
  assert.equal(create.status, 201);
  assert.deepEqual(calls[1], ['create', 'src/new.js', 'created']);

  await handleWorkspaceBridgeRequest(request('GET', '/api/workspace/search?query=bridge&path=src'), reader);
  await handleWorkspaceBridgeRequest(request('GET', '/api/workspace/inspect?path=src'), reader);
  assert.deepEqual(calls.slice(1), [
    ['create', 'src/new.js', 'created'],
    ['search', 'bridge', 'src'],
    ['inspect', 'src'],
  ]);

  assert.equal((await handleWorkspaceBridgeRequest(request('POST', '/api/workspace/file'), reader)).status, 405);
  assert.equal((await handleWorkspaceBridgeRequest(request('GET', '/api/workspace/proposals/legacy'), reader)).status, 404);

  console.log('Workspace bridge contract smoke PASS');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
