// CRITICAL_TRIAGE: see docs/change-intents/2026-08-23-orphan-triage.md
// This file is flagged for behavior verification before any keep/wire/delete decision.
// Do not delete or change behavior without first recording a check result in the triage doc.

'use strict';

const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const CDP=require('chrome-remote-interface');
const electronExecutable=require('electron');
const {ProviderChannel}=require('../src/browser/provider-channel');

const HOST='127.0.0.1';
const POLL_MS=200;
const STEP_TIMEOUT_MS=Number(process.env.ACCESS_AGENT_R1_ACCEPTANCE_TIMEOUT_MS||90000);
const CHAT_URL=String(process.env.ACCESS_AGENT_ACCEPTANCE_CHAT_URL||'').trim();
const projectRoot=path.resolve(__dirname,'..');
const nonce=`${Date.now()}-${process.pid}`;
const journalFile=path.join(os.tmpdir(),`access-agent-r1-${nonce}.jsonl`);
const probe=`R1 LIVE ACCEPTANCE PROBE ${nonce}. Ask the connected Access local agent to return one short acknowledgement only. Do not request file changes, commands, browsing, package installation, Git operations, or any other side effect.`;

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function selectFreePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.unref();server.once('error',reject);server.listen(0,HOST,()=>{const address=server.address();const port=address&&typeof address==='object'?address.port:0;server.close(error=>error?reject(error):resolve(port));});});}
function tail(value,limit=16000){const text=String(value||'');return text.length>limit?text.slice(-limit):text;}
function compact(s){return{runtimeActive:s?.runtimeControl?.active===true,browser:{lifecycle:s?.browser?.lifecycle||null,endpoint:s?.browser?.endpoint||null,backendReady:s?.browser?.backendReady===true},relay:{lifecycle:s?.browserRelay?.lifecycle||null,running:s?.browserRelay?.running===true,targetId:s?.browserRelay?.target?.targetId||null,providerId:s?.browserRelay?.target?.providerId||null,pendingResult:s?.browserRelay?.pendingResult===true,delivery:s?.browserRelay?.delivery||null,error:s?.browserRelay?.error||null}};}
async function waitForCdp(port){const deadline=Date.now()+30000;while(Date.now()<deadline){try{const targets=await CDP.List({host:HOST,port});const page=targets.find(t=>t.type==='page'&&/rebuild|index\.html|access/iu.test(`${t.url||''} ${t.title||''}`));if(page)return page;}catch{}await delay(POLL_MS);}throw Object.assign(new Error('Timed out waiting for Access renderer.'),{code:'R1_RENDERER_TIMEOUT'});}
async function evaluate(client,expression){const result=await client.Runtime.evaluate({expression,returnByValue:true,awaitPromise:true});if(result?.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'Renderer evaluation failed.');return result?.result?.value;}
async function status(client){return evaluate(client,"(async()=>window.accessIde.status())()");}
async function diagnostics(client,limit=600){return evaluate(client,`(async()=>window.accessIde?.diagnosticRecent?window.accessIde.diagnosticRecent(${Number(limit)}):[])()`).catch(()=>[]);}
async function info(client){return evaluate(client,"(()=>({chatUrl:document.getElementById('chatUrl')?.value||'',loopStart:document.getElementById('loopStart')?{disabled:document.getElementById('loopStart').disabled}:null,stopAll:document.getElementById('stopAll')?{disabled:document.getElementById('stopAll').disabled}:null}))()");}
async function setChatUrl(client,value){return evaluate(client,`(()=>{const n=document.getElementById('chatUrl');if(!n)throw new Error('chatUrl missing');n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));return n.value;})()`);}
async function click(client,id){return evaluate(client,`(()=>{const n=document.getElementById(${JSON.stringify(id)});if(!n)throw new Error('control missing');if(n.disabled)throw new Error('control disabled');n.click();return true;})()`);}
async function waitFor(check,description,timeout=STEP_TIMEOUT_MS){const deadline=Date.now()+timeout;let latest=null;while(Date.now()<deadline){latest=await check().catch(()=>null);if(latest)return latest;await delay(POLL_MS);}throw Object.assign(new Error(`Timed out waiting for ${description}`),{code:'R1_STEP_TIMEOUT',expected:description});}
function rowsAfter(rows,seq){return (Array.isArray(rows)?rows:[]).filter(r=>Number(r?.seq||0)>seq);}
function eventRows(rows,action){return rows.filter(r=>r?.source==='browser-relay'&&r?.action===action);}

