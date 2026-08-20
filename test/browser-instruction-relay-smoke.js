'use strict';

const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs');
const {BrowserInstructionRelay,parseQuickCommandEnvelope,assistantTurnFromSnapshot,parseTransportTurn,resultEnvelope,quickCommandResultEnvelope}=require('../src/agent/executive/BrowserInstructionRelay');
const {BrowserTransportJournal}=require('../src/system/browser-transport-journal');

const quick=(id,command,workspace='G:\\Demo')=>[
  '=== ACCESS AGENT INSTRUCTION START ===','VERSION: 1',`INSTRUCTION ID: ${id}`,`WORKSPACE: ${workspace}`,'TYPE: quick_command',`COMMAND: ${command}`,'=== ACCESS AGENT INSTRUCTION END ===',
].join('\n');
const legacyAgentEnvelope=(id,objective,workspace='G:\\Demo')=>[
  '=== ACCESS AGENT INSTRUCTION START ===','VERSION: 1',`INSTRUCTION ID: ${id}`,`WORKSPACE: ${workspace}`,'OBJECTIVE:',objective,'=== ACCESS AGENT INSTRUCTION END ===',
].join('\n');
const snap=(text,messageIndex=0,messageId='')=>({targetId:'tab-1',providerId:'chatgpt',text,generating:false,url:'https://chatgpt.com/c/abc',provenance:{verifiedAssistant:true,messagePresent:Boolean(text),messageIndex,messageId}});

