'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ToolRegistry = require('../src/agent/ToolRegistry');
const AgentEventStore = require('../src/agent/executive/AgentEventStore');
const AgentExecutive = require('../src/agent/executive/AgentExecutive');
const { LiveAgentCore } = require('../src/agent/executive/LiveAgentCore');

class Provider {
  constructor() { this.calls = 0; }
  async complete() {
    this.calls += 1;
    if (this.calls === 1) return { content: 'Reading the runtime record.', toolCalls: [{ id: 'call-read', name: 'readFile', arguments: { path: 'package.json' } }] };
    return { content: 'done', toolCalls: [] };
  }
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-trace-'));
  const registry = new ToolRegistry();
  registry.register('readFile', 'Read a file.', { type: 'object' }, async () => ({ ok: true, path: 'package.json', sha256: 'a'.repeat(64), size: 42 }));
  const provider = new Provider();
  const core = new LiveAgentCore({ registry, provider, approvalRequestor: async () => 'approved' });
  const liveEvents = [];
  const executive = new AgentExecutive({
    workspaceRoot: root,
    stateRoot: root,
    sessionId: 'trace-session',
    eventStore: new AgentEventStore({ workspaceRoot: root, stateRoot: root, sessionId: 'trace-session' }),
    stepRunner: context => core.step(context),
    onEvent: event => liveEvents.push(event),
  });
  await executive.initialize({ objective: 'trace tools' });
  const accepted = await executive.submitInstruction({ text: 'navigate' });
  await accepted.runPromise;
  const events = await executive.store.loadExecutionEvents();
  assert.deepEqual(events.map(event => event.type), [
    'execution.phase.changed',
    'execution.tool.started',
    'execution.tool.completed',
  ]);
  assert.equal(events[0].moduleId, 'agent-tools');
  assert.equal(events[0].toolName, 'readFile');
  assert.equal(events[2].outputSummary.ok, true);
  assert.deepEqual(events[2].outputSummary.keys, ['ok', 'path', 'sha256', 'size']);
  const state = executive.getState();
  assert.equal(state.completion.evidence.length, 1);
  assert.equal(state.completion.evidence[0].source, 'runtime');
  assert.equal(state.completion.evidence[0].eventId, events[2].eventId);
  assert.equal(state.completion.evidence[0].details.path, 'package.json');
  assert.equal(state.completion.evidence[0].details.sha256, 'a'.repeat(64));
  assert.ok(liveEvents.some(event => event.type === 'agent.intent' && event.data.detail === 'Reading the runtime record.'));
  console.log('execution-trace-smoke: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
