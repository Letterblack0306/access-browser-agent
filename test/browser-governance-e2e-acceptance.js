'use strict';

// End-to-end system acceptance: the original failure from governance terminal
// block, through immediate LiveAgentCore stop, durable queuing, a transport fault,
// browser-authority revalidation, recovery, and delivery back into the SAME
// ChatGPT conversation. Deterministic in-process regression chaining the real
// modules: ToolRegistry -> LiveAgentCore -> BrowserTransportJournal ->
// BrowserInstructionRelay -> BrowserSessionAuthority endpoint contract.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ToolRegistry=require('../src/agent/ToolRegistry');
const {ACTION_KINDS}=require('../src/agent/ActionProtocol');
const {LiveAgentCore}=require('../src/agent/executive/LiveAgentCore');
const {BrowserTransportJournal}=require('../src/system/browser-transport-journal');
const {BrowserInstructionRelay}=require('../src/agent/executive/BrowserInstructionRelay');

const workspaceRoot=fs.mkdtempSync(path.join(os.tmpdir(),'access-governance-e2e-'));
const journalFilePath=path.join(workspaceRoot,'transport.jsonl');
const journal=new BrowserTransportJournal(journalFilePath);
const CHAT_TARGET_ID='chat-tab-abc';
const CHAT_URL='https://chatgpt.com/c/abc';

// LiveAgentCore over the real ToolRegistry: a governed runCommand must be
// terminal-blocked by ChangeGovernanceGuard, so step() stops after ONE tool call.
const registry=new ToolRegistry([{
  name:'runCommand',description:'exact governed command execution',
  schema:{type:'object',properties:{command:{type:'string'}},required:['command']},
  actionKind:ACTION_KINDS.COMMAND_EXECUTE,category:'validate',readOnly:false,
  execute:async()=>({ok:true,exitCode:0}),
}]);
let providerCalls=0;
const provider={complete:async()=>{
  providerCalls+=1;
  if(providerCalls===1)return{content:'',toolCalls:[{id:'tc-1',name:'runCommand',arguments:{command:'publish --force'}}]};
  return{content:'This provider response must never be reached: a terminal tool forced the objective to stop.',toolCalls:[]};
}};
const core=new LiveAgentCore({registry,provider,maxToolCalls:40});

