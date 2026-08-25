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
    // Fourth completion is the graceful hand-off turn demanded by the runtime.
    { content:'I could not find any new evidence; the page state never changed.', toolCalls:[] },
    { content:'provider must not be reached after stagnation escalation', toolCalls:[] },
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

  assert.equal(result.status, 'completed', 'stagnation must degrade into a graceful final reply, not a silent block');
  assert.match(result.summary, /never changed/u, 'the user-facing summary must come from the final-reply completion');
  assert.equal(executions, 3, 'initial observation plus two duplicates are sufficient to prove stagnation');
  assert.equal(provider.calls.length, 4, 'runtime must grant exactly one final-reply provider completion');

  const warningMessages = provider.calls[2].messages.filter(message =>
    message.role === 'system' && String(message.content || '').includes('RUNTIME_NO_STATE_CHANGE')
  );
  assert.equal(warningMessages.length, 1, 'first duplicate must add one transient provider-facing no-state-change notice');

  const finalReplyMessages = provider.calls[3].messages.filter(message =>
    message.role === 'system' && String(message.content || '').includes('RUNTIME_FINAL_REPLY_REQUIRED')
  );
  assert.equal(finalReplyMessages.length, 1, 'stagnation interception must demand one final user-visible reply');

  const durableRuntimeNotices = agent.messagesFor('no-progress-session').filter(message =>
    message.role === 'system' && String(message.content || '').includes('RUNTIME_')
  );
  assert.equal(durableRuntimeNotices.length, 0, 'runtime notices must not become durable conversation history');

  // Second scenario: if the agent ignores the final-reply demand and repeats again,
  // the runtime must still hard-block as a kill-switch.
  executions = 0;
  const stubborn = new SequenceProvider([
    call('stubborn-1'),
    call('stubborn-2'),
    call('stubborn-3'),
    call('stubborn-4'),
    call('stubborn-5'),
    { content:'provider must not be reached', toolCalls:[] },
  ]);
  const stubbornAgent = new LiveAgentCore({ registry, provider:stubborn, maxToolCalls:10 });
  const blocked = await stubbornAgent.step({
    sessionId:'stubborn-session',
    stepId:'stubborn-step',
    turnId:'stubborn-turn',
    instructionId:'stubborn-instruction',
    pendingInstructions:[{ instructionId:'stubborn-instruction', text:'Inspect and stop if nothing changes.' }],
    conversation:{ messages:[] },
  });
  assert.equal(blocked.status, 'blocked', 'repeated stagnation after the grace turn must still hard-block');
  assert.equal(blocked.blocker, 'no_progress_stagnation', 'kill-switch blocker must remain explicit');
  assert.ok(stubborn.calls.length >= 4 && stubborn.calls.length <= 5, `grace turn plus escalation expected; observed ${stubborn.calls.length} completions`);

  console.log('agent-runtime-no-progress-smoke: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
