'use strict';

const assert = require('node:assert/strict');
const Projection = require('../electron/rebuild-runtime-state');

let state = Projection.create();
assert.equal(state.runtime.active, false);
assert.equal(state.loop.state, 'stopped');
assert.equal(state.browserDelivery.state, 'idle');

state = Projection.fromSnapshot(state, {
  workspaceRoot:'G:\\Demo',
  runtimeControl:{active:true},
  agent:{running:true,status:'running',turnId:'turn-1',sessionId:'session-1'},
  provider:{
    configured:true,
    healthy:true,
    reachable:true,
    agentReady:true,
    agentReadiness:{status:'agent_ready',agentReady:true,checkedAt:'2026-08-14T10:00:00.000Z',capabilities:{completion:'verified',toolCalling:'verified',structuredOutput:'unsupported'},failureReasons:{}},
  },
  browser:{lifecycle:'ready',endpoint:'http://127.0.0.1:9222'},
  browserRelay:{running:true,lifecycle:'delivery_retry',target:{targetId:'tab-1',providerId:'chatgpt',title:'Conversation'},pendingResult:true,delivery:{state:'retry_wait',instructionId:'instruction-1',attempts:2,maxAttempts:5,error:{message:'Composer temporarily unavailable.'}}},
});

assert.equal(state.workspace.state,'connected');
assert.equal(state.runtime.state,'running');
assert.equal(state.provider.state,'agent_ready');
assert.equal(state.provider.agentReady,true);
assert.equal(state.provider.capabilities.toolCalling,'verified');
assert.equal(state.agentSession.turnId,'turn-1');
assert.equal(state.loop.state,'delivery_retry');
assert.equal(state.browserTarget.state,'attached');
assert.equal(state.browserDelivery.state,'retry_wait');
assert.equal(state.browserDelivery.attempts,2);
assert.equal(state.browserDelivery.detail,'Composer temporarily unavailable.');

const reachableOnly=Projection.providerProjection({configured:true,healthy:true,reachable:true,agentReady:false,agentReadiness:{status:'unverified',agentReady:false,checkedAt:null,capabilities:{completion:'unknown',toolCalling:'unknown',structuredOutput:'unknown'},failureReasons:{}}});
assert.equal(reachableOnly.state,'reachable_unverified');
assert.equal(reachableOnly.agentReady,false);
assert.match(reachableOnly.detail,/tool capability has not been verified/u);

const capabilityFailed=Projection.providerProjection({configured:true,healthy:true,reachable:true,agentReady:false,agentReadiness:{status:'capability_failed',agentReady:false,checkedAt:'2026-08-14T10:01:00.000Z',capabilities:{completion:'verified',toolCalling:'unsupported',structuredOutput:'unsupported'},failureReasons:{toolCalling:'Selected model emitted prose instead of the diagnostic tool call.'}}});
assert.equal(capabilityFailed.state,'capability_failed');
assert.equal(capabilityFailed.agentReady,false);
assert.match(capabilityFailed.detail,/diagnostic tool call/u);

state=Projection.withEvent(state,{phase:'browser_relay.delivery_failed',instructionId:'instruction-1',code:'COMPOSER_NOT_FOUND',detail:'Composer remained unavailable after bounded retry.',timestamp:'2026-08-14T00:00:00.000Z'});
assert.equal(state.operation.state,'delivery_failed');
assert.equal(state.problems.length,1);
assert.equal(state.problems[0].source,'delivery');
assert.match(state.problems[0].message,/bounded retry/u);
// Terminal latch: a success event cannot follow a failed terminal state.
state=Projection.withEvent(state,{phase:'browser_relay.result_sent',instructionId:'instruction-1',timestamp:'2026-08-14T00:00:00.100Z'});
assert.equal(state.operation.state,'delivery_failed');

state=Projection.withEvent(state,{phase:'browser_relay.instruction_recovery_required',status:'blocked',instructionId:'turn-r3',journalKey:'key-r3',journalState:'executing',detail:'Explicit reconciliation required.',recovery:{ambiguous:true,record:{state:'executing',workspaceRoot:'G:\Demo'},availableEvidence:{instructionRecord:true},missingEvidence:['durable_completion_or_abandonment_receipt']}});
assert.equal(state.operation.state,'recovery_required');
assert.equal(state.problems[0].source,'recovery');
assert.equal(state.problems[0].data.journalKey,'key-r3');
assert.equal(state.problems[0].data.recovery.record.state,'executing');
state=Projection.withEvent(state,{phase:'browser_relay.recovery_reconciled',journalKey:'key-r3',instructionId:'turn-r3'});
assert.equal(state.operation.state,'reconciled');
assert.equal(state.problems.some(item=>item.data?.journalKey==='key-r3'),false);