(async()=>{
  let executions=0;let lastBlocker=null;
  const submitInstruction=async input=>{
    executions+=1;
    const step=await core.step({sessionId:'e2e',objective:input.objective||input.instruction||'',pendingInstructions:[{instructionId:input.instructionId,text:input.objective||input.instruction||''}],emitExecutionEvent:async()=>({data:{}}),emitAgentEvent:async()=>{}});
    lastBlocker=step.blocker||null;
    return{
      ok:step.status!=='blocked',
      terminalState:step.status==='blocked'?'blocked':(step.status==='completed'?'completed':'failed'),
      summary:step.summary||step.reason||'no summary',
      evidence:Array.isArray(step.evidence)?step.evidence:[],sessionId:'e2e',
    };
  };

  let snapIndex=0;
  const sendRecord=[];
  let sendAttempts=0;
  let authorityDead=false;
  const endpointAuthority={
    getCalls:0,recoveredPort:null,
    async getLiveEndpoint(){
      this.getCalls+=1;
      if(authorityDead){
        authorityDead=false;this.recoveredPort=7331;return 'http://127.0.0.1:7331';
      }
      return 'http://127.0.0.1:7330';
    },
  };
  const snap=(text,messageIndex=0,messageId='')=>({targetId:CHAT_TARGET_ID,providerId:'chatgpt',text,generating:false,url:CHAT_URL,provenance:{verifiedAssistant:true,messagePresent:Boolean(text),messageIndex,messageId}});

  const channel={
    expectedUrlFor:()=>CHAT_URL,
    // First delivery attempt throws a transient CDP ECONNREFUSED (the validated
    // endpoint died right before send); the queued result must survive and be
    // delivered after the authority relocates to a fresh endpoint.
    snapshot:async()=>{
      snapIndex+=1;
      if(snapIndex===1)return snap('This conversation baseline is historical and must never be executed again.',0,'base-0');
      if(snapIndex===2)return snap('Run the governed command and confirm it is terminal-blocked.',1,'ins-1');
      return snap('',snapIndex,'post-'+snapIndex);
    },
    send:async(endpoint,targetId,providerId,payload)=>{
      sendAttempts+=1;
      sendRecord.push({endpoint,targetId,providerId,payload:String(payload||'')});
      if(sendAttempts===1){const error=new Error('fetch failed');error.cause=Object.assign(new Error('connect ECONNREFUSED '+endpoint),{code:'ECONNREFUSED'});throw error;}
      return{accepted:true};
    },
  };

  const relay=new BrowserInstructionRelay({
    channel,
    getEndpoint:()=>endpointAuthority.getLiveEndpoint(),
    getWorkspaceRoot:()=>workspaceRoot,
    submitInstruction,
    journal,
  });
  relay._schedule=()=>{};
  relay.selectTarget({targetId:CHAT_TARGET_ID,providerId:'chatgpt',url:CHAT_URL});
  await relay.start();

  // tick 1: parse instruction -> submitInstruction -> LiveAgentCore terminal block
  await relay._tick({schedule:false});
  assert.equal(executions,1,'the instruction must execute exactly once');
  assert.equal(providerCalls,1,'LiveAgentCore must stop after the first tool call (no budget exhaustion)');
  assert.equal(lastBlocker,'terminal_tool','the result must be terminal_tool, never tool_budget');
  assert.ok(relay.pending,'a blocked result must be queued for delivery');

  // tick 2: first delivery attempt fails transiently on the pre-fault endpoint
  await relay._tick({schedule:false});
  assert.equal(sendAttempts,1,'one delivery attempt on the pre-fault endpoint');
  assert.equal(sendRecord[0].endpoint,'http://127.0.0.1:7330','pre-fault send used the cached endpoint');
  assert.ok(relay.pending,'a transient transport failure must not lose the queued result');

  // Browser death detected => authority revalidates and relocates 7330 -> 7331;
  // the queued terminal result is delivered on the revalidated endpoint.
  authorityDead=true;
  relay.pending.nextAttemptAt=0; // clear retry backoff so synchronous ticks can deliver
  await relay._tick({schedule:false});
  assert.equal(sendAttempts,2,'the queued result must be delivered after recovery');
  assert.equal(sendRecord[1].endpoint,'http://127.0.0.1:7331','delivery must use the revalidated, not the stale, endpoint');
  assert.equal(relay.pending,null,'delivered pending must be consumed');
  assert.equal(sendRecord[1].targetId,CHAT_TARGET_ID,'result must return to the same ChatGPT target');
  assert.equal(sendRecord[1].providerId,'chatgpt');
  assert.ok(sendRecord[1].payload.includes('=== ACCESS AGENT RESULT START ==='),'the blocked result envelope must be delivered');
  assert.ok(sendRecord[1].payload.includes('STATUS: BLOCKED'),'the terminal blocked status must reach the conversation');

  // No duplicate execution across the whole fault/recovery/delivery window
  assert.equal(executions,1,'recovery must never re-execute the instruction');
  assert.equal(providerCalls,1,'the reasoning loop must never run again after the terminal stop');

  const ledger=fs.readFileSync(journalFilePath,'utf8');
  assert.ok(ledger.includes('"state":"delivered"'),'journal must record a single delivered terminal result');

  console.log('browser-governance-e2e-acceptance: PASS');
  console.log(JSON.stringify({blocker:lastBlocker,providerCalls,executions,sendAttempts,sendEndpoint:sendRecord[1].endpoint,sendTarget:sendRecord[1].targetId,chatUrl:CHAT_URL,durableDelivered:ledger.includes('"state":"delivered"')},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});