(async()=>{
  assert.equal(parseQuickCommandEnvelope('Inspect package scripts.','G:\\Demo'),null);
  assert.equal(parseQuickCommandEnvelope(legacyAgentEnvelope('task-1','Inspect package scripts.'),'G:\\Demo'),null,'ordinary reasoning work must not require or be semantically parsed from an envelope');
  const parsedQuick=parseQuickCommandEnvelope(quick('cmd-1','git status'),'G:\\Demo');
  assert.equal(parsedQuick.type,'quick_command');
  assert.equal(parsedQuick.command,'git status');
  assert.equal(parseQuickCommandEnvelope(quick('x','git status','G:\\Other'),'G:\\Demo'),null);

  const natural=assistantTurnFromSnapshot(snap('Inspect package scripts.',4,'msg-4'));
  assert.equal(natural.type,'agent_instruction');
  assert.equal(natural.objective,'Inspect package scripts.');
  assert.match(natural.transportKey,/message:msg-4/u);
  assert.equal(parseTransportTurn(snap('Inspect package scripts.',4,'msg-4'),'G:\\Demo').objective,'Inspect package scripts.');
  assert.equal(parseTransportTurn(snap(quick('cmd-2','git status'),5,'msg-5'),'G:\\Demo').type,'quick_command');

  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'relay-journal-'));
  const journal=new BrowserTransportJournal(path.join(temp,'transport.jsonl'));
  const snapshots=[snap('Historical discussion.',0,'msg-0'),snap('Inspect package scripts.',1,'msg-1'),snap('Inspect package scripts.',1,'msg-1')];
  const submitted=[];const sent=[];
  const channel={
    snapshot:async()=>snapshots.shift()||snap('',2,'msg-empty'),
    send:async(_endpoint,_target,_provider,payload)=>{sent.push(payload);return{accepted:true};},
    expectedUrlFor:()=> 'https://chatgpt.com/c/abc',
  };
  const relay=new BrowserInstructionRelay({channel,getEndpoint:()=> 'http://127.0.0.1:7330',getWorkspaceRoot:()=> 'G:\\Demo',journal,submitInstruction:async input=>{submitted.push(input);return{ok:true,terminalState:'completed',sessionId:'session-browser-chat',summary:'All checks passed.',evidence:[{source:'runtime',toolCallId:'call-1'}]};},storeResult:async()=>({sha256:'a'.repeat(64),relativePath:'browser-relay/a.json'}),pollIntervalMs:500});
  relay._schedule=()=>{};
  relay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});
  await relay.start();
  assert.equal(relay.status().lifecycle,'waiting_for_instruction');
  await relay._tick();
  assert.equal(submitted.length,1);
  assert.equal(submitted[0].inbound,'assistant_turn');
  assert.equal(submitted[0].instruction,'Inspect package scripts.');
  assert.equal(submitted[0].objective,'Inspect package scripts.');
  assert.equal(submitted[0].newSession,false,'browser turns should continue the local reasoning session rather than force a fresh session per turn');
  assert.equal(submitted[0].browser.url,'https://chatgpt.com/c/abc');
  await relay._tick();
  assert.equal(sent.length,1);
  assert.match(sent[0],/STATUS: COMPLETE/u);
  assert.match(sent[0],/RESULT RECORD SHA256: a{64}/u);
  assert.match(resultEnvelope({instructionId:'x',result:{ok:true,terminalState:'completed',summary:'done'}}),/STATUS: COMPLETE/u);
  const lifecycleStatusCases=[
    ['completed',true,'COMPLETE'],
    ['waiting_for_input',false,'WAITING'],
    ['waiting_for_dependency',false,'WAITING'],
    ['blocked',false,'BLOCKED'],
    ['failed',false,'FAILED'],
    ['timed_out',false,'TIMED_OUT'],
    ['stopped',false,'STOPPED'],
    ['cancelled',false,'CANCELLED'],
    ['unknown_state',false,'FAILED'],
  ];
  for(const [terminalState,ok,expectedStatus] of lifecycleStatusCases){
    const envelope=resultEnvelope({
      instructionId:`state-${terminalState}`,
      result:{
        ok,
        terminalState,
        summary:`probe-${terminalState}`,
        evidence:[{type:'probe'}],
      },
    });
    assert.match(
      envelope,
      new RegExp(`^STATUS: ${expectedStatus}$`,'mu'),
      `${terminalState} must preserve its lifecycle class in the outbound result`,
    );
    assert.match(
      envelope,
      new RegExp(`^NEXT STATE: ${terminalState}$`,'mu'),
      `${terminalState} must remain intact as the canonical next state`,
    );
  }

  const ownershipJournal=new BrowserTransportJournal(path.join(temp,'delivery-response.jsonl'));
  const ownershipSnapshots=[
    snap('Historical baseline.',0,'own-0'),
    snap('Do one bounded task.',1,'own-a'),
    snap('Do one bounded task.',1,'own-a'),
    snap('I received the Access result.',2,'own-b'),
    snap('Now perform a genuinely new turn.',3,'own-c'),
  ];
  const ownershipSubmitted=[];const ownershipSent=[];const ownershipEvents=[];
  const ownershipRelay=new BrowserInstructionRelay({
    channel:{
      snapshot:async()=>ownershipSnapshots.shift()||snap('',4,'own-empty'),
      send:async(_e,_t,_p,payload)=>{ownershipSent.push(payload);return{accepted:true,response:'UNVERIFIED'};},
      expectedUrlFor:()=> 'https://chatgpt.com/c/abc',
    },
    getEndpoint:()=> 'http://127.0.0.1:7330',
    getWorkspaceRoot:()=> 'G:\\Demo',
    submitInstruction:async input=>{ownershipSubmitted.push(input);return{ok:true,terminalState:'completed',sessionId:'ownership-session',summary:'bounded result'};},
    storeResult:async()=>({sha256:'b'.repeat(64),relativePath:'browser-relay/b.json'}),
    journal:ownershipJournal,
    onEvent:event=>ownershipEvents.push(event),
  });
  ownershipRelay._schedule=()=>{};
  ownershipRelay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});
  await ownershipRelay.start();
  await ownershipRelay._tick();
  assert.equal(ownershipSubmitted.length,1,'assistant A must execute exactly once');
  await ownershipRelay._tick();
  assert.equal(ownershipSent.length,1,'result R must be submitted exactly once');
  let ownershipState=ownershipJournal.getLoopState({workspaceRoot:'G:\\Demo',conversationId:'https://chatgpt.com/c/abc',targetId:'tab-1'});
  assert.equal(ownershipState.deliveryResponse.state,'pending','accepted result delivery must open one durable response-ownership boundary');
  await ownershipRelay._tick();
  assert.equal(ownershipSubmitted.length,1,'assistant B caused by result delivery must not be locally re-executed');
  assert.equal(ownershipRelay.status().lifecycle,'waiting_for_instruction','consuming the owned provider response must return the relay to stable waiting');
  const responseTurn=assistantTurnFromSnapshot(snap('I received the Access result.',2,'own-b'));
  const responseRecord=ownershipJournal.get({workspaceRoot:'G:\\Demo',conversationId:'https://chatgpt.com/c/abc',targetId:'tab-1',instructionId:responseTurn.instructionId,transportKey:responseTurn.transportKey,raw:responseTurn.raw});
  assert.equal(responseRecord.state,'consumed');
  assert.equal(responseRecord.disposition,'delivery_response');
  ownershipState=ownershipJournal.getLoopState({workspaceRoot:'G:\\Demo',conversationId:'https://chatgpt.com/c/abc',targetId:'tab-1'});
  assert.equal(ownershipState.deliveryResponse.state,'consumed');
  assert.equal(ownershipState.deliveryResponse.responseInstructionId,responseTurn.instructionId);
  assert.ok(ownershipEvents.some(event=>event.phase==='browser_relay.delivery_response_consumed'));
  await ownershipRelay._tick();
  assert.equal(ownershipSubmitted.length,2,'later independent assistant C must remain eligible and execute exactly once');
  assert.equal(ownershipSubmitted[1].instruction,'Now perform a genuinely new turn.');

  const unresolvedJournal=new BrowserTransportJournal(path.join(temp,'delivery-response-recovery.jsonl'));
  const unresolvedScope={workspaceRoot:'G:\\Demo',conversationId:'https://chatgpt.com/c/abc',targetId:'tab-1'};
  unresolvedJournal.markLoopStarted(unresolvedScope,{lastInstructionHash:'previous',deliveryResponse:{state:'pending',sourceInstructionId:'turn-source',sourceTransportKey:'assistant-turn:message:source:hash',submittedAt:new Date().toISOString()}});
  const unresolvedEvents=[];
  const unresolvedRelay=new BrowserInstructionRelay({
    channel:{snapshot:async()=>snap('Current visible assistant.',8,'restart-visible'),send:async()=>({accepted:true}),expectedUrlFor:()=> 'https://chatgpt.com/c/abc'},
    getEndpoint:()=> 'http://127.0.0.1:7330',getWorkspaceRoot:()=> 'G:\\Demo',submitInstruction:async()=>{throw new Error('must not execute while ownership is ambiguous');},journal:unresolvedJournal,onEvent:event=>unresolvedEvents.push(event),
  });
  unresolvedRelay._schedule=()=>{};unresolvedRelay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});
  await assert.rejects(()=>unresolvedRelay.start(),error=>error.code==='DELIVERY_RESPONSE_RECOVERY_REQUIRED');
  assert.equal(unresolvedRelay.status().lifecycle,'recovery');
  assert.ok(unresolvedEvents.some(event=>event.phase==='browser_relay.delivery_response_recovery_required'));

  const sameTextJournal=new BrowserTransportJournal(path.join(temp,'same-text.jsonl'));
  const sameTextSnapshots=[snap('baseline',0,'msg-b'),snap('Repeatable natural language.',1,'msg-1'),snap('Repeatable natural language.',2,'msg-2')];
  const sameTextSubmitted=[];
  const sameTextRelay=new BrowserInstructionRelay({channel:{snapshot:async()=>sameTextSnapshots.shift()||snap('',3,'msg-empty'),send:async()=>({accepted:true}),expectedUrlFor:()=> 'https://chatgpt.com/c/abc'},getEndpoint:()=> 'http://127.0.0.1:7330',getWorkspaceRoot:()=> 'G:\\Demo',submitInstruction:async input=>{sameTextSubmitted.push(input);return{ok:true,terminalState:'completed',summary:'done'};},journal:sameTextJournal});
  sameTextRelay._schedule=()=>{};sameTextRelay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});await sameTextRelay.start();await sameTextRelay._tick();sameTextRelay.pending=null;sameTextRelay.lifecycle='waiting_for_instruction';await sameTextRelay._tick();
  assert.equal(sameTextSubmitted.length,2,'distinct assistant message identities must not collapse merely because their text is identical');

  let reasoningCalls=0;let quickCalls=0;const quickSent=[];
  const quickSnapshots=[snap('',0,'q0'),snap(quick('cmd-2','git status'),1,'q1'),snap(quick('cmd-2','git status'),1,'q1')];
  const quickRelay=new BrowserInstructionRelay({
    channel:{snapshot:async()=>quickSnapshots.shift()||snap('',2,'q2'),send:async(_e,_t,_p,payload)=>{quickSent.push(payload);return{accepted:true};},expectedUrlFor:()=> 'https://chatgpt.com/c/abc'},
    getEndpoint:()=> 'http://127.0.0.1:7330',getWorkspaceRoot:()=> 'G:\\Demo',
    submitInstruction:async()=>{reasoningCalls+=1;return{ok:true};},
    executeQuickCommand:async input=>{quickCalls+=1;assert.equal(input.command,'git status');return{ok:true,command:'git status',cwd:'G:\\Demo',exitCode:0,stdout:'clean',stderr:'',receipt:{id:'receipt-1'}};},
    journal:new BrowserTransportJournal(path.join(temp,'quick.jsonl')),
  });
  quickRelay._schedule=()=>{};quickRelay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});await quickRelay.start();await quickRelay._tick();await quickRelay._tick();
  assert.equal(reasoningCalls,0,'typed quick command must remain the only structured bypass around the local reasoning agent');
  assert.equal(quickCalls,1);
  assert.match(quickSent[0],/ACCESS AGENT QUICK COMMAND RESULT START/u);
  assert.match(quickCommandResultEnvelope({instructionId:'x',result:{ok:true,command:'git status',cwd:'G:\\Demo',exitCode:0}}),/STATUS: COMPLETE/u);

  const crashJournal=new BrowserTransportJournal(path.join(temp,'crash.jsonl'));
  const crashSnapshot=snap('Potentially mutating work.',7,'msg-crash');
  const crashInstruction=assistantTurnFromSnapshot(crashSnapshot);
  const journalInput={workspaceRoot:'G:\\Demo',conversationId:'https://chatgpt.com/c/abc',targetId:'tab-1',instructionId:crashInstruction.instructionId,transportKey:crashInstruction.transportKey,raw:crashInstruction.raw};
  crashJournal.markLoopStarted({workspaceRoot:'G:\\Demo',conversationId:'https://chatgpt.com/c/abc',targetId:'tab-1'});
  crashJournal.observe(journalInput);crashJournal.markExecuting(journalInput);
  const recoveryEvents=[];
  const recovery=new BrowserInstructionRelay({channel:{snapshot:async()=>crashSnapshot,send:async()=>({}),expectedUrlFor:()=> 'https://chatgpt.com/c/abc'},getEndpoint:()=> 'http://127.0.0.1:7330',getWorkspaceRoot:()=> 'G:\\Demo',submitInstruction:async()=>{throw new Error('must not reexecute');},journal:crashJournal,onEvent:event=>recoveryEvents.push(event)});
  recovery._schedule=()=>{};recovery.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});
  await assert.rejects(()=>recovery.start(),error=>error.code==='INSTRUCTION_RECOVERY_REQUIRED');
  assert.equal(recovery.status().lifecycle,'recovery');
  assert.ok(recoveryEvents.some(event=>event.phase==='browser_relay.instruction_recovery_required'));
