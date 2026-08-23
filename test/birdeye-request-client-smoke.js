// CRITICAL_TRIAGE: see docs/change-intents/2026-08-23-orphan-triage.md
// This file is flagged for behavior verification before any keep/wire/delete decision.
// Do not delete or change behavior without first recording a check result in the triage doc.

'use strict';

const assert = require('node:assert/strict');
const { BirdEyeRequestClient } = require('../src/system/birdeye-request-client');

function response(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}

(async () => {
  const writes = [];
  const reads = new Map();
  const fetch = async (url, options = {}) => {
    const method = String(options.method || 'GET');
    const match = /\/contents\/(.+?)\?ref=/u.exec(url);
    const path = decodeURIComponent(String(match?.[1] || '')).replace(/%2F/giu, '/');
    if (method === 'PUT') {
      const body = JSON.parse(options.body);
      const value = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
      writes.push({ path, value, body });
      reads.set(path, value);
      return response(201, { content: { sha: 'new-sha' } });
    }
    if (path === 'responses') {
      return response(200, [{ type: 'dir', name: 'dev-main' }]);
    }
    if (path.startsWith('responses/dev-main/') && path.endsWith('/result.json')) {
      const requestId = path.split('/')[2];
      const value = reads.get(`result:${requestId}`);
      if (!value) return response(404, { message: 'Not Found' });
      return response(200, { content: Buffer.from(JSON.stringify(value)).toString('base64'), sha: 'result-sha' });
    }
    if (reads.has(path)) {
      return response(200, { content: Buffer.from(JSON.stringify(reads.get(path))).toString('base64'), sha: 'existing-sha' });
    }
    return response(404, { message: 'Not Found' });
  };

  const now = new Date('2026-08-07T07:20:00.000Z');
  const client = new BirdEyeRequestClient({
    fetch,
    tokenProvider: async () => 'test-token',
    now: () => new Date(now),
    repository: 'Letterblack0306/Letterblack_BirdEye',
    branch: 'runtime/dev-main',
    workspaceId: 'access-browser-agent',
    validationProfile: 'default',
  });

  const queued = await client.enqueue({
    handoffId: '12345678-aaaa-bbbb-cccc-123456789012',
    headSha: 'abc123',
    diffSha256: 'def456',
  });

  assert.equal(queued.ok, true);
  assert.equal(queued.state, 'queued');
  assert.equal(queued.workspaceId, 'access-browser-agent');
  assert.match(queued.requestId, /^aba-\d+-12345678$/u);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, `requests/pending/${queued.requestId}.json`);
  assert.equal(writes[0].value.operation, 'workspace_diagnosis');
  assert.equal(writes[0].value.mutationAllowed, false);
  assert.equal(writes[0].value.scope.handoffId, '12345678-aaaa-bbbb-cccc-123456789012');
  assert.equal(writes[0].value.scope.headSha, 'abc123');
  assert.equal(writes[0].value.scope.diffSha256, 'def456');

  const pending = await client.status(queued.requestId);
  assert.deepEqual(
    { state: pending.state, received: pending.received, indexed: pending.indexed, responseAvailable: pending.responseAvailable },
    { state: 'queued', received: false, indexed: false, responseAvailable: false }
  );

  reads.set(`result:${queued.requestId}`, {
    schemaVersion: 1,
    requestId: queued.requestId,
    machineId: 'dev-main',
    status: 'completed',
    completedAt: '2026-08-07T07:21:00.000Z',
    index: { available: true, indexedFileCount: 123 },
    verdict: 'PASS',
  });

  const complete = await client.status(queued.requestId);
  assert.equal(complete.state, 'response_available');
  assert.equal(complete.received, true);
  assert.equal(complete.indexed, true);
  assert.equal(complete.responseAvailable, true);
  assert.equal(complete.machineId, 'dev-main');
  assert.equal(complete.verdict, 'PASS');

  reads.set(`result:${queued.requestId}`, {
    schemaVersion: 1,
    requestId: queued.requestId,
    machineId: 'dev-main',
    status: 'failed',
    error: 'validation failed',
    verdict: 'FAIL',
  });
  const failed = await client.status(queued.requestId);
  assert.equal(failed.ok, false);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.received, true);
  assert.equal(failed.responseAvailable, true);

  const missingAuth = new BirdEyeRequestClient({ fetch, tokenProvider: async () => '' });
  await assert.rejects(() => missingAuth.enqueue({ handoffId: 'x' }), error => error.code === 'BIRDEYE_AUTH_MISSING');

  console.log('BirdEye request client smoke PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
