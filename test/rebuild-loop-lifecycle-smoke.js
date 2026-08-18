'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {BrowserInstructionRelay}=require('../src/agent/executive/BrowserInstructionRelay');
const {BrowserTransportJournal}=require('../src/system/browser-transport-journal');

const workspace='G:\\Rebuild';
const chatUrl='https://chatgpt.com/c/rebuild';
const assistantTurn=(text,id=null,index=0)=>({
  targetId:'tab-1',providerId:'chatgpt',text,generating:false,title:'ChatGPT',url:chatUrl,
  provenance:{verifiedAssistant:true,messagePresent:Boolean(text),messageId:id,messageIndex:index,authorRole:'assistant'},
});
function targetSnapshot(text='',generating=false,targetId='tab-1',messageId=null,messageIndex=0){
  const snapshot=assistantTurn(text,messageId,messageIndex);
  return{...snapshot,targetId,generating};
}
function createRelay({send,instruction='Inspect package.json.',events=[],journal,targetId='tab-1'}={}){
  let snapshots=0;let submissions=0;
  const relay=new BrowserInstructionRelay({
    channel:{
      expectedUrlFor:()=>chatUrl,
      snapshot:async()=>{snapshots+=1;return snapshots===1?targetSnapshot('',false,targetId,null,-1):targetSnapshot(instruction,false,targetId,'assistant-task-1',0);},
      send,
    },
    getEndpoint:()=> 'http://127.0.0.1:9222',getWorkspaceRoot:()=>workspace,journal,
    submitInstruction:async input=>{
      submissions+=1;
      assert.equal(input.inbound,'assistant_turn','normal Browser Loop work must arrive as an assistant-authored conversation turn');
      assert.equal(input.source,'browser-provider');
      assert.equal(input.newSession,false,'normal Browser Loop turns must continue the local reasoning session');
      assert.equal(input.instruction,instruction,'transport must preserve the assistant turn text without semantic extraction');
      return{ok:true,terminalState:'completed',summary:'Inspected package.json.',sessionId:'session-1'};
    },
    onEvent:event=>events.push(event),deliveryRetryMs:100,deliveryMaxAttempts:3,deliveryMaxElapsedMs:10000,
  });
  relay._schedule=()=>{};
  relay.selectTarget({targetId,providerId:'chatgpt',provider:'ChatGPT',title:'ChatGPT',url:chatUrl});
  return{relay,getSubmissions:()=>submissions};
}

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rebuild-loop-'));

  {
    const events=[];let attempts=0;
    const journal=new BrowserTransportJournal(path.join(temp,'retry.jsonl'));
    const {relay,getSubmissions}=createRelay({events,journal,send:async()=>{attempts+=1;if(attempts<3){const error=new Error('Composer temporarily unavailable.');error.code='COMPOSER_NOT_FOUND';throw error;}return{accepted:true,evidenceLevel:'RENDERED_DELIVERY_VERIFIED'};}});
    await relay.start();await relay._tick({schedule:false});
    assert.equal(getSubmissions(),1);assert.equal(relay.status().pendingResult,true);assert.equal(relay.status().lifecycle,'result_queued');
    await relay._tick({schedule:false});
    assert.equal(relay.status().delivery.state,'retry_wait');assert.ok(events.some(event=>event.phase==='browser_relay.delivery_retry'));
    relay.pending.nextAttemptAt=0;await relay._tick({schedule:false});
    relay.pending.nextAttemptAt=0;await relay._tick({schedule:false});
    assert.equal(relay.status().pendingResult,false);assert.equal(relay.status().delivery.state,'accepted');
    await relay._tick({schedule:false});assert.equal(getSubmissions(),1,'the same assistant transport turn must never execute twice');
  }

  {
    const events=[];
    const journal=new BrowserTransportJournal(path.join(temp,'ambiguous.jsonl'));
    let sendAttempts=0;
    const {relay}=createRelay({events,journal,send:async()=>{sendAttempts+=1;const error=new Error('Submission outcome could not be confirmed.');error.code='SEND_NOT_CONFIRMED';throw error;}});
    await relay.start();await relay._tick({schedule:false});await relay._tick({schedule:false});
    assert.equal(sendAttempts,1,'post-submit ambiguity must never be automatically retried');
    assert.equal(relay.status().pendingResult,false);
    assert.equal(relay.status().lifecycle,'delivery_unverified');
    assert.equal(relay.status().delivery.state,'submitted_unverified');
    assert.ok(events.some(event=>event.phase==='browser_relay.delivery_unverified'));
    assert.ok(!events.some(event=>event.phase==='browser_relay.delivery_retry'));
  }

  {
    const journalPath=path.join(temp,'restore.jsonl');
    const journal=new BrowserTransportJournal(journalPath);
    const first=createRelay({journal,send:async()=>({accepted:true,evidenceLevel:'RENDERED_DELIVERY_VERIFIED'})});
    await first.relay.start();await first.relay._tick({schedule:false});
    assert.equal(first.getSubmissions(),1);assert.equal(first.relay.status().pendingResult,true);
    first.relay.stop();
    assert.equal(first.relay.status().delivery.state,'deferred');

    let restoredSend=0;
    const restartedJournal=new BrowserTransportJournal(journalPath);
    const snapshots=[targetSnapshot('Inspect package.json.',false,'tab-2','assistant-task-1',0),targetSnapshot('Inspect package.json.',false,'tab-2','assistant-task-1',0)];
    const restored=new BrowserInstructionRelay({
      channel:{expectedUrlFor:()=>chatUrl,snapshot:async()=>snapshots.shift()||targetSnapshot('',false,'tab-2',null,-1),send:async()=>{restoredSend+=1;return{accepted:true,evidenceLevel:'RENDERED_DELIVERY_VERIFIED'};}},
      getEndpoint:()=> 'http://127.0.0.1:9333',getWorkspaceRoot:()=>workspace,journal:restartedJournal,
      submitInstruction:async()=>{throw new Error('durable queued result must not repeat local execution');},
    });
    restored._schedule=()=>{};restored.selectTarget({targetId:'tab-2',providerId:'chatgpt',url:chatUrl});
    await restored.start();
    assert.equal(restored.status().lifecycle,'result_queued','queued result must survive target/browser replacement');
    assert.equal(restored.status().pendingResult,true);
    await restored._tick({schedule:false});
    assert.equal(restoredSend,1);assert.equal(restored.status().pendingResult,false);
    assert.equal(restored.status().delivery.state,'accepted');
  }

  {
    const events=[];
    const journal=new BrowserTransportJournal(path.join(temp,'exhaust.jsonl'));
    const {relay}=createRelay({events,journal,send:async()=>{const error=new Error('Composer still unavailable.');error.code='COMPOSER_NOT_FOUND';throw error;}});
    await relay.start();await relay._tick({schedule:false});
    for(let attempt=0;attempt<3&&relay.status().pendingResult;attempt+=1){relay.pending.nextAttemptAt=0;await relay._tick({schedule:false});}
    assert.equal(relay.status().pendingResult,false);assert.equal(relay.status().running,true);assert.equal(relay.status().lifecycle,'delivery_failed');
    assert.ok(events.some(event=>event.phase==='browser_relay.delivery_failed'));
  }

  console.log('rebuild-loop-lifecycle-smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
