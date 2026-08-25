'use strict';
// ASKUSER_SUSPENSION_SMOKE
//
// Verifies that an agent tool returning a WAITING_FOR_USER suspension is treated
// as a NON-TERMINAL suspended state rather than an ordinary observation that
// collapses into objective completion. Fixed defect report:
//   "askUser returned WAITING_FOR_USER, yet the runtime later emitted
//    objective.completed and marked the agent completed."
// PASS requires: WAITING_FOR_USER -> non-terminal suspended state; no
// objective.completed; no terminal completed; no second provider continuation
// before the user answers; the same instruction/session remains resumable.

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const ToolRegistry = require('../src/agent/ToolRegistry');
const { LiveAgentCore } = require('../src/agent/executive/LiveAgentCore');
const AgentSessionRuntime = require('../src/agent/executive/AgentSessionRuntime');

// askUser tool mirroring src/agent/executive/LiveToolContext.js
function createRegistry() {
  const registry = new ToolRegistry();
  registry.register('askUser', 'askUser',
    { type:'object', properties:{ question:{type:'string'} }, required:['question'] },
    async () => {
      const question = 'Which Git branch do you want me to inspect?';
      return { ok:true, observation:'WAITING_FOR_USER', question, message:'Question surfaced to the user; continue only after an answer arrives.', waiting:{ kind:'user', question } };
    });
  registry.register('inspect', 'inspect', { type:'object', properties:{} }, async () => ({ ok:true, observation:'inspected' }));
  return registry;
}

function createProvider() {
  let calls = 0;
  const histories = [];
  return {
    async complete({ messages = [] } = {}) {
      calls += 1;
      histories.push(messages);
      if (calls === 1) {
        return { content:'', toolCalls:[{ id:'ask-1', name:'askUser', arguments:{ question:'Which Git branch do you want me to inspect?' } }] };
      }
      return { content:'Inspected branch main.', toolCalls:[] };
    },
    calls: () => calls,
    histories: () => histories,
  };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'askuser-suspension-'));

  // ---- Section A: LiveAgentCore unit semantics -----------------------------
  const registryA = createRegistry();
  const providerA = createProvider();
  const agentA = new LiveAgentCore({ registry:registryA, provider:providerA, maxToolCalls:10 });
  const stepA = await agentA.step({ sessionId:'ask-session-a', objective:'Ask me which Git branch I want inspected.' });

  assert.equal(stepA.status, 'waiting_for_user', 'WAITING_FOR_USER must become a non-terminal suspended state at the core');
  assert.notEqual(stepA.status, 'completed', 'a user-wait must never be reported as terminal completed');
  assert.equal(providerA.calls(), 1, 'no second provider continuation may occur before the user answers');
  assert.equal(stepA.consumeInstructions, false, 'a suspended instruction must remain unconsumed so it can resume');

  // Resume the SAME session by supplying the answer as a new instruction.
  const stepA2 = await agentA.step({
    sessionId:'ask-session-a',
    objective:'Ask me which Git branch I want inspected.',
    pendingInstructions:[{ instructionId:'answer-branch', text:'Inspect branch main.' }],
  });
  assert.equal(stepA2.status, 'completed', 'the same session must be resumable and reach terminal completion after the answer');
  assert.equal(providerA.calls(), 2, 'resumption triggers exactly one more provider completion');
  assert.ok(JSON.stringify(providerA.histories()[1] || []).includes('WAITING_FOR_USER'), 'the resumed session must reuse the conversation that already holds the WAITING_FOR_USER tool result');

  // ---- Section B: AgentExecutive / runtime semantics -----------------------
  const eventsB = [];
  const registryB = createRegistry();
  const providerB = createProvider();
  const agentB = new LiveAgentCore({ registry:registryB, provider:providerB, maxToolCalls:10 });
  const runtimeB = new AgentSessionRuntime({
    workspaceRoot: tmp,
    stateRoot: tmp,
    stepRunnerFactory: ({ sessionId }) => stepContext => agentB.step({ ...stepContext, sessionId }),
    onEvent: event => eventsB.push(event),
  });

  const first = await runtimeB.submitInstruction({ objective:'Ask which branch.', instruction:'Ask me which Git branch I want inspected.' });
  const stateB1 = await first.runPromise;
  assert.equal(stateB1.status, 'waiting_for_user', 'runtime must expose a non-terminal waiting_for_user state, not completed');
  assert.equal(stateB1.completion, null, 'no objective completion record may be set while suspended');
  assert.ok(!eventsB.some(e => e.type === 'objective.completed'), 'objective.completed must NOT be emitted while waiting for the user');
  assert.ok(eventsB.some(e => e.type === 'user.waiting'), 'a user.waiting event must be emitted at the executive level');
  assert.ok(eventsB.some(e => e.type === 'runtime.waiting_for_user'), 'a runtime.waiting_for_user agent event must be emitted');

  // Same session resumes once the user answers.
  const second = await runtimeB.submitInstruction({ sessionId: stateB1.sessionId, newSession: false, instruction:'Inspect branch main.' });
  const stateB2 = await second.runPromise;
  assert.equal(stateB2.status, 'completed', 'after the user answers, the SAME session must resume to a terminal completed state');
  assert.ok(eventsB.some(e => e.type === 'objective.completed'), 'objective.completed must be emitted only AFTER the user answers');

  fs.rmSync(tmp, { recursive:true, force:true });
  console.log('askuser-suspension-smoke: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });