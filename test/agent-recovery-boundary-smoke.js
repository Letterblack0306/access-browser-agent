'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const AgentEventStore = require('../src/agent/executive/AgentEventStore');
const AgentSessionRuntime = require('../src/agent/executive/AgentSessionRuntime');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-agent-recovery-boundary-'));
  const sessionId = 'recovery-test';
  const store = new AgentEventStore({ workspaceRoot:root, stateRoot:root, sessionId });
  await store.append('session.created', { workspaceRoot:root, objective:'Recover safely.' });
  await store.append('user.message', { instructionId:'instruction-1', text:'Run the side effect.' });
  await store.append('step.started', { stepId:'step-1', turnId:'turn-1', action:{kind:'reason_and_act'} });

  const runtime = new AgentSessionRuntime({
    workspaceRoot:root,
    stateRoot:root,
    stepRunnerFactory:() => async () => ({ status:'completed', summary:'completed after explicit reconciliation' }),
  });
  const recovered = await runtime.getSession(sessionId);
  assert.equal(recovered.getState().status, 'recovery_required');
  assert.equal(recovered.getState().recoveryRequired, true);
  await assert.rejects(
    () => recovered.submitInstruction({ instruction:'Do not run until reconciled.' }),
    error => error?.code === 'AGENT_RECOVERY_REQUIRED',
  );

  const reconciled = await runtime.reconcileRecovery(sessionId, { disposition:'abandoned', reason:'The interrupted side effect was checked externally.' });
  assert.equal(reconciled.recoveryRequired, false);
  assert.equal(reconciled.status, 'idle');
  const accepted = await recovered.submitInstruction({ instruction:'Continue after reconciliation.' });
  const completed = await accepted.runPromise;
  assert.equal(completed.status, 'completed');
  console.log('agent-recovery-boundary-smoke: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
