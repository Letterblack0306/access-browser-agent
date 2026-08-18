'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const AgentSessionRuntime = require('../src/agent/executive/AgentSessionRuntime');
const ToolRegistry = require('../src/agent/ToolRegistry');
const { LiveAgentCore } = require('../src/agent/executive/LiveAgentCore');
const { UnifiedAgentService, lifecycleEventStatus } = require('../src/agent/executive/UnifiedAgentService');
const { createInitialState, reduceSessionEvent } = require('../src/agent/executive/AgentSessionState');
const AgentExecutive = require('../src/agent/executive/AgentExecutive');

class SequenceProvider {
  constructor(sequence) { this.sequence = [...sequence]; this.calls = []; }
  async complete(input) {
    this.calls.push(JSON.parse(JSON.stringify({ messages: input.messages })));
    const next = this.sequence.shift();
    if (next instanceof Error) throw next;
    return next || { content: 'done', toolCalls: [] };
  }
}

class BlockingProvider {
  constructor() { this.entered = new Promise(resolve => { this._entered = resolve; }); }
  complete({ signal }) {
    this._entered();
    return new Promise((_resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      signal?.addEventListener('abort', () => reject(abortError()), { once: true });
    });
  }
}

function abortError() { const error = new Error('aborted'); error.name = 'AbortError'; return error; }

