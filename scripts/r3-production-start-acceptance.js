// CRITICAL_TRIAGE: see docs/change-intents/2026-08-23-orphan-triage.md
// This file is flagged for behavior verification before any keep/wire/delete decision.
// Do not delete or change behavior without first recording a check result in the triage doc.

'use strict';

const fs=require('node:fs');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const CDP=require('chrome-remote-interface');
const electronExecutable=require('electron');
const {BrowserTransportJournal}=require('../src/system/browser-transport-journal');

const HOST='127.0.0.1';
const POLL_MS=200;
const STEP_TIMEOUT_MS=Number(process.env.ACCESS_AGENT_R3_START_STEP_TIMEOUT_MS||30000);
const START_TIMEOUT_MS=Number(process.env.ACCESS_AGENT_R3_START_TIMEOUT_MS||180000);
const CHAT_URL=String(process.env.ACCESS_AGENT_ACCEPTANCE_CHAT_URL||'').trim();
const WORKSPACE_ROOT=String(process.env.ACCESS_AGENT_ACCEPTANCE_WORKSPACE_ROOT||'').trim();
const JOURNAL_FILE=String(process.env.ACCESS_AGENT_TRANSPORT_JOURNAL_FILE||path.join(process.env.APPDATA||'','access-agent','diagnostics','browser-transport.jsonl')).trim();
const ROOT=path.resolve(__dirname,'..');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function assertConfig(){
  if(!CHAT_URL)throw Object.assign(new Error('ACCESS_AGENT_ACCEPTANCE_CHAT_URL is required.'),{code:'R3_START_CHAT_URL_REQUIRED'});
  if(!WORKSPACE_ROOT)throw Object.assign(new Error('ACCESS_AGENT_ACCEPTANCE_WORKSPACE_ROOT is required.'),{code:'R3_START_WORKSPACE_ROOT_REQUIRED'});
  if(!JOURNAL_FILE||!fs.existsSync(JOURNAL_FILE))throw Object.assign(new Error('Production transport journal was not found: '+JOURNAL_FILE),{code:'R3_START_JOURNAL_NOT_FOUND'});
}

function selectFreePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.unref();
    server.once('error',reject);
    server.listen(0,HOST,()=>{
      const address=server.address();
      const port=address&&typeof address==='object'?address.port:0;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}

async function waitFor(reader,predicate,description,timeout=STEP_TIMEOUT_MS){
  const deadline=Date.now()+timeout;
  let actual=null;
  while(Date.now()<deadline){
    try{actual=await reader();}
    catch(error){
      if(error?.code&&String(error.code).startsWith('R3_START_'))throw error;
      actual={error:error?.message||String(error)};
    }
    if(predicate(actual))return actual;
    await delay(POLL_MS);
  }
  throw Object.assign(new Error('Timed out waiting for '+description),{code:'R3_START_TIMEOUT',expected:description,actual});
}

async function waitForRendererTarget(port){
  return waitFor(
    async()=>{
      try{
        const targets=await CDP.List({host:HOST,port});
        return targets.find(target=>target.type==='page'&&/rebuild|index\.html|access/iu.test(`${target.url||''} ${target.title||''}`))||null;
      }catch{return null;}
    },
    Boolean,
    'Access Agent renderer target',
    STEP_TIMEOUT_MS,
  );
}

async function evaluate(client,expression){
  const result=await client.Runtime.evaluate({expression,returnByValue:true,awaitPromise:true});
  if(result?.exceptionDetails){
    throw Object.assign(new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'Renderer evaluation failed.'),{code:'R3_START_RENDERER_EVALUATION_FAILED'});
  }
  return result?.result?.value;
}

async function status(client){
  return evaluate(client,"(async()=>window.accessIde.status())()");
}

async function diagnostics(client,limit=1800){
  return evaluate(client,`(async()=>window.accessIde?.diagnosticRecent?window.accessIde.diagnosticRecent(${Number(limit)}):[])()`).catch(()=>[]);
}

function maxSeq(rows){
  return Math.max(0,...(Array.isArray(rows)?rows:[]).map(row=>Number(row?.seq||0)));
}

function rowsAfter(rows,seq){
  return (Array.isArray(rows)?rows:[]).filter(row=>Number(row?.seq||0)>seq);
}

function compact(s){
  return {
    runtimeActive:s?.runtimeControl?.active===true,
    browser:{
      lifecycle:s?.browser?.lifecycle||null,
      endpoint:s?.browser?.endpoint||null,
      backendReady:s?.browser?.backendReady===true,
    },
    relay:{
      lifecycle:s?.browserRelay?.lifecycle||null,
      running:s?.browserRelay?.running===true,
      targetId:s?.browserRelay?.target?.targetId||null,
      providerId:s?.browserRelay?.target?.providerId||null,
      error:s?.browserRelay?.error||null,
    },
  };
}

async function setChatUrl(client){
  return evaluate(client,`(()=>{const n=document.getElementById('chatUrl');if(!n)throw new Error('chatUrl missing');n.value=${JSON.stringify(CHAT_URL)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));return n.value;})()`);
}

async function click(client,id){
  return evaluate(client,`(()=>{const n=document.getElementById(${JSON.stringify(id)});if(!n)throw new Error('control missing: '+${JSON.stringify(id)});if(n.disabled)throw new Error('control disabled: '+${JSON.stringify(id)});n.click();return true;})()`);
}