const blockedEvent=recoveryEvents.find(event=>event.phase==='browser_relay.instruction_recovery_required');
assert.equal(blockedEvent.journalKey,crashJournal.get(journalInput).key);
assert.equal(blockedEvent.recovery.ambiguous,true);
crashJournal.reconcileRecovery({
key:blockedEvent.journalKey,
workspaceRoot:journalInput.workspaceRoot,
conversationId:journalInput.conversationId,
disposition:'quarantined',
reason:'Test proves explicit reconciliation skips replay.',
operator:'smoke-test',
});
let reconciledSubmissions=0;
const reconciledRelay=new BrowserInstructionRelay({
channel:{snapshot:async()=>crashSnapshot,send:async()=>({}),expectedUrlFor:()=>journalInput.conversationId},
getEndpoint:()=> 'cdp-endpoint',
getWorkspaceRoot:()=> journalInput.workspaceRoot,
submitInstruction:async()=>{reconciledSubmissions+=1;throw new Error('reconciled history must not execute');},
journal:crashJournal,
});
reconciledRelay._schedule=()=>{};
reconciledRelay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:journalInput.conversationId});
const reconciledStarted=await reconciledRelay.start();
assert.equal(reconciledStarted.lifecycle,'waiting_for_instruction');
assert.equal(reconciledSubmissions,0);
await reconciledRelay._tick();
assert.equal(reconciledSubmissions,0,'reconciled historical turn must remain a non-executable baseline');

