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
const STEP_TIMEOUT_MS=Number(process.env.ACCESS_AGENT_R2_ACCEPTANCE_TIMEOUT_MS||120000);
const START_TIMEOUT_MS=Number(process.env.ACCESS_AGENT_R2_START_TIMEOUT_MS||300000);
const CHAT_URL=String(process.env.ACCESS_AGENT_ACCEPTANCE_CHAT_URL||'').trim();
const projectRoot=path.resolve(__dirname,'..');
const nonce=`${Date.now()}-${process.pid}`;
const journalFile=path.join(os.tmpdir(),`access-agent-r2-${nonce}.jsonl`);
const firstProbe=`R2 LIVE RESTART PROBE A ${nonce}. Ask the connected Access local agent to return one short acknowledgement only. Do not request file changes, commands, browsing, package installation, Git operations, or any other side effect.`;
const secondProbe=`R2 LIVE RESTART PROBE C ${nonce}. This is a new independent turn after restart. Ask the connected Access local agent to return one short acknowledgement only. Do not request file changes, commands, browsing, package installation, Git operations, or any other side effect.`;

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function selectFreePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.unref();server.once('error',reject);server.listen(0,HOST,()=>{const address=server.address();const port=address&&typeof address==='object'?address.port:0;server.close(error=>error?reject(error):resolve(port));});});}
function tail(value,limit=16000){const text=String(value||'');return text.length>limit?text.slice(-limit):text;}
function compact(s){return{runtimeActive:s?.runtimeControl?.active===true,agent:{status:s?.agent?.status||null,sessionId:s?.agent?.sessionId||null,running:s?.agent?.running===true},browser:{lifecycle:s?.browser?.lifecycle||null,endpoint:s?.browser?.endpoint||null,backendReady:s?.browser?.backendReady===true},relay:{lifecycle:s?.browserRelay?.lifecycle||null,running:s?.browserRelay?.running===true,targetId:s?.browserRelay?.target?.targetId||null,providerId:s?.browserRelay?.target?.providerId||null,pendingResult:s?.browserRelay?.pendingResult===true,delivery:s?.browserRelay?.delivery||null,error:s?.browserRelay?.error||null}};}
async function waitForCdp(port){const deadline=Date.now()+30000;while(Date.now()<deadline){try{const targets=await CDP.List({host:HOST,port});const page=targets.find(t=>t.type==='page'&&/rebuild|index\.html|access/iu.test(`${t.url||''} ${t.title||''}`));if(page)return page;}catch{}await delay(POLL_MS);}throw Object.assign(new Error('Timed out waiting for Access renderer.'),{code:'R2_RENDERER_TIMEOUT'});}
async function evaluate(client,expression){const result=await client.Runtime.evaluate({expression,returnByValue:true,awaitPromise:true});if(result?.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'Renderer evaluation failed.');return result?.result?.value;}
async function status(client){return evaluate(client,"(async()=>window.accessIde.status())()");}
async function diagnostics(client,limit=1400){return evaluate(client,`(async()=>window.accessIde?.diagnosticRecent?window.accessIde.diagnosticRecent(${Number(limit)}):[])()`).catch(()=>[]);}
async function info(client){return evaluate(client,"(()=>({chatUrl:document.getElementById('chatUrl')?.value||'',loopStart:document.getElementById('loopStart')?{disabled:document.getElementById('loopStart').disabled,text:document.getElementById('loopStart').textContent}:null,stopAll:document.getElementById('stopAll')?{disabled:document.getElementById('stopAll').disabled}:null}))()");}
async function setChatUrl(client,value){return evaluate(client,`(()=>{const n=document.getElementById('chatUrl');if(!n)throw new Error('chatUrl missing');n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));return n.value;})()`);}
async function click(client,id){return evaluate(client,`(()=>{const n=document.getElementById(${JSON.stringify(id)});if(!n)throw new Error('control missing');if(n.disabled)throw new Error('control disabled');n.click();return true;})()`);}
async function waitFor(check,description,timeout=STEP_TIMEOUT_MS){const deadline=Date.now()+timeout;let latest=null;while(Date.now()<deadline){latest=await check().catch(error=>{if(error?.code&&String(error.code).startsWith('R2_'))throw error;return null;});if(latest)return latest;await delay(POLL_MS);}throw Object.assign(new Error(`Timed out waiting for ${description}`),{code:'R2_STEP_TIMEOUT',expected:description});}
function rowsAfter(rows,seq){return (Array.isArray(rows)?rows:[]).filter(r=>Number(r?.seq||0)>seq);}
function eventRows(rows,action){return rows.filter(r=>r?.source==='browser-relay'&&r?.action===action);}
function failures(rows){return rows.filter(r=>r?.severity==='error'||r?.phase==='failed').filter(r=>['browser-relay','provider-channel','renderer'].includes(String(r?.source||'')));}
function maxSeq(rows){return Math.max(0,...(Array.isArray(rows)?rows:[]).map(r=>Number(r?.seq||0)));}
function successfulSubmits(rows){return eventRows(rows,'instruction_submit').filter(r=>r?.phase==='success');}
function startedSubmits(rows){return eventRows(rows,'instruction_submit').filter(r=>r?.phase==='start');}

