'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const AgentEventStore = require('../src/agent/executive/AgentEventStore');
const { projectSession } = require('../src/agent/executive/AgentSessionState');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-agent-invariants-'));
  const store = new AgentEventStore({ workspaceRoot: root, stateRoot: root, sessionId: 'invariant-session' });
  await store.append('session.created', { workspaceRoot: root, objective: 'Invariant test.' });
  await store.append('objective.completed', { summary: 'done' });
  await assert.rejects(() => store.append('session.running', {}), /not allowed after terminal state completed/u);

  const duplicateStore = new AgentEventStore({ workspaceRoot: root, stateRoot: root, sessionId: 'duplicate-session' });
  await duplicateStore.append('session.created', { workspaceRoot: root, objective: 'Duplicate test.' });
  await duplicateStore.append('objective.completed', { summary: 'done' });
  await assert.rejects(() => duplicateStore.append('objective.completed', { summary: 'duplicate' }), /not allowed after terminal state completed/u);

  const reopenedStore = new AgentEventStore({ workspaceRoot: root, stateRoot: root, sessionId: 'invariant-session' });
  const reopened = await reopenedStore.append('objective.revised', { objective: 'Next operation.', reason: 'next_instruction' });
  assert.equal(reopened.type, 'objective.revised');
  await reopenedStore.append('user.message', { instructionId: 'next-1', text: 'Continue.' });
  assert.equal(projectSession(await reopenedStore.loadEvents()).status, 'idle');

  const executionStore = new AgentEventStore({ workspaceRoot: root, stateRoot: root, sessionId: 'execution-session' });
  await executionStore.append('session.created', { workspaceRoot: root, objective: 'Execution ordering.' });
  await assert.rejects(() => executionStore.appendExecution({ sessionId: 'execution-session', turnId: 't', stepId: 's', toolCallId: 'c', moduleId: 'm', type: 'execution.tool.completed', status: 'completed' }), /arrived before/u);
  await executionStore.appendExecution({ sessionId: 'execution-session', turnId: 't', stepId: 's', toolCallId: 'c', moduleId: 'm', type: 'execution.tool.started', status: 'running' });
  await executionStore.appendExecution({ sessionId: 'execution-session', turnId: 't', stepId: 's', toolCallId: 'c', moduleId: 'm', type: 'execution.tool.completed', status: 'completed' });
  await assert.rejects(() => executionStore.appendExecution({ sessionId: 'execution-session', turnId: 't', stepId: 's', toolCallId: 'c', moduleId: 'm', type: 'execution.tool.failed', status: 'failed' }), /after terminal tool state/u);

  const restarted = new AgentEventStore({ workspaceRoot: root, stateRoot: root, sessionId: 'execution-session' });
  await assert.rejects(() => restarted.appendExecution({ sessionId: 'execution-session', turnId: 't', stepId: 's', toolCallId: 'c', moduleId: 'm', type: 'execution.tool.failed', status: 'failed' }), /after terminal tool state/u);

  const concurrentStore = new AgentEventStore({ workspaceRoot: root, stateRoot: root, sessionId: 'concurrent-session' });
  await concurrentStore.append('session.created', { workspaceRoot: root, objective: 'Concurrent terminal test.' });
  const concurrent = await Promise.allSettled([
    concurrentStore.append('objective.completed', { summary: 'winner' }),
    concurrentStore.append('objective.failed', { summary: 'loser' }),
  ]);
  assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1, 'concurrent terminal transitions must have one winner');
  assert.equal(concurrent.filter(item => item.status === 'rejected').length, 1, 'concurrent terminal transitions must reject the loser');
  const concurrentEvents = await concurrentStore.loadEvents();
  assert.equal(concurrentEvents.filter(event => ['objective.completed', 'objective.failed'].includes(event.type)).length, 1, 'only one concurrent terminal event may persist');

  console.log('lifecycle-invariant-smoke: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });