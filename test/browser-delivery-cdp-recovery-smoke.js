'use strict';

const assert=require('node:assert/strict');
const {BrowserInstructionRelay,isTransientTransportError}=require('../src/agent/executive/BrowserInstructionRelay');

const snap=(text,messageIndex=0,messageId='')=>({targetId:'tab-1',providerId:'chatgpt',text,generating:false,url:'https://chatgpt.com/c/abc',provenance:{verifiedAssistant:true,messagePresent:Boolean(text),messageIndex,messageId}});

function transportRefused(){
  const error=new Error('fetch failed');
  error.cause=Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8444'),{code:'ECONNREFUSED'});
  return error;
}

async function scenarioEndpointVanish(){
  // A queued terminal result must survive a CDP endpoint that disappears (the
  // Chrome process died), then be delivered after the endpoint recovers. It must
  // never be dropped, never inverted to an ambiguous delivery_failed, and must
  // not raise an unhandled rejection that takes the loop down.
  let liveEndpoint=true; let sendCount=0; let submitted=0; const sent=[];
  let n=0;
  const channel={
    expectedUrlFor:()=> 'https://chatgpt.com/c/abc',
    snapshot:async()=>{
      n+=1;
      if(n===1)return snap('Historical baseline.',0,'base-0');
      if(n===2)return snap('Run the bounded check.',1,'ins-1');
      return snap('',9,'empty');
    },
    send:async(_e,_t,_p,payload)=>{sendCount+=1;sent.push(String(payload||''));return{accepted:true};},
  };
  const relay=new BrowserInstructionRelay({
    channel,
    getEndpoint:()=>liveEndpoint?'http://127.0.0.1:7330':'',
    getWorkspaceRoot:()=>'G:\\\\Demo',
    submitInstruction:async()=>{submitted+=1;return{ok:true,terminalState:'completed',summary:'Local check completed.'};},
  });
  relay._schedule=()=>{};
  relay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});
  await relay.start();
  await relay._tick({schedule:false});            // discovers + queues the instruction
  assert.equal(submitted,1);
  assert.ok(relay.pending,'instruction must be queued as a terminal result before delivery');
  assert.equal(relay.status().lifecycle,'result_queued');

  liveEndpoint=false;
  await relay._tick({schedule:false});           // CDP endpoint is gone
  assert.ok(relay.pending,'dead CDP must retain the queued terminal result');
  assert.equal(relay.status().lifecycle,'delivery_retry');
  assert.equal(sendCount,0,'no delivery may occur while the CDP endpoint is dead');

  liveEndpoint=true;
  await relay._tick({schedule:false});           // transport recovered
  assert.equal(sendCount,1,'queued terminal result must be delivered once CDP recovers');
  assert.equal(sent.length,1);
  assert.equal(relay.pending,null,'delivered pending must be consumed');
  assert.equal(relay.status().lifecycle,'waiting_for_instruction');
}

async function scenario2(){
  // A transient transport error during the transport snapshot (endpoint present
  // but unreachable) must retain the queued result and keep the loop alive.
  let n=0; let sendCount=0; let submitted=0;
  const channel={
    expectedUrlFor:()=> 'https://chatgpt.com/c/abc',
    snapshot:async()=>{
      n+=1;
      if(n===1)return snap('Historical baseline.',0,'t0');
      if(n===2)return snap('Run the guarded check.',1,'t1');
      if(n===3)throw transportRefused();
      return snap('',9,'t-empty');
    },
    send:async(_e,_t,_p,payload)=>{sendCount+=1;return{accepted:true};},
  };
  const relay=new BrowserInstructionRelay({
    channel,
    getEndpoint:()=> 'http://127.0.0.1:7330',
    getWorkspaceRoot:()=>'G:\\\\Demo',
    submitInstruction:async()=>{submitted+=1;return{ok:true,terminalState:'completed',summary:'done'};},
  });
  relay._schedule=()=>{};
  relay.selectTarget({targetId:'tab-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'});
  await relay.start();
  await relay._tick({schedule:false});           // queue
  assert.ok(relay.pending);
  await relay._tick({schedule:false});           // transient snapshot transport failure, retained
  assert.ok(relay.pending,'transient transport snapshot failure must retain the queued result');
  assert.equal(relay.status().lifecycle,'delivery_retry');
  assert.equal(sendCount,0);
  await relay._tick({schedule:false});           // recover and deliver
  assert.equal(sendCount,1);
  assert.equal(relay.pending,null);
}

(async()=>{
  assert.equal(isTransientTransportError(transportRefused()),true,'wrapped CDP ECONNREFUSED must be recognized as transient pre-submit transport');
  await scenarioEndpointVanish();
  await scenario2();
  console.log('browser-delivery-cdp-recovery-smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});