async function startLoop(client){
  const control=await waitFor(async()=>{const i=await info(client);return i?.loopStart&&!i.loopStart.disabled?i:null;},'Loop Start control enabled',30000);
  if(String(control.loopStart.text||'').trim().toLowerCase()==='stop')return status(client);
  const baselineSeq=maxSeq(await diagnostics(client,1600));
  await click(client,'loopStart');
  return waitFor(async()=>{
    const rows=rowsAfter(await diagnostics(client,1800),baselineSeq);
    const operationFailure=rows.find(r=>r?.source==='renderer'&&r?.action==='operation_failed'&&r?.phase==='failed');
    if(operationFailure){
      throw Object.assign(new Error(operationFailure?.error?.message||operationFailure?.data?.message||'Browser Loop start failed.'),{code:'R2_START_OPERATION_FAILED',actual:{failure:operationFailure}});
    }
    const s=await status(client);
    return s?.runtimeControl?.active===true&&s?.browser?.backendReady===true&&s?.browserRelay?.running===true&&s?.browserRelay?.lifecycle==='waiting_for_instruction'&&s?.browserRelay?.target?.targetId?s:null;
  },'relay waiting_for_instruction',START_TIMEOUT_MS);
}

async function completeCycle({client,endpoint,targetId,providerId,probe,baselineSeq,expectedTotalStarts}){
  const probeChannel=new ProviderChannel({readinessTimeoutMs:7000});probeChannel.targetUrls.set(targetId,CHAT_URL);
  await probeChannel.send(endpoint,targetId,providerId,probe);
  return waitFor(async()=>{
    const all=await diagnostics(client,1600);const rows=rowsAfter(all,baselineSeq);const bad=failures(rows);
    if(bad.length)throw Object.assign(new Error('R2 live acceptance observed an explicit runtime failure.'),{code:'R2_RUNTIME_FAILURE',actual:{failures:bad.slice(-8)}});
    const starts=startedSubmits(all);const successes=successfulSubmits(all);const sent=eventRows(all,'browser_relay.result_sent');const consumed=eventRows(all,'browser_relay.delivery_response_consumed');
    if(starts.length>expectedTotalStarts)throw Object.assign(new Error('Restart acceptance observed an unexpected duplicate local submission.'),{code:'R2_DUPLICATE_LOCAL_SUBMISSION',actual:{starts:starts.length,expectedTotalStarts}});
    if(starts.length===expectedTotalStarts&&successes.length>=expectedTotalStarts&&sent.length>=expectedTotalStarts&&consumed.length>=expectedTotalStarts){const s=await status(client);if(s?.browserRelay?.running===true&&s?.browserRelay?.lifecycle==='waiting_for_instruction')return{all,rows,starts,successes,sent,consumed,status:s};}
    return null;
  },'complete causal cycle after controlled probe');
}

(async()=>{
  if(!CHAT_URL)throw Object.assign(new Error('ACCESS_AGENT_ACCEPTANCE_CHAT_URL is required.'),{code:'R2_CHAT_URL_REQUIRED'});
  const port=await selectFreePort();const stdout=[];const stderr=[];let child=null;let client=null;
  try{
    child=spawn(electronExecutable,[`--remote-debugging-port=${port}`,projectRoot],{cwd:projectRoot,env:{...process.env,ACCESS_AGENT_UI_ACCEPTANCE:'1',ACCESS_AGENT_TRANSPORT_JOURNAL_FILE:journalFile},windowsHide:false,stdio:['ignore','pipe','pipe']});
    child.stdout?.on('data',x=>stdout.push(String(x)));child.stderr?.on('data',x=>stderr.push(String(x)));
    const renderer=await waitForCdp(port);client=await CDP({host:HOST,port,target:renderer.id});await client.Runtime.enable();
    await setChatUrl(client,CHAT_URL);

    const firstStarted=await startLoop(client);const firstEndpoint=String(firstStarted.browser.endpoint);const firstTargetId=String(firstStarted.browserRelay.target.targetId);const providerId=String(firstStarted.browserRelay.target.providerId||'chatgpt');
    const initialRows=await diagnostics(client);const initialSeq=maxSeq(initialRows);const initialStarts=startedSubmits(initialRows).length;
    const first=await completeCycle({client,endpoint:firstEndpoint,targetId:firstTargetId,providerId,probe:firstProbe,baselineSeq:initialSeq,expectedTotalStarts:initialStarts+1});
    const firstSuccess=first.successes.at(-1);const sessionId=String(firstSuccess?.correlation?.sessionId||'');
    if(!sessionId)throw Object.assign(new Error('First controlled turn completed without a correlated local sessionId.'),{code:'R2_SESSION_ID_MISSING'});
    const countBeforeRestart=startedSubmits(first.all).length;

    await click(client,'stopAll');
    await waitFor(async()=>{const s=await status(client);return s?.runtimeControl?.active!==true&&!s?.browser?.endpoint&&s?.browserRelay?.running!==true?s:null;},'Stop All clean state',30000);

    const secondStarted=await startLoop(client);const secondEndpoint=String(secondStarted.browser.endpoint);const secondTargetId=String(secondStarted.browserRelay.target.targetId);const secondProviderId=String(secondStarted.browserRelay.target.providerId||'chatgpt');
    if(secondTargetId===firstTargetId)throw Object.assign(new Error('Managed Chrome restart did not produce a replacement CDP target identity.'),{code:'R2_TARGET_NOT_REPLACED',actual:{firstTargetId,secondTargetId}});
    if(secondProviderId!==providerId)throw Object.assign(new Error('Provider identity changed across controlled restart.'),{code:'R2_PROVIDER_CHANGED',actual:{providerId,secondProviderId}});

    const restartBaselineRows=await diagnostics(client,1800);const restartBaselineSeq=maxSeq(restartBaselineRows);
    await delay(3500);
    const postRestartRows=await diagnostics(client,1800);const postRestartBad=failures(rowsAfter(postRestartRows,restartBaselineSeq));
    if(postRestartBad.length)throw Object.assign(new Error('Restart produced an explicit runtime failure before any new turn.'),{code:'R2_RESTART_RUNTIME_FAILURE',actual:{failures:postRestartBad.slice(-8)}});
    const startsAfterRestart=startedSubmits(postRestartRows).length;
    if(startsAfterRestart!==countBeforeRestart)throw Object.assign(new Error('Historical assistant turn was replayed after target/runtime reconstruction.'),{code:'R2_HISTORICAL_REPLAY',actual:{before:countBeforeRestart,after:startsAfterRestart}});
    const restartStatus=await status(client);if(restartStatus?.browserRelay?.running!==true||restartStatus?.browserRelay?.lifecycle!=='waiting_for_instruction')throw Object.assign(new Error('Relay did not remain stable after adopting historical consumed state.'),{code:'R2_RESTART_NOT_WAITING',actual:compact(restartStatus)});

    const secondBaselineSeq=maxSeq(postRestartRows);
    const second=await completeCycle({client,endpoint:secondEndpoint,targetId:secondTargetId,providerId:secondProviderId,probe:secondProbe,baselineSeq:secondBaselineSeq,expectedTotalStarts:countBeforeRestart+1});
    const secondSuccess=second.successes.at(-1);const resumedSessionId=String(secondSuccess?.correlation?.sessionId||'');
    if(resumedSessionId!==sessionId)throw Object.assign(new Error('Local agent session lineage changed across ordinary runtime/browser restart.'),{code:'R2_SESSION_LINEAGE_CHANGED',actual:{before:sessionId,after:resumedSessionId}});
    await delay(2500);
    const finalRows=await diagnostics(client,2000);const finalStarts=startedSubmits(finalRows).length;
    if(finalStarts!==countBeforeRestart+1)throw Object.assign(new Error('Submission count changed after the second delivery-response consumption.'),{code:'R2_UNSTABLE_SUBMISSION_COUNT',actual:{expected:countBeforeRestart+1,actual:finalStarts}});
    const finalStatus=await status(client);if(finalStatus?.browserRelay?.running!==true||finalStatus?.browserRelay?.lifecycle!=='waiting_for_instruction')throw Object.assign(new Error('Relay did not remain in stable waiting after restart continuation.'),{code:'R2_NOT_STABLE_WAITING',actual:compact(finalStatus)});

    console.log('R2 LIVE RESTART IDENTITY ACCEPTANCE: PASS');
    console.log(JSON.stringify({chatUrl:CHAT_URL,nonce,journalFile,sessionId,firstTargetId,secondTargetId,targetReplaced:firstTargetId!==secondTargetId,localSubmissionCountBeforeRestart:countBeforeRestart,localSubmissionCountAfterRestartBeforeNewTurn:startsAfterRestart,finalLocalSubmissionCount:finalStarts,sessionLineagePreserved:resumedSessionId===sessionId,finalStatus:compact(finalStatus)},null,2));
  }catch(error){const s=client?await status(client).catch(()=>null):null;const rows=client?await diagnostics(client,2000).catch(()=>[]):[];console.error('R2 LIVE RESTART IDENTITY ACCEPTANCE: FAIL');console.error(JSON.stringify({code:error.code||null,message:error.message,expected:error.expected||null,actual:error.actual||null,status:compact(s),diagnostics:(Array.isArray(rows)?rows:[]).slice(-80),stdout:tail(stdout.join('')),stderr:tail(stderr.join('')),journalFile},null,2));process.exitCode=1;
  }finally{
    if(client){try{const s=await status(client);if(s?.runtimeControl?.active===true||s?.browser?.endpoint||s?.browserRelay?.running===true)await click(client,'stopAll').catch(()=>{});}catch{}await client.close().catch(()=>{});}
    if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
    try{fs.rmSync(journalFile,{force:true});}catch{}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