state=Projection.clearProblems(state);
// Correlation gate: a new instruction must be announced before its progress/terminal events apply.
state=Projection.withEvent(state,{phase:'browser_relay.instruction_received',instructionId:'instruction-2',operationId:'operation-2',timestamp:'2026-08-14T00:00:00.500Z'});
assert.equal(state.operation.state,'executing');
assert.equal(state.operation.instructionId,'instruction-2');
state=Projection.withEvent(state,{phase:'browser_relay.delivery_unverified',instructionId:'instruction-2',code:'SEND_NOT_CONFIRMED',detail:'Submission outcome could not be confirmed; automatic resend is disabled.',delivery:{evidenceLevel:'SUBMISSION_ACCEPTED'},timestamp:'2026-08-14T00:00:01.000Z'});
assert.equal(state.operation.state,'delivery_unverified');
assert.equal(state.browserDelivery.state,'submitted_unverified');
assert.equal(state.browserDelivery.evidenceLevel,'SUBMISSION_ACCEPTED');
assert.equal(state.problems[0].code,'SEND_NOT_CONFIRMED');

// Correlation gate: a late terminal event for a previous instruction must not mutate instruction-2 state.
const eventsBeforeLate=state.events.length;
state=Projection.withEvent(state,{phase:'browser_relay.delivery_failed',instructionId:'instruction-1',code:'LATE_FAILURE',detail:'Late failure from the previous instruction.'});
assert.equal(state.operation.state,'delivery_unverified');
assert.equal(state.operation.instructionId,'instruction-2');
assert.equal(state.problems.some(item=>item.code==='LATE_FAILURE'),false);
assert.equal(state.events.length,eventsBeforeLate+1);

// Correlation gate: an operation event without an instructionId is rejected.
state=Projection.withEvent(state,{phase:'browser_relay.result_queued',detail:'Queued without correlation id.'});
assert.equal(state.operation.state,'delivery_unverified');

// Correlation gate: same-instruction progress still applies.
state=Projection.withEvent(state,{phase:'browser_relay.instruction_received',instructionId:'instruction-3',operationId:'operation-3',timestamp:'2026-08-14T00:00:01.500Z'});
state=Projection.withEvent(state,{phase:'browser_relay.result_sent',instructionId:'instruction-3',timestamp:'2026-08-14T00:00:02.000Z'});
assert.equal(state.operation.state,'rendered_delivered');
assert.match(state.operation.detail,/verified/u);

// Terminal latch: contradictory and duplicate terminal events are rejected once terminal.
state=Projection.withEvent(state,{phase:'browser_relay.delivery_failed',instructionId:'instruction-3',code:'CONTRADICTED',detail:'Contradictory failure after verified delivery.'});
assert.equal(state.operation.state,'rendered_delivered');
assert.equal(state.problems.some(item=>item.code==='CONTRADICTED'),false);
state=Projection.withEvent(state,{phase:'browser_relay.result_sent',instructionId:'instruction-3',timestamp:'2026-08-14T00:00:03.000Z'});
assert.equal(state.operation.state,'rendered_delivered');
// Terminal latch: queued progress is rejected after a terminal state.
state=Projection.withEvent(state,{phase:'browser_relay.result_queued',instructionId:'instruction-3'});
assert.equal(state.operation.state,'rendered_delivered');

state=Projection.fromSnapshot(state,{
  workspaceRoot:'G:\\Demo',runtimeControl:{active:true},agent:{running:false,status:'idle'},provider:{configured:true,healthy:true,reachable:true,agentReady:true,agentReadiness:{status:'agent_ready',agentReady:true}},
  browserRelay:{running:false,lifecycle:'stopped',target:{targetId:'tab-2',providerId:'chatgpt'},pendingResult:false,delivery:{state:'deferred',instructionId:'instruction-4',attempts:0,maxAttempts:5,error:{message:'Relay stopped before queued result delivery; durable queue retained.'}}},
});
assert.equal(state.browserDelivery.state,'deferred');
assert.equal(state.browserDelivery.instructionId,'instruction-4');
assert.match(state.browserDelivery.detail,/durable queue retained/u);

