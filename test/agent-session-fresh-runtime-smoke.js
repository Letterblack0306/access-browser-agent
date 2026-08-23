// CRITICAL_TRIAGE: see docs/change-intents/2026-08-23-orphan-triage.md
// This file is flagged for behavior verification before any keep/wire/delete decision.
// Do not delete or change behavior without first recording a check result in the triage doc.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const AgentSessionRuntime = require('../src/agent/executive/AgentSessionRuntime');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-agent-fresh-session-'));

  try {
    const runtime = new AgentSessionRuntime({
      workspaceRoot: root,
      stateRoot: root,
      stepRunnerFactory: () => async () => ({ ok:true }),
    });

    const historical = await runtime.createSession({
      sessionId:'agent-historical-session',
      objective:'historical objective must not enter fresh runtime',
    });

    const historicalId = historical.sessionId;
    const currentPath = path.join(root,'.gpt-sync','agent-sessions','current.json');
    const historicalDir = path.join(root,'.gpt-sync','agent-sessions',historicalId);

    assert.equal(
      JSON.parse(await fs.readFile(currentPath,'utf8')).sessionId,
      historicalId,
      'fixture must establish historical current-session ownership'
    );

    await runtime.resetForFreshRuntime({ clearCurrentSession:true });

    await assert.rejects(
      fs.readFile(currentPath,'utf8'),
      error => error && error.code === 'ENOENT',
      'fresh runtime must remove only the active current-session pointer'
    );

    const historicalStat = await fs.stat(historicalDir);
    assert.equal(
      historicalStat.isDirectory(),
      true,
      'historical session evidence must remain on disk'
    );

    assert.equal(
      await runtime.getCurrentSession(),
      null,
      'fresh runtime must have no inherited current session'
    );

    const fresh = await runtime.submitInstruction({
      newSession:true,
      objective:'fresh objective',
      instructionId:'fresh-instruction-1',
      text:'fresh instruction',
    });

    assert.notEqual(
      fresh.sessionId,
      historicalId,
      'first fresh instruction must not reuse historical session'
    );

    assert.equal(
      JSON.parse(await fs.readFile(currentPath,'utf8')).sessionId,
      fresh.sessionId,
      'new session must become the current owner'
    );

    console.log('agent-session-fresh-runtime-smoke: PASS');
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
})().catch(error => {
  console.error(error);
  process.exitCode=1;
});