(async()=>{
  if(!CHAT_URL)throw Object.assign(new Error('ACCESS_AGENT_ACCEPTANCE_CHAT_URL is required.'),{code:'R1_CHAT_URL_REQUIRED'});
  const port=await selectFreePort();const stdout=[];const stderr=[];let child=null;let client=null;
  try{
    child=spawn(electronExecutable,[`--remote-debugging-port=${port}`,projectRoot],{cwd:projectRoot,env:{...process.env,ACCESS_AGENT_UI_ACCEPTANCE:'1',ACCESS_AGENT_TRANSPORT_JOURNAL_FILE:journalFile},windowsHide:false,stdio:['ignore','pipe','pipe']});
    child.stdout?.on('data',x=>stdout.push(String(x)));child.stderr?.on('data',x=>stderr.push(String(x)));
    const target=await waitForCdp(port);client=await CDP({host:HOST,port,target:target.id});await client.Runtime.enable();
    await waitFor(async()=>{const i=await info(client);return i?.loopStart&&!i.loopStart.disabled?i:null;},'Loop Start control enabled',30000);
    await setChatUrl(client,CHAT_URL);await click(client,'loopStart');
    const started=await waitFor(async()=>{const s=await status(client);return s?.runtimeControl?.active===true&&s?.browser?.backendReady===true&&s?.browserRelay?.running===true&&s?.browserRelay?.lifecycle==='waiting_for_instruction'&&s?.browserRelay?.target?.targetId?s:null;},'relay waiting_for_instruction');
    const endpoint=String(started.browser.endpoint);const targetId=String(started.browserRelay.target.targetId);const providerId=String(started.browserRelay.target.providerId||'chatgpt');
    const baselineRows=await diagnostics(client);const baselineSeq=Math.max(0,...baselineRows.map(r=>Number(r?.seq||0)));
    const probeChannel=new ProviderChannel({readinessTimeoutMs:7000});probeChannel.targetUrls.set(targetId,CHAT_URL);
    await probeChannel.send(endpoint,targetId,providerId,probe);
    const accepted=await waitFor(async()=>{
      const rows=rowsAfter(await diagnostics(client,900),baselineSeq);
      const submits=eventRows(rows,'instruction_submit').filter(r=>r?.phase==='start');
      const sent=eventRows(rows,'browser_relay.result_sent');
      const consumed=eventRows(rows,'browser_relay.delivery_response_consumed');
      const failures=rows.filter(r=>r?.severity==='error'||r?.phase==='failed').filter(r=>r?.source==='browser-relay'||r?.source==='provider-channel'||r?.source==='renderer');
      if(failures.length)throw Object.assign(new Error('R1 live acceptance observed an explicit runtime failure.'),{code:'R1_RUNTIME_FAILURE',actual:{failures:failures.slice(-8),submits:submits.length,sent:sent.length,consumed:consumed.length}});
      if(submits.length===1&&sent.length===1&&consumed.length===1){const s=await status(client);if(s?.browserRelay?.running===true&&s?.browserRelay?.lifecycle==='waiting_for_instruction')return{rows,submits,sent,consumed,status:s};}
      if(submits.length>1)throw Object.assign(new Error('Provider response caused more than one local instruction submission.'),{code:'R1_DUPLICATE_LOCAL_SUBMISSION',actual:{submits:submits.length,sent:sent.length,consumed:consumed.length}});
      return null;
    },'A -> one local submit -> R sent -> B delivery_response consumed -> waiting');
    await delay(2500);
    const finalRows=rowsAfter(await diagnostics(client,1000),baselineSeq);const finalSubmits=eventRows(finalRows,'instruction_submit').filter(r=>r?.phase==='start');
    if(finalSubmits.length!==1)throw Object.assign(new Error('Local submission count changed after delivery_response consumption.'),{code:'R1_UNSTABLE_SUBMISSION_COUNT',actual:{count:finalSubmits.length}});
    const finalStatus=await status(client);if(finalStatus?.browserRelay?.running!==true||finalStatus?.browserRelay?.lifecycle!=='waiting_for_instruction')throw Object.assign(new Error('Relay did not remain in stable waiting after response consumption.'),{code:'R1_NOT_STABLE_WAITING',actual:compact(finalStatus)});
    console.log('R1 LIVE FEEDBACK ACCEPTANCE: PASS');
    console.log(JSON.stringify({chatUrl:CHAT_URL,nonce,journalFile,targetId,providerId,localSubmissionCount:1,resultSentCount:accepted.sent.length,deliveryResponseConsumedCount:accepted.consumed.length,finalStatus:compact(finalStatus)},null,2));
  }catch(error){const s=client?await status(client).catch(()=>null):null;const rows=client?await diagnostics(client,1000).catch(()=>[]):[];console.error('R1 LIVE FEEDBACK ACCEPTANCE: FAIL');console.error(JSON.stringify({code:error.code||null,message:error.message,expected:error.expected||null,actual:error.actual||null,status:compact(s),diagnostics:(Array.isArray(rows)?rows:[]).slice(-60),stdout:tail(stdout.join('')),stderr:tail(stderr.join('')),journalFile},null,2));process.exitCode=1;
  }finally{
    if(client){try{const s=await status(client);if(s?.browserRelay?.running===true)await click(client,'loopStart').catch(()=>{});if(s?.runtimeControl?.active===true)await click(client,'stopAll').catch(()=>{});}catch{}await client.close().catch(()=>{});}
    if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
    try{fs.rmSync(journalFile,{force:true});}catch{}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
