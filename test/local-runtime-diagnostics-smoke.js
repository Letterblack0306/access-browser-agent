'use strict';

const assert = require('node:assert/strict');
const { LocalRuntimeDiagnostics, localUrl } = require('../src/system/local-runtime-diagnostics');

assert.throws(() => localUrl('https://example.com/v1', 'LM Studio base URL'), /loopback/u);
const requests = [];
const diagnostics = new LocalRuntimeDiagnostics({
  fetch: async url => {
    requests.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'model-a' }, { id: ' model-a ' }, { id: 'model-b' }] }),
    };
  },
});

(async () => {
  assert.deepEqual(
    await diagnostics.listModels('http://127.0.0.1:1234/v1'),
    ['model-a', 'model-b'],
  );
  assert.deepEqual(requests, ['http://127.0.0.1:1234/v1/models']);
  assert.equal(typeof diagnostics.browserStatus, 'undefined');
  assert.equal(typeof diagnostics.listBrowserPages, 'undefined');
  assert.equal(typeof diagnostics.captureBrowserPage, 'undefined');
  console.log('Local runtime diagnostics smoke PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
