// CRITICAL_TRIAGE: see docs/change-intents/2026-08-23-orphan-triage.md
// This file is flagged for behavior verification before any keep/wire/delete decision.
// Do not delete or change behavior without first recording a check result in the triage doc.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceHandoffService } = require('../src/system/workspace-handoff-service');

(async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aba-birdeye-status-'));
  const calls = [];
  const client = {
    async status(requestId) {
      calls.push(requestId);
      return {
        ok: true,
        state: 'response_available',
        requestId,
        machineId: 'dev-main',
        received: true,
        indexed: true,
        responseAvailable: true,
        verdict: 'PASS',
        completedAt: '2026-08-07T07:30:00.000Z',
        response: {
          schemaVersion: 1,
          requestId,
          machineId: 'dev-main',
          status: 'completed',
          verdict: 'PASS',
          index: { available: true, indexedFileCount: 42 },
        },
      };
    },
  };

  try {
    const first = new WorkspaceHandoffService({ stateRoot, client });
    await first.writeLatestState({
      schemaVersion: 1,
      requestId: 'req-durable-1',
      handoffId: 'handoff-durable-1',
      workspaceRoot: 'G:\\Developments\\45_Accecc_Browser_Agent',
      state: 'queued',
      createdAt: '2026-08-07T07:20:00.000Z',
      expiresAt: '2026-08-07T07:35:00.000Z',
      repository: 'Letterblack0306/Letterblack_BirdEye',
      branch: 'runtime/dev-main',
      workspaceId: 'access-browser-agent',
    });

    const restarted = new WorkspaceHandoffService({ stateRoot, client });
    const result = await restarted.status();

    assert.equal(result.ok, true);
    assert.equal(result.state, 'response_available');
    assert.equal(result.requestId, 'req-durable-1');
    assert.equal(result.handoffId, 'handoff-durable-1');
    assert.equal(result.received, true);
    assert.equal(result.indexed, true);
    assert.equal(result.responseAvailable, true);
    assert.equal(result.machineId, 'dev-main');
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(calls, ['req-durable-1']);

    const persisted = JSON.parse(await fs.readFile(path.join(stateRoot, 'birdeye-handoffs', 'latest-request.json'), 'utf8'));
    assert.equal(persisted.state, 'response_available');
    assert.equal(persisted.received, true);
    assert.equal(persisted.indexed, true);
    assert.equal(persisted.responseAvailable, true);
    assert.equal(persisted.machineId, 'dev-main');
    assert.equal(persisted.verdict, 'PASS');

    const idleRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aba-birdeye-idle-'));
    try {
      const idle = new WorkspaceHandoffService({ stateRoot: idleRoot, client });
      assert.deepEqual(await idle.status(), {
        ok: true,
        state: 'idle',
        requestId: null,
        received: false,
        indexed: false,
        responseAvailable: false,
      });
    } finally {
      await fs.rm(idleRoot, { recursive: true, force: true });
    }

    console.log('BirdEye status state smoke PASS');
  } finally {
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