state=Projection.withTerminal(state,{ok:true,terminalId:'terminal-1',fallback:true,mode:'process'});
assert.equal(state.terminal.state,'open');
assert.equal(state.terminal.fallback,true);
assert.match(state.terminal.detail,/fallback/u);

state=Projection.clearProblems(state);
assert.equal(state.problems.length,0);

// Revision ordering: a snapshot captured before newer event state is discarded entirely.
const revisionBeforeStaleTest=state.revision;
const stateBeforeStaleTest=state;
state=Projection.fromSnapshot(state,{workspaceRoot:'G:\\Stale',runtimeControl:{active:false},agent:{running:false,status:'idle'}},{revision:revisionBeforeStaleTest-3});
assert.equal(state,stateBeforeStaleTest);
assert.equal(state.revision,revisionBeforeStaleTest);

// Revision ordering: a snapshot tagged at the current revision applies and bumps the counter.
state=Projection.fromSnapshot(state,{
  workspaceRoot:'G:\\\\Demo',runtimeControl:{active:true},agent:{running:true,status:'running',turnId:'turn-9',sessionId:'session-9'},
  provider:{configured:true,healthy:true,reachable:true,agentReady:true,agentReadiness:{status:'agent_ready',agentReady:true}},
  browserRelay:{running:true,lifecycle:'running',target:{targetId:'tab-1',providerId:'chatgpt'}},
},{revision:revisionBeforeStaleTest});
assert.equal(state.revision,revisionBeforeStaleTest+1);
assert.equal(state.runtime.state,'running');
assert.equal(state.agentSession.turnId,'turn-9');

// Reload reconciliation (Case F): a renderer reload loses event state; the backend snapshot reconstructs it.
let reloaded=Projection.fromSnapshot(Projection.create(),{
  workspaceRoot:'G:\\\\Demo',runtimeControl:{active:true},agent:{running:true,status:'running'},
  provider:{configured:true,healthy:true,reachable:true},
  browserRelay:{running:true,lifecycle:'delivery_retry',target:{targetId:'tab-1',providerId:'chatgpt'},pendingResult:true,delivery:{state:'retry_wait',instructionId:'instruction-R',attempts:1,maxAttempts:3}},
});
assert.equal(reloaded.operation.state,'executing');
assert.equal(reloaded.operation.instructionId,'instruction-R');
assert.match(reloaded.operation.detail,/Reconciled from runtime snapshot/u);
assert.equal(reloaded.problems.length,0);

// Reload reconciliation: backend activity without an identifiable instruction is surfaced, never silently idle.
let unidentified=Projection.fromSnapshot(Projection.create(),{
  workspaceRoot:'G:\\\\Demo',runtimeControl:{active:true},agent:{running:true,status:'running'},
  provider:{configured:true,healthy:true,reachable:true},
  browserRelay:{running:true,lifecycle:'running',target:{targetId:'tab-1',providerId:'chatgpt'},pendingResult:true,delivery:{state:'queued'}},
});
assert.equal(unidentified.operation.state,'state_unavailable');
assert.equal(unidentified.operation.instructionId,null);
assert.equal(unidentified.problems[0].code,'OPERATION_STATE_UNAVAILABLE');

// Reconciliation never stomps live event-tracked operation state.
let live=Projection.withEvent(Projection.create(),{phase:'browser_relay.instruction_received',instructionId:'instruction-LIVE'});
live=Projection.fromSnapshot(live,{
  workspaceRoot:'G:\\\\Demo',runtimeControl:{active:true},agent:{running:true,status:'running'},
  provider:{configured:true,healthy:true,reachable:true},
  browserRelay:{running:false,lifecycle:'stopped',target:null,pendingResult:false,delivery:{state:'deferred',instructionId:'instruction-OLD'}},
});
assert.equal(live.operation.state,'executing');
assert.equal(live.operation.instructionId,'instruction-LIVE');

