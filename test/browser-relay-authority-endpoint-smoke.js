'use strict';

const assert=require('node:assert/strict');
const {BrowserInstructionRelay}=require('../src/agent/executive/BrowserInstructionRelay');

const snap=(text,messageIndex=0,messageId='')=>({targetId:'tab-1',providerId:'chatgpt',text,generating:false,url:'https://chatgpt.com/c/abc',provenance:{verifiedAssistant:true,messagePresent:Boolean(text),messageIndex,messageId}});
const endpointUnavailable=Object.assign(new Error('Managed Chrome is not running'),{code:'CHROME_NOT_RUNNING'});

async function scenarioAsyncEndpoint(){
  // The relay must await an authority-managed getEndpoint that returns a Promise.
  let n=0;let sendCount=0;let submitted=0;
  const channel={
    expectedUrlFor:()=> 'https://chatgpt.com/c/abc',
    snapshot:async()=>{n+=1;if(n===1)return snap('History baseline.',0,'a0');if(n===2)return snap('Run async-endpoint check.',1,'a1');return snap('',9,'ae');},
    send:async(_e,_t,_p)=>{sendCount+=1;return{accepted:true};},
  };
  const relay=new BrowserInstructionRelay({
    channel,
    getEndpoint:async()=> 'http://127.0.0.1:7330',   // async authority-managed provider
    getWorkspaceRoot:()=>'G:\\\\Demo',
    submitInstruction:async()=>{submitted+=1;return{ok:true,terminalState:'completed',summary:'done'};},
  });
  relay._schedule=()=>{};
  relay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});
  await relay.start();
  await relay._tick({schedule:false});
  assert.ok(relay.pending,'instruction must be queued via an awaited async endpoint');
  await relay._tick({schedule:false});
  assert.equal(sendCount,1,'async authority-managed endpoint must allow delivery');
  assert.equal(relay.pending,null);
  assert.equal(submitted,1);
}

async function scenarioRejectedWhileQueued(){
  // When the authority cannot produce a live endpoint while a result is queued,
  // the queued result must be retained (delivery_retry), then delivered after the
  // authority recovers.
  let endpointReady=true;let sendCount=0;let submitted=0;let n=0;
  const channel={
    expectedUrlFor:()=> 'https://chatgpt.com/c/abc',
    snapshot:async()=>{n+=1;if(n===1)return snap('History baseline.',0,'r0');if(n===2)return snap('Run guarded check.',1,'r1');return snap('',9,'re');},
    send:async(_e,_t,_p)=>{sendCount+=1;return{accepted:true};},
  };
  const relay=new BrowserInstructionRelay({
    channel,
    getEndpoint:async()=>{if(!endpointReady)throw endpointUnavailable;return 'http://127.0.0.1:7330';},
    getWorkspaceRoot:()=>'G:\\\\Demo',
    submitInstruction:async()=>{submitted+=1;return{ok:true,terminalState:'completed',summary:'done'};},
  });
  relay._schedule=()=>{};
  relay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});
  await relay.start();
  await relay._tick({schedule:false});          // queue the instruction
  assert.ok(relay.pending);

  endpointReady=false;
  await relay._tick({schedule:false});          // authority rejects endpoint
  assert.ok(relay.pending,'queued result must survive an endpoint-provider rejection');
  assert.equal(relay.status().lifecycle,'delivery_retry');
  assert.equal(sendCount,0);

  endpointReady=true;
  await relay._tick({schedule:false});          // authority recovers -> deliver
  assert.equal(sendCount,1,'queued result must be delivered once the authority recovers');
  assert.equal(relay.pending,null);
  assert.equal(submitted,1);
}

async function scenarioRejectedNoPending(){
  // A rejected endpoint provider with nothing queued must not crash the loop; it
  // stays in a recoverable waiting_for_browser state.
  const relay=new BrowserInstructionRelay({
    channel:{expectedUrlFor:()=> 'https://chatgpt.com/c/abc',snapshot:async()=>snap('',9,'np'),send:async()=>({accepted:true})},
    getEndpoint:async()=>{throw endpointUnavailable;},
    getWorkspaceRoot:()=>'',
    submitInstruction:async()=>({ok:true,terminalState:'completed',summary:'unused'}),
  });
  relay._schedule=()=>{};
  relay.running=true;relay.generation=1;relay.activeTarget={targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'};relay.lifecycle='waiting_for_instruction';
  await relay._tick({schedule:false});
  assert.equal(relay.status().lifecycle,'waiting_for_browser','no-pending endpoint rejection must be a recoverable wait, not a crash');
}

(async()=>{
  await scenarioAsyncEndpoint();
  await scenarioRejectedWhileQueued();
  await scenarioRejectedNoPending();
  console.log('browser-relay-authority-endpoint-smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});