function createRuntime(root, agent) {
  return new AgentSessionRuntime({
    workspaceRoot: root,
    stateRoot: root,
    maxRetries: 0,
    stepRunnerFactory: ({ sessionId }) => context => agent.step({ ...context, sessionId }),
  });
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-agent-resilience-'));
  const registry = new ToolRegistry();
  registry.register('explode', 'Throw once.', { type:'object', properties:{} }, async () => { throw new Error('tool exploded'); });
  const firstProvider = new SequenceProvider([
    { content:'Running the bounded check.', toolCalls:[{ id:'call-1', name:'explode', arguments:{} }] },
    { content:'Recovered in the same run after observing the tool failure.', toolCalls:[] },
  ]);
  const firstAgent = new LiveAgentCore({ registry, provider:firstProvider });
  const firstRuntime = createRuntime(root, firstAgent);
  const first = await firstRuntime.submitInstruction({ instruction:'Run the bounded check.' });
  const continued = await first.runPromise;
  assert.equal(continued.status, 'completed', 'a failed tool observation must return to the reasoning loop when a useful next response exists');
  assert.equal(continued.completion.summary, 'Recovered in the same run after observing the tool failure.');
  const durable = continued.conversation.messages;
  assert.equal(durable.at(-2).role, 'assistant');
  assert.equal(durable.at(-1).role, 'tool');
  assert.equal(durable.at(-1).tool_call_id, 'call-1', 'a failed tool call must receive a matching tool response');
  const failedObservation = JSON.parse(durable.at(-1).content);
  assert.equal(failedObservation.ok, false, 'the matching tool response must report failure rather than fabricate output');
  assert.equal(failedObservation.observation, 'FAILED', 'the failed tool outcome must remain an explicit observation');
  assert.equal(firstProvider.calls.length, 2, 'the reasoning loop must continue to the provider after the failed tool observation');
  const continuationMessages = firstProvider.calls[1].messages;
  assert.ok(continuationMessages.some(message => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'call-1'));
  assert.ok(continuationMessages.some(message => message.role === 'tool' && message.tool_call_id === 'call-1'));

  const reconstructedProvider = new SequenceProvider([{ content:'Continued after runtime reconstruction.', toolCalls:[] }]);
  const reconstructedRuntime = createRuntime(root, new LiveAgentCore({ registry, provider:reconstructedProvider }));
  const reconstructedReset = await reconstructedRuntime.resetForFreshRuntime();
  assert.equal(reconstructedReset.clearedCurrentSession, false, 'ordinary runtime reconstruction must preserve the durable current-session pointer');
  const reconstructed = await reconstructedRuntime.submitInstruction({ instruction:'Continue after runtime reconstruction.' });
  const reconstructedState = await reconstructed.runPromise;
  assert.equal(reconstructed.sessionId, first.sessionId, 'ordinary runtime reconstruction must adopt the same durable session lineage');
  assert.equal(reconstructedState.status, 'completed');
  assert.equal(reconstructedState.conversation.messages.filter(message => message.role === 'user').length, 2, 'post-restart instruction must append exactly once to the existing session');
  assert.ok(reconstructedProvider.calls[0].messages.some(message => message.role === 'tool' && message.tool_call_id === 'call-1'), 'rehydrated reasoning context must retain prior durable tool evidence');

  const resumedProvider = new SequenceProvider([{ content:'Recovered with the prior tool failure in context.', toolCalls:[] }]);
  const resumedAgent = new LiveAgentCore({ registry, provider:resumedProvider });
  const resumedRuntime = createRuntime(root, resumedAgent);
  const resumed = await resumedRuntime.submitInstruction({ sessionId:first.sessionId, instruction:'Continue from the recorded failure.' });
  const recovered = await resumed.runPromise;
  assert.equal(recovered.status, 'completed');
  const recoveredMessages = resumedProvider.calls[0].messages;
  assert.ok(recoveredMessages.some(message => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'call-1'));
  assert.ok(recoveredMessages.some(message => message.role === 'tool' && message.tool_call_id === 'call-1'));

  const freshRuntime = createRuntime(root, new LiveAgentCore({ registry:new ToolRegistry(), provider:new SequenceProvider([{ content:'Fresh session.', toolCalls:[] }]) }));
  const explicitFreshReset = await freshRuntime.resetForFreshRuntime({ clearCurrentSession:true });
  assert.equal(explicitFreshReset.clearedCurrentSession, true, 'explicit fresh-session reset must clear the durable current-session pointer');
  const fresh = await freshRuntime.submitInstruction({ instruction:'Start without prior context.' });
  const freshState = await fresh.runPromise;
  assert.equal(freshState.status, 'completed');
  assert.notEqual(fresh.sessionId, first.sessionId, 'an explicit fresh-session reset must not reuse the persisted current session');
  assert.equal(freshState.conversation.messages.filter(message => message.role === 'user').length, 1, 'an explicit fresh-session reset must not load prior conversation messages');

  let duplicateState = createInitialState({ sessionId: 'dedupe', workspaceRoot: root });
  duplicateState = reduceSessionEvent(duplicateState, { type: 'user.message', eventId: 'instruction-1', data: { instructionId: 'instruction-1', text: 'Repeat-safe instruction.' } });
  duplicateState = reduceSessionEvent(duplicateState, { type: 'user.message', eventId: 'instruction-2', data: { instructionId: 'instruction-2', text: 'Repeat-safe instruction.' } });
  assert.equal(duplicateState.conversation.messages.length, 1, 'consecutive repeated user messages must not inflate durable context');
  const compactedAgent = new LiveAgentCore({ registry:new ToolRegistry(), provider:new SequenceProvider([]) });
  const compactedMessages = compactedAgent.messagesFor('dedupe-load', { messages: [
    { role: 'user', instructionId: 'old-1', content: 'Repeat-safe instruction.' },
    { role: 'user', instructionId: 'old-2', content: 'Repeat-safe instruction.' },
  ] });
  assert.equal(compactedMessages.filter(message => message.role === 'user').length, 1, 'resumed sessions must compact prior repeated user messages');

  const cancelRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'access-agent-cancel-'));
  const blockingProvider = new BlockingProvider();
  const cancelAgent = new LiveAgentCore({ registry:new ToolRegistry(), provider:blockingProvider });
  const cancelRuntime = createRuntime(cancelRoot, cancelAgent);
  const running = await cancelRuntime.submitInstruction({ instruction:'Wait for cancellation.' });
  await blockingProvider.entered;
  const stopped = await cancelRuntime.stop(running.sessionId, 'Stop test.');
  assert.equal(stopped.status, 'stopped', 'runtime-level stop must abort the in-flight provider call');

  assert.equal(lifecycleEventStatus({ type:'step.failed', data:{} }), 'failed');
  assert.equal(lifecycleEventStatus({ type:'dependency.waiting', data:{} }), 'waiting');
  assert.equal(lifecycleEventStatus({ type:'approval.pending', data:{} }), 'running', 'approval events have no special lifecycle authority in the rebuilt runtime');
  assert.equal(lifecycleEventStatus({ type:'objective.completed', data:{} }), 'completed');
  const service = Object.create(UnifiedAgentService.prototype);
  service._ensureProvider = async () => ({ ok:true });
  service._resolveSkills = async () => null;
  let forwarded = null;
  service.runtime = { submitInstruction: async input => { forwarded = input; return { sessionId:'isolated', instructionId:'i-1', runPromise:Promise.resolve({ status:'completed', completion:{ summary:'done', evidence:[] } }) }; } };
  service.onEvent = () => {};
  const projected = await service.run({ instruction:'Isolate this browser task.', objective:'Isolate this browser task.', newSession:true });
  assert.equal(forwarded.newSession, true, 'UnifiedAgentService must preserve relay session isolation');
  assert.equal(projected.summary, 'done');

  const timeoutEvents = [];
  const timeoutStore = {
    async loadEvents() { return []; },
    async append(type, data) {
      const event = { eventId: `timeout-${timeoutEvents.length + 1}`, sessionId: 'timeout-terminal', type, data, timestamp: new Date().toISOString() };
      timeoutEvents.push(event);
      return event;
    },
    async checkpoint() { return { checkpointId: 'timeout-checkpoint' }; },
    async writeSnapshot() {},
  };
  const timeoutExecutive = new AgentExecutive({
    workspaceRoot: root,
    sessionId: 'timeout-terminal',
    eventStore: timeoutStore,
    maxRetries: 0,
    stepRunner: async () => {
      const error = new Error('Agent run timed out after 20 ms.');
      error.code = 'AGENT_RUN_TIMEOUT';
      throw error;
    },
  });
  const timeoutSubmission = await timeoutExecutive.submitInstruction({ instruction: 'Verify timeout terminal state.' });
  const timeoutState = await timeoutSubmission.runPromise;
  assert.equal(timeoutState.status, 'timed_out', 'agent timeout must project a terminal timed_out state');
  assert.equal(timeoutEvents.filter(event => event.type === 'objective.timed_out').length, 1, 'agent timeout must emit one terminal timeout event');
  console.log('agent-runtime-resilience-smoke: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });