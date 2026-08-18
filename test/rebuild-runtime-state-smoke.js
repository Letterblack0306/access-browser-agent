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

state=Projection.withEvent(state,{phase:'browser_relay.instruction_recovery_required',status:'blocked',instructionId:'turn-r3',journalKey:'key-r3',journalState:'executing',detail:'Explicit reconciliation required.',recovery:{ambiguous:true,record:{state:'executing',workspaceRoot:'G:\Demo'},availableEvidence:{instructionRecord:true},missingEvidence:['durable_completion_or_abandonment_receipt']}});
assert.equal(state.operation.state,'recovery_required');
assert.equal(state.problems[0].source,'recovery');
assert.equal(state.problems[0].data.journalKey,'key-r3');
assert.equal(state.problems[0].data.recovery.record.state,'executing');
state=Projection.withEvent(state,{phase:'browser_relay.recovery_reconciled',journalKey:'key-r3',instructionId:'turn-r3'});
assert.equal(state.operation.state,'reconciled');
assert.equal(state.problems.some(item=>item.data?.journalKey==='key-r3'),false);

state=Projection.clearProblems(state);
state=Projection.withEvent(state,{phase:'browser_relay.delivery_unverified',instructionId:'instruction-2',code:'SEND_NOT_CONFIRMED',detail:'Submission outcome could not be confirmed; automatic resend is disabled.',delivery:{evidenceLevel:'SUBMISSION_ACCEPTED'},timestamp:'2026-08-14T00:00:01.000Z'});
assert.equal(state.operation.state,'delivery_unverified');
assert.equal(state.browserDelivery.state,'submitted_unverified');
assert.equal(state.browserDelivery.evidenceLevel,'SUBMISSION_ACCEPTED');
assert.equal(state.problems[0].code,'SEND_NOT_CONFIRMED');

state=Projection.withEvent(state,{phase:'browser_relay.result_sent',instructionId:'instruction-3',timestamp:'2026-08-14T00:00:02.000Z'});
assert.equal(state.operation.state,'rendered_delivered');
assert.match(state.operation.detail,/verified/u);

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

console.log('rebuild-runtime-state-smoke: PASS');
