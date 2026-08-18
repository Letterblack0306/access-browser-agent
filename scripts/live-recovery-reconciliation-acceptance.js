'use strict';

const fs=require('node:fs');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const CDP=require('chrome-remote-interface');
const electron=require('electron');

const HOST='127.0.0.1';
const ROOT=path.resolve(__dirname,'..');
const STEP_TIMEOUT_MS=Number(process.env.ACCESS_AGENT_ACCEPTANCE_STEP_TIMEOUT_MS||60000);
const CHAT_URL=String(process.env.ACCESS_AGENT_ACCEPTANCE_CHAT_URL||'').trim();
const RECOVERY_KEY=String(process.env.ACCESS_AGENT_RECOVERY_KEY||'').trim();
const DISPOSITION=String(process.env.ACCESS_AGENT_RECOVERY_DISPOSITION||'quarantined').trim();
const REASON=String(process.env.ACCESS_AGENT_RECOVERY_REASON||'').trim();
const JOURNAL=path.join(process.env.APPDATA||'', 'access-agent','diagnostics','browser-transport.jsonl');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function assertConfig(){
  if(!CHAT_URL)throw Object.assign(new Error('ACCESS_AGENT_ACCEPTANCE_CHAT_URL is required.'),{code:'ACCEPTANCE_CHAT_URL_REQUIRED'});
  if(!RECOVERY_KEY)throw Object.assign(new Error('ACCESS_AGENT_RECOVERY_KEY is required.'),{code:'ACCEPTANCE_RECOVERY_KEY_REQUIRED'});
  if(!['abandoned','quarantined','proven_complete'].includes(DISPOSITION))throw Object.assign(new Error(`Unsupported recovery disposition: ${DISPOSITION}`),{code:'ACCEPTANCE_RECOVERY_DISPOSITION_INVALID'});
  if(!REASON)throw Object.assign(new Error('ACCESS_AGENT_RECOVERY_REASON is required.'),{code:'ACCEPTANCE_RECOVERY_REASON_REQUIRED'});
  if(DISPOSITION==='proven_complete')throw Object.assign(new Error('This acceptance runner intentionally refuses proven_complete without explicit durable evidence refs.'),{code:'ACCEPTANCE_PROVEN_COMPLETE_UNSUPPORTED'});
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

async function evaluate(client,expression){
  const result=await client.Runtime.evaluate({expression,returnByValue:true,awaitPromise:true});
  if(result?.exceptionDetails){
    throw Object.assign(new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'Renderer evaluation failed.'),{code:'ACCEPTANCE_RENDERER_EVALUATION_FAILED'});
  }
  return result?.result?.value;
}

async function waitFor(reader,predicate,description,timeout=STEP_TIMEOUT_MS){
  const deadline=Date.now()+timeout;
  let actual=null;
  while(Date.now()<deadline){
    try{actual=await reader();}catch(error){actual={error:error?.message||String(error)};}
    if(predicate(actual))return actual;
    await delay(150);
  }
  throw Object.assign(new Error(`Timed out waiting for ${description}`),{code:'ACCEPTANCE_STEP_TIMEOUT',actual});
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
  );
}

async function rendererDiagnostics(client,limit=500){
  return evaluate(client,`(async()=>window.accessIde?.diagnosticRecent?window.accessIde.diagnosticRecent(${Number(limit)}):[])()`);
}

async function setChatUrl(client){
  return evaluate(client,`(()=>{const n=document.getElementById('chatUrl');if(!n)throw new Error('chatUrl missing');n.value=${JSON.stringify(CHAT_URL)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));return n.value;})()`);
}

async function clickById(client,id){
  return evaluate(client,`(()=>{const n=document.getElementById(${JSON.stringify(id)});if(!n)throw new Error('control missing: '+${JSON.stringify(id)});if(n.disabled)throw new Error('control disabled: '+${JSON.stringify(id)});n.click();return true;})()`);
}

async function waitForRecoveryButton(client){
  const selector=`[data-recovery-key="${RECOVERY_KEY}"][data-recovery-action="${DISPOSITION}"]`;
  return waitFor(
    ()=>evaluate(client,`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)return null;const row=b.closest('.problem-row');return{key:b.dataset.recoveryKey,action:b.dataset.recoveryAction,text:row?.innerText||''};})()`),
    value=>value?.key===RECOVERY_KEY&&value?.action===DISPOSITION,
    `recovery action ${DISPOSITION} for ${RECOVERY_KEY}`,
  );
}

async function clickRecoveryButton(client){
  const selector=`[data-recovery-key="${RECOVERY_KEY}"][data-recovery-action="${DISPOSITION}"]`;
  return evaluate(client,`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw new Error('recovery action missing');b.click();return true;})()`);
}

