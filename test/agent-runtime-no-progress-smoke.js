// CRITICAL_TRIAGE: see docs/change-intents/2026-08-23-orphan-triage.md
// This file is flagged for behavior verification before any keep/wire/delete decision.
// Do not delete or change behavior without first recording a check result in the triage doc.

'use strict';

const assert = require('node:assert/strict');
const ToolRegistry = require('../src/agent/ToolRegistry');
const { LiveAgentCore } = require('../src/agent/executive/LiveAgentCore');

class SequenceProvider {
  constructor(sequence) {
    this.sequence = [...sequence];
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(JSON.parse(JSON.stringify({ messages: input.messages })));
    return this.sequence.shift() || { content:'provider should not be reached after stagnation interception', toolCalls:[] };
  }
}

(async () => {
  const registry = new ToolRegistry();
  let executions = 0;
  registry.register(
    'repeatRead',
    'Return the same observation every time.',
    { type:'object', properties:{ limit:{ type:'integer' } }, additionalProperties:false },
    async () => {
      executions += 1;
      return {
        ok:true,
        observation:'SUCCESS',
        url:'https://example.test/page',
        revision:7,
        text:'unchanged browser observation',
      };
    },
  );

  const call = id => ({
    content:'Checking the same browser state.',
    toolCalls:[{ id, name:'repeatRead', arguments:{ limit:20 } }],
  });
  const provider = new SequenceProvider([
    call('read-1'),
    call('read-2'),
    call('read-3'),
    call('read-4'),
    { content:'This completion must not be reached.', toolCalls:[] },
  ]);

  const agent = new LiveAgentCore({ registry, provider, maxToolCalls:10 });
  const result = await agent.step({
    sessionId:'no-progress-session',
    stepId:'no-progress-step',
    turnId:'no-progress-turn',
    instructionId:'no-progress-instruction',
    pendingInstructions:[{
      instructionId:'no-progress-instruction',
      text:'Inspect the browser state and stop if no new evidence appears.',
    }],
    conversation:{ messages:[] },
  });

  assert.equal(result.status, 'blocked', 'second consecutive duplicate observation must stop the reasoning loop');
  assert.equal(result.blocker, 'no_progress_stagnation', 'runtime must expose an explicit stagnation blocker');
  assert.equal(executions, 3, 'initial observation plus two duplicates are sufficient to prove stagnation');
  assert.equal(provider.calls.length, 3, 'runtime must intercept before a fourth provider completion');

  const warningMessages = provider.calls[2].messages.filter(message =>
    message.role === 'system' && String(message.content || '').includes('RUNTIME_NO_STATE_CHANGE')
  );
  assert.equal(warningMessages.length, 1, 'first duplicate must add one transient provider-facing no-state-change notice');

  const durableRuntimeNotices = agent.messagesFor('no-progress-session').filter(message =>
    message.role === 'system' && String(message.content || '').includes('RUNTIME_NO_STATE_CHANGE')
  );
  assert.equal(durableRuntimeNotices.length, 0, 'runtime notice must not become durable conversation history');

  console.log('agent-runtime-no-progress-smoke: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