// Negative provenance guard coverage: an assistant turn present without verified
  // assistant-message provenance must fail the relay guard (ASSISTANT_PROVENANCE_UNVERIFIED).
  {
    const deniedTemp=fs.mkdtempSync(path.join(os.tmpdir(),'relay-provenance-'));
    const deniedJournal=new BrowserTransportJournal(path.join(deniedTemp,'denied.jsonl'));
    const deniedSnapshot={targetId:'tab-1',providerId:'chatgpt',text:'Inspect package scripts.',generating:false,url:'https://chatgpt.com/c/abc',provenance:{authorRole:'provider',selectorFamily:['[data-message-author-role="assistant"]'],messageIndex:0,messageId:'msg-unverified',verifiedAssistant:false,messagePresent:true}};
    const deniedRelay=new BrowserInstructionRelay({
      channel:{snapshot:async()=>deniedSnapshot,send:async()=>({}),expectedUrlFor:()=> 'https://chatgpt.com/c/abc'},
      getEndpoint:()=> 'http://127.0.0.1:7330',
      getWorkspaceRoot:()=> 'G:\\\\Demo',
      submitInstruction:async()=>{throw new Error('must not execute when assistant provenance is unverified');},
      journal:deniedJournal,
    });
    deniedRelay._schedule=()=>{};
    deniedRelay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});
    await assert.rejects(()=>deniedRelay.start(),error=>error.code==='ASSISTANT_PROVENANCE_UNVERIFIED');
  }
  console.log('browser-instruction-relay-smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