// ---- Step 5: single-writer projection boundary (apply) ---------------------
// Every reducer is reachable through apply with equivalent results.
const applyBase=Projection.create();
const viaDirect=Projection.withEvent(Projection.fromSnapshot(Projection.create(),{workspaceRoot:'G:\\\\Demo',runtimeControl:{active:true},agent:{running:true,status:'running'},provider:{configured:true,healthy:true,reachable:true},browserRelay:{running:true,lifecycle:'waiting_for_instruction',target:null,pendingResult:false}}),{phase:'browser_relay.instruction_received',instructionId:'instruction-AW',operationId:'op-AW'});
const viaApply=Projection.apply(Projection.apply(Projection.create(),{kind:'snapshot',snapshot:{workspaceRoot:'G:\\\\Demo',runtimeControl:{active:true},agent:{running:true,status:'running'},provider:{configured:true,healthy:true,reachable:true},browserRelay:{running:true,lifecycle:'waiting_for_instruction',target:null,pendingResult:false}}}),{kind:'event',event:{phase:'browser_relay.instruction_received',instructionId:'instruction-AW',operationId:'op-AW'}});
assert.equal(viaApply.operation.state,viaDirect.operation.state);
assert.equal(viaApply.operation.instructionId,viaDirect.operation.instructionId);

// Local UI lifecycle notifications are tagged renderer-local and cannot bypass gates.
let localGate=Projection.apply(viaApply,{kind:'event',event:{phase:'ui.operation_failed',status:'failed',detail:'UI-only failure.',origin:'renderer-local'}});
assert.equal(localGate.events[0].phase,'ui.operation_failed');
assert.equal(localGate.events[0].origin,'renderer-local');
assert.equal(localGate.operation.state,'executing');

// Terminal guards still hold through the single writer, including local events.
let guarded=Projection.apply(viaApply,{kind:'event',event:{phase:'browser_relay.result_sent',instructionId:'instruction-AW'}});
guarded=Projection.apply(guarded,{kind:'event',event:{phase:'browser_relay.result_queued',instructionId:'instruction-AW',origin:'renderer-local'}});
assert.equal(guarded.operation.state,'rendered_delivered');
// Rejected event remains observable in the event log, but did not mutate operation state.
assert.equal(guarded.events[0].phase,'browser_relay.result_queued');

// Malformed/unknown mutations are rejected observably; authoritative state is untouched.
const preReject=Projection.apply(viaApply,{kind:'targets',targets:[{targetId:'tab-AW',providerId:'chatgpt'}]});
const rejectUnknown=Projection.apply(preReject,{kind:'teleport'});
assert.equal(rejectUnknown.events[0].phase,'projection.mutation_rejected');
assert.equal(rejectUnknown.browserTarget.targets.length,1);
assert.equal(rejectUnknown.operation.state,'executing');
const rejectBadSnapshot=Projection.apply(preReject,{kind:'snapshot',snapshot:null});
assert.equal(rejectBadSnapshot.events[0].phase,'projection.mutation_rejected');
const rejectBadTargets=Projection.apply(preReject,{kind:'targets',targets:'tab-AW'});
assert.equal(rejectBadTargets.events[0].phase,'projection.mutation_rejected');
assert.deepEqual(rejectBadTargets.browserTarget.targets,rejectUnknown.browserTarget.targets);

// Step 3 stale-snapshot rejection still holds through apply.
const staleRev=preReject.revision;
const stale=Projection.apply(preReject,{kind:'snapshot',snapshot:{workspaceRoot:'G:\\\\Stale',runtimeControl:{active:false}},meta:{revision:staleRev-3}});
assert.equal(stale,preReject);

// Step 4 reload reconciliation still works through apply.
const reloadedApply=Projection.apply(Projection.apply(Projection.create(),{kind:'snapshot',snapshot:{workspaceRoot:'G:\\\\Demo',runtimeControl:{active:true},agent:{running:true,status:'running'},provider:{configured:true,healthy:true,reachable:true},browserRelay:{running:false,lifecycle:'stopped',target:null,pendingResult:true,delivery:{state:'queued'}}}}),{kind:'event',event:{phase:'browser_relay.instruction_received',instructionId:'instruction-RELOAD'}});
assert.equal(reloadedApply.operation.state,'executing');
assert.equal(reloadedApply.operation.instructionId,'instruction-RELOAD');

// clear_problems through the boundary.
const cleared=Projection.apply(preReject,{kind:'clear_problems'});
assert.equal(cleared.problems.length,0);


console.log('rebuild-runtime-state-smoke: PASS');