async function completeRecoveryOverlay(client){
  await waitFor(
    ()=>evaluate(client,"(()=>{const overlay=document.querySelector('[data-recovery-input-overlay]');const input=overlay?.querySelector('textarea');const button=overlay?[...overlay.querySelectorAll('button')].find(node=>node.textContent.trim()==='Continue'):null;return overlay&&input&&button?true:false;})()"),
    Boolean,
    'recovery input overlay',
  );
  return evaluate(client,`(()=>{const overlay=document.querySelector('[data-recovery-input-overlay]');if(!overlay)throw new Error('recovery overlay missing');const input=overlay.querySelector('textarea');const button=[...overlay.querySelectorAll('button')].find(node=>node.textContent.trim()==='Continue');if(!input||!button)throw new Error('recovery overlay controls missing');input.value=${JSON.stringify(REASON)};input.dispatchEvent(new Event('input',{bubbles:true}));button.click();return true;})()`);
}

function readJournalRows(){
  if(!JOURNAL||!fs.existsSync(JOURNAL))return [];
  return fs.readFileSync(JOURNAL,'utf8').split(/\r?\n/u).filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(Boolean);
}

function readRecoveryRecord(){
  const rows=readJournalRows();
  return rows.filter(row=>row.kind==='instruction'&&row.key===RECOVERY_KEY).at(-1)||null;
}

function readReceipt(){
  const rows=readJournalRows();
  return rows.find(row=>row.kind==='instruction_reconciliation'&&row.instructionKey===RECOVERY_KEY&&row.disposition===DISPOSITION)||null;
}

async function main(){
  assertConfig();
  const port=await selectFreePort();
  const stdout=[];
  const stderr=[];
  let child=null;
  let client=null;
  try{
    child=spawn(electron,[`--remote-debugging-port=${port}`,ROOT],{
      cwd:ROOT,
      env:{...process.env,ACCESS_AGENT_UI_ACCEPTANCE:'1'},
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
    );

    await setChatUrl(client);
    await clickById(client,'loopStart');

    const recoveryCard=await waitForRecoveryButton(client);
    console.log('RECOVERY_CARD='+JSON.stringify(recoveryCard));

    const recoveryRecord=readRecoveryRecord();
    const expectedPriorState=String(recoveryRecord?.state||'');
    if(!expectedPriorState)throw Object.assign(new Error(`No durable pre-reconciliation state found for ${RECOVERY_KEY}.`),{code:'ACCEPTANCE_PRIOR_STATE_MISSING'});

    const beforeRows=await rendererDiagnostics(client,500);
    const beforeInstructionCount=(Array.isArray(beforeRows)?beforeRows:[]).filter(row=>JSON.stringify(row).includes('browser_relay.instruction_received')).length;

    await clickRecoveryButton(client);
    await completeRecoveryOverlay(client);

    const receipt=await waitFor(
      async()=>readReceipt(),
      Boolean,
      'durable instruction_reconciliation receipt',
      30000,
    );

    const afterRows=await rendererDiagnostics(client,500);
    const rows=Array.isArray(afterRows)?afterRows:[];
    const afterInstructionCount=rows.filter(row=>JSON.stringify(row).includes('browser_relay.instruction_received')).length;
    const reconcileEvidence=rows.filter(row=>{
      const raw=JSON.stringify(row);
      return raw.includes(RECOVERY_KEY)||raw.includes('browser-recovery-reconcile')||raw.includes('reconcile_recovery')||raw.includes('recovery_reconciled');
    });

    console.log('RECEIPT='+JSON.stringify(receipt,null,2));
    console.log('RECONCILIATION_DIAGNOSTICS='+JSON.stringify(reconcileEvidence,null,2));
    console.log(`EXPECTED_PRIOR_STATE=${expectedPriorState}`);
    console.log(`INSTRUCTION_RECEIVED_BEFORE=${beforeInstructionCount}`);
    console.log(`INSTRUCTION_RECEIVED_AFTER=${afterInstructionCount}`);

    if(String(receipt.priorState||'')!==expectedPriorState)throw Object.assign(new Error(`Expected priorState ${expectedPriorState}, got ${receipt.priorState||'(empty)'}`),{code:'ACCEPTANCE_WRONG_PRIOR_STATE'});
    if(afterInstructionCount!==beforeInstructionCount)throw Object.assign(new Error(`Instruction execution count changed during reconciliation: ${beforeInstructionCount} -> ${afterInstructionCount}`),{code:'ACCEPTANCE_UNEXPECTED_INSTRUCTION_EXECUTION'});

    console.log('AUTOMATED_LIVE_RECOVERY_RECONCILIATION_PASS');
  }catch(error){
    console.error('AUTOMATED_LIVE_RECOVERY_RECONCILIATION_FAIL');
    console.error(JSON.stringify({code:error?.code||null,message:error?.message||String(error),stdout:stdout.join('').slice(-12000),stderr:stderr.join('').slice(-12000)},null,2));
    process.exitCode=1;
  }finally{
    if(client)await client.close().catch(()=>{});
    if(child&&child.exitCode===null){
      child.kill();
      await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);
      if(child.exitCode===null)child.kill('SIGKILL');
    }
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
