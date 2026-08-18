'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {BrowserInstructionRelay,assistantTurnFromSnapshot}=require('../src/agent/executive/BrowserInstructionRelay');
const {BrowserTransportJournal}=require('../src/system/browser-transport-journal');

function snap(targetId,text,messageIndex,messageId){
  return {
    targetId,
    providerId:'chatgpt',
    text,
    generating:false,
    url:'https://chatgpt.com/c/abc',
    provenance:{verifiedAssistant:true,messagePresent:true,messageIndex,messageId},
  };
}

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'access-relay-restart-'));
  const conversationId='https://chatgpt.com/c/abc';
  const workspaceRoot='G:\\Demo';
  const visible=snap('tab-2','I received the Access result.',2,'own-b');
  const turn=assistantTurnFromSnapshot(visible);

  const safeJournal=new BrowserTransportJournal(path.join(root,'safe.jsonl'));
  const oldInput={workspaceRoot,conversationId,targetId:'tab-1',instructionId:turn.instructionId,transportKey:turn.transportKey,raw:turn.raw};
  safeJournal.observe(oldInput);
  safeJournal.markConsumed(oldInput,{disposition:'delivery_response',sourceInstructionId:'turn-source'});
  safeJournal.markLoopStarted({workspaceRoot,conversationId,targetId:'tab-1'},{
    lastInstructionHash:'previous-hash',
    deliveryResponse:{state:'consumed',sourceInstructionId:'turn-source',responseInstructionId:turn.instructionId,responseTransportKey:turn.transportKey},
  });

  let safeSubmissions=0;
  const safeRelay=new BrowserInstructionRelay({
    channel:{snapshot:async()=>visible,send:async()=>({accepted:true}),expectedUrlFor:()=>conversationId},
    getEndpoint:()=> 'http://127.0.0.1:7330',
    getWorkspaceRoot:()=> workspaceRoot,
    submitInstruction:async()=>{safeSubmissions+=1;return{ok:true,terminalState:'completed',summary:'must not execute'};},
    journal:safeJournal,
  });
  safeRelay._schedule=()=>{};
  safeRelay.selectTarget({targetId:'tab-2',providerId:'chatgpt',url:conversationId});
  const safeStarted=await safeRelay.start();
  assert.equal(safeStarted.lifecycle,'waiting_for_instruction','a safely consumed historical response must be adoptable after CDP target replacement');
  assert.equal(safeStarted.running,true);
  assert.equal(safeSubmissions,0,'restart adoption must not re-execute the consumed provider response');
  await safeRelay._tick();
  assert.equal(safeSubmissions,0,'the adopted baseline must remain non-executable on the first poll');
  const persistedAcrossTarget=safeJournal.get({...oldInput,targetId:'tab-2'});
  assert.equal(persistedAcrossTarget.state,'consumed','journal identity must survive target replacement');
  assert.equal(persistedAcrossTarget.disposition,'delivery_response');

  const ambiguousJournal=new BrowserTransportJournal(path.join(root,'ambiguous.jsonl'));
  ambiguousJournal.observe(oldInput);
  ambiguousJournal.markConsumed(oldInput,{disposition:'unknown_consumption'});
  ambiguousJournal.markLoopStarted({workspaceRoot,conversationId,targetId:'tab-1'},{lastInstructionHash:'previous-hash'});
  const ambiguousRelay=new BrowserInstructionRelay({
    channel:{snapshot:async()=>visible,send:async()=>({accepted:true}),expectedUrlFor:()=>conversationId},
    getEndpoint:()=> 'http://127.0.0.1:7330',
    getWorkspaceRoot:()=> workspaceRoot,
    submitInstruction:async()=>{throw new Error('ambiguous consumed history must not execute');},
    journal:ambiguousJournal,
  });
  ambiguousRelay._schedule=()=>{};
  ambiguousRelay.selectTarget({targetId:'tab-2',providerId:'chatgpt',url:conversationId});
  await assert.rejects(()=>ambiguousRelay.start(),error=>error.code==='INSTRUCTION_RECOVERY_REQUIRED');
  assert.equal(ambiguousRelay.status().lifecycle,'recovery','unknown consumed history must remain fail-closed');

  console.log('browser-relay-restart-identity-smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