function assertRecoveryBacklogClear(){
  const journal=new BrowserTransportJournal(JOURNAL_FILE);
  const unresolved=journal.listUnresolvedRecoveries({workspaceRoot:WORKSPACE_ROOT,conversationId:CHAT_URL});
  if(unresolved.length){
    throw Object.assign(new Error('Production recovery backlog is not clear.'),{
      code:'R3_START_RECOVERY_BACKLOG_NOT_CLEAR',
      actual:unresolved.map(item=>({key:item.key,state:item.record?.state||null,instructionId:item.record?.instructionId||null})),
    });
  }
  return unresolved.length;
}

async function main(){
  assertConfig();
  const unresolvedBefore=assertRecoveryBacklogClear();
  const port=await selectFreePort();
  const stdout=[];
  const stderr=[];
  let child=null;
  let client=null;

  try{
    child=spawn(electronExecutable,[`--remote-debugging-port=${port}`,ROOT],{
      cwd:ROOT,
      env:{...process.env,ACCESS_AGENT_UI_ACCEPTANCE:'1',ACCESS_AGENT_TRANSPORT_JOURNAL_FILE:JOURNAL_FILE},
      windowsHide:false,
      stdio:['ignore','pipe','pipe'],
    });
    child.stdout?.on('data',chunk=>stdout.push(String(chunk)));
    child.stderr?.on('data',chunk=>stderr.push(String(chunk)));

    const target=await waitForRendererTarget(port);
    client=await CDP({host:HOST,port,target:target.id});
    await client.Runtime.enable();

    await waitFor(
      ()=>evaluate(client,"(()=>({readyState:document.readyState,hasApi:Boolean(window.accessIde?.status),hasStart:Boolean(document.getElementById('loopStart'))}))()"),
      value=>value?.readyState==='complete'&&value?.hasApi&&value?.hasStart,
      'renderer boot',
      STEP_TIMEOUT_MS,
    );

    await setChatUrl(client);
    const baselineSeq=maxSeq(await diagnostics(client));
    await click(client,'loopStart');

    const reached=await waitFor(
      async()=>{
        const all=await diagnostics(client,2200);
        const fresh=rowsAfter(all,baselineSeq);
        const recovery=fresh.find(row=>row?.action==='browser_relay.instruction_recovery_required');
        if(recovery){
          throw Object.assign(new Error('Normal production Start was blocked by recovery.'),{code:'R3_START_RECOVERY_BLOCKED',actual:recovery});
        }
        const operationFailure=fresh.find(row=>row?.source==='renderer'&&row?.action==='operation_failed'&&row?.phase==='failed');
        if(operationFailure){
          throw Object.assign(new Error(operationFailure?.error?.message||operationFailure?.data?.message||'Normal production Start failed.'),{code:'R3_START_OPERATION_FAILED',actual:operationFailure});
        }
        const current=await status(client);
        if(
          current?.runtimeControl?.active===true&&
          current?.browser?.backendReady===true&&
          current?.browserRelay?.running===true&&
          current?.browserRelay?.lifecycle==='waiting_for_instruction'&&
          current?.browserRelay?.target?.targetId
        ) return {status:current,fresh};
        return null;
      },
      Boolean,
      'production relay waiting_for_instruction',
      START_TIMEOUT_MS,
    );

    const finalStatus=compact(reached.status);
    const freshRecoveryEvents=reached.fresh.filter(row=>row?.action==='browser_relay.instruction_recovery_required').length;
    const freshOperationFailures=reached.fresh.filter(row=>row?.source==='renderer'&&row?.action==='operation_failed'&&row?.phase==='failed').length;

    console.log('R3 NORMAL PRODUCTION START ACCEPTANCE: PASS');
    console.log(JSON.stringify({
      chatUrl:CHAT_URL,
      workspaceRoot:WORKSPACE_ROOT,
      journalFile:JOURNAL_FILE,
      unresolvedBefore,
      finalStatus,
      freshRecoveryEvents,
      freshOperationFailures,
    },null,2));
  }catch(error){
    const current=client?await status(client).catch(()=>null):null;
    const rows=client?await diagnostics(client,2200).catch(()=>[]):[];
    console.error('R3 NORMAL PRODUCTION START ACCEPTANCE: FAIL');
    console.error(JSON.stringify({
      code:error?.code||null,
      message:error?.message||String(error),
      expected:error?.expected||null,
      actual:error?.actual||null,
      status:compact(current),
      diagnostics:(Array.isArray(rows)?rows:[]).slice(-100),
      stdout:stdout.join('').slice(-12000),
      stderr:stderr.join('').slice(-12000),
      journalFile:JOURNAL_FILE,
    },null,2));
    process.exitCode=1;
  }finally{
    if(client){
      try{
        const current=await status(client);
        if(current?.runtimeControl?.active===true||current?.browser?.endpoint||current?.browserRelay?.running===true){
          await click(client,'stopAll').catch(()=>{});
          await delay(1500);
        }
      }catch{}
      await client.close().catch(()=>{});
    }
    if(child&&child.exitCode===null){
      child.kill();
      await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);
      if(child.exitCode===null)child.kill('SIGKILL');
    }
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
