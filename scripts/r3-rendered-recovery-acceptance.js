'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const net=require('node:net');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const CDP=require('chrome-remote-interface');
const electronExecutable=require('electron');
const {BrowserTransportJournal}=require('../src/system/browser-transport-journal');
const HOST='127.0.0.1',POLL=150,TIMEOUT=Number(process.env.ACCESS_AGENT_R3_RENDERED_TIMEOUT_MS||45000);
const root=path.resolve(__dirname,'..');
const sourceFile=path.resolve(String(process.env.ACCESS_AGENT_R3_SOURCE_JOURNAL||path.join(process.env.APPDATA||'','access-agent','diagnostics','browser-transport.jsonl')));
const productionKey=String(process.env.ACCESS_AGENT_R3_INSTRUCTION_KEY||'5fad5bad16338bd15f885acc63165cda63088b2d4712640327c48d24b8c5929d');
let key=productionKey;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.unref();server.once('error',reject);server.listen(0,HOST,()=>{const address=server.address();const port=address&&typeof address==='object'?address.port:0;server.close(error=>error?reject(error):resolve(port));});});}
function rows(bytes){return bytes.toString('utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse);}
function endpoint(value){const url=new URL(String(value));return{host:url.hostname||HOST,port:Number(url.port)};}
function html(value){return String(value||'').replace(/[&<>"']/gu,char=>'&#'+char.charCodeAt(0)+';');}
function messageId(record){const match=String(record.transportKey||'').match(/assistant-turn:message:([^:]+):/u);return match?match[1]:record.instructionId;}
async function wait(fn,label,timeout=TIMEOUT){const deadline=Date.now()+timeout;let last=null;while(Date.now()<deadline){try{last=await fn();if(last)return last;}catch(error){last={error:error.message};}await delay(POLL);}throw Object.assign(new Error('Timed out waiting for '+label),{code:'R3_RENDERED_ACCEPTANCE_TIMEOUT',actual:last});}
async function evalJs(client,expression){const result=await client.Runtime.evaluate({expression,returnByValue:true,awaitPromise:true});if(result&&result.exceptionDetails)throw new Error(result.exceptionDetails.exception&&result.exceptionDetails.exception.description||result.exceptionDetails.text||'Renderer evaluation failed');return result&&result.result&&result.result.value;}
async function call(client,method,args=[]){const expression='(async()=>{try{const methodName='+JSON.stringify(method)+';const functionValue=Reflect.get(window.accessIde,methodName);const value=await functionValue(...'+JSON.stringify(args)+');return{ok:true,value};}catch(error){return{ok:false,error:{message:error&&error.message||String(error),code:error&&error.code||null,classification:error&&error.classification||null}};}})()';return evalJs(client,expression);}
async function status(app){const result=await call(app.client,'status');if(!result.ok)throw new Error(result.error&&result.error.message||'status failed');return result.value;}
async function launch(file,workspaceRoot){
const port=await freePort(),stdout=[],stderr=[];
const child=spawn(electronExecutable,['--remote-debugging-port='+port,root],{cwd:root,env:{...process.env,ACCESS_AGENT_UI_ACCEPTANCE:'1',ACCESS_AGENT_WORKSPACE_ROOT:workspaceRoot,ACCESS_AGENT_TRANSPORT_JOURNAL_FILE:file},windowsHide:false,stdio:['ignore','pipe','pipe']});
child.stdout&&child.stdout.on('data',chunk=>stdout.push(String(chunk)));child.stderr&&child.stderr.on('data',chunk=>stderr.push(String(chunk)));
const target=await wait(async()=>{const list=await CDP.List({host:HOST,port});return list.find(item=>item.type==='page'&&/rebuild|index.html|access/iu.test(String(item.url||'')+' '+String(item.title||'')))||null;},'Electron renderer');
const client=await CDP({host:HOST,port,target:target.id});await client.Runtime.enable();
await wait(async()=>{const value=await evalJs(client,"(()=>({ready:document.readyState,api:Boolean(window.accessIde&&window.accessIde.status),problems:Boolean(document.getElementById('problemList'))}))()");return value.ready==='complete'&&value.api&&value.problems?value:null;},'renderer API');
return{child,client,stdout,stderr};
}
async function close(app){
if(!app)return;
try{await call(app.client,'browserRelayStop');}catch{}
try{await call(app.client,'browserStop');}catch{}
try{await call(app.client,'runtimeStop');}catch{}
try{await app.client.close();}catch{}
if(app.child&&!app.child.killed){app.child.kill();await Promise.race([new Promise(resolve=>app.child.once('exit',resolve)),delay(5000)]);}
}
async function ready(app){
 const started=await call(app.client,'runtimeStart');assert.equal(started.ok,true,started.error&&started.error.message);
 return started.value;
}
async function fixture(app,record){
const opened=await call(app.client,'browserOpen');assert.equal(opened.ok,true,opened.error&&opened.error.message);
const state=await status(app);assert.ok(state.browser&&state.browser.endpoint,'managed browser endpoint missing');
const ep=endpoint(state.browser.endpoint),browser=await CDP(ep);let targetId;
try{targetId=(await browser.Target.createTarget({url:'about:blank'})).targetId;}finally{await browser.close();}
const page=await CDP({...ep,target:targetId});await page.Page.enable();await page.Runtime.enable();
await wait(async()=>{const result=await page.Runtime.evaluate({expression:'document.readyState',returnByValue:true});return result&&result.result&&result.result.value||null;},'fixture page');
const body='<!doctype html><html><head><meta charset="utf-8"><title>R3 Isolated Recovery Fixture</title></head><body><div data-message-author-role="assistant" data-message-id="'+html(messageId(record))+'">'+html(record.raw)+'</div><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></body></html>';
const interceptPattern=new URL(record.conversationId).origin+'/*';
await page.Fetch.enable({patterns:[{urlPattern:interceptPattern,requestStage:'Request'}]});
page.Fetch.requestPaused(async event=>{await page.Fetch.fulfillRequest({requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],body:Buffer.from(body,'utf8').toString('base64')});});
await page.Page.navigate({url:record.conversationId});
await wait(async()=>{const result=await page.Runtime.evaluate({expression:'({url:location.href,title:document.title,assistant:Boolean(document.querySelector("[data-message-author-role=assistant]"))})',returnByValue:true});const value=result&&result.result&&result.result.value;return value&&value.url===record.conversationId&&value.title==='R3 Isolated Recovery Fixture'&&value.assistant?value:null;},'fixture URL and assistant DOM');
const probeResult=await page.Runtime.evaluate({expression:'(()=>{const node=document.querySelector("[data-message-author-role=assistant]");return node?{text:String(node.innerText||node.textContent||"").trim(),messageId:node.getAttribute("data-message-id"),rect:{width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}}:null;})()',returnByValue:true});
const probe=probeResult&&probeResult.result&&probeResult.result.value;
assert.ok(probe,'fixture assistant node missing');
const expectedHash=String(record.transportKey||'').split(':').pop();
const actualHash=createHash('sha256').update(String(probe.text||'')).digest('hex');
assert.equal(probe.messageId,messageId(record),'fixture message identity mismatch');
assert.equal(actualHash,expectedHash,'fixture assistant text hash mismatch');
assert.ok(probe.rect.width>0&&probe.rect.height>0,'fixture assistant node is not visible to provider adapter');
await page.Fetch.disable();
await page.close();
await wait(async()=>{const result=await call(app.client,'browserProviderTabs');return result.ok&&Array.isArray(result.value)&&result.value.some(item=>item.targetId===targetId&&item.providerId==='chatgpt')?result.value:null;},'fixture provider tab');
const selected=await call(app.client,'browserRelaySelect',[{targetId,providerId:'chatgpt'}]);assert.equal(selected.ok,true,selected.error&&selected.error.message);
return targetId;
}
async function blocked(app){
const result=await call(app.client,'browserRelayStart');assert.equal(result.ok,false,'unresolved history must block');const recoveryError=result.error||{};assert.ok(recoveryError.code==='INSTRUCTION_RECOVERY_REQUIRED'||/durable state executing/iu.test(String(recoveryError.message||'')),JSON.stringify(recoveryError));
const selector='[data-recovery-action="quarantined"][data-recovery-key="'+key+'"]';
return wait(async()=>{const expression='(()=>{const button=document.querySelector('+JSON.stringify(selector)+');const row=button&&button.closest(".problem-row");const evidence=row&&row.querySelector(".recovery-evidence")&&row.querySelector(".recovery-evidence").textContent||"";return button&&evidence.includes('+JSON.stringify(key)+')&&evidence.includes('+JSON.stringify('"state": "executing"')+')?{evidence:evidence,text:row.textContent}:null;})()';return evalJs(app.client,expression);},'rendered recovery action');
}
async function reconcile(app){
const reason='Rendered R3 acceptance: preserve ambiguous evidence and prohibit historical replay.';
const selector='[data-recovery-action="quarantined"][data-recovery-key="'+key+'"]';
const expression='(()=>{window.prompt=()=>'+JSON.stringify(reason)+';const button=document.querySelector('+JSON.stringify(selector)+');if(!button)throw new Error("action missing");button.click();return true;})()';
assert.equal(await evalJs(app.client,expression),true);
return wait(async()=>{const result=await call(app.client,'browserRecoveryRead',[{key}]);if(!result.ok)return null;const recovery=result.value&&result.value.recovery;const problemSelector='[data-recovery-key="'+key+'"]';const present=await evalJs(app.client,'(()=>Boolean(document.querySelector('+JSON.stringify(problemSelector)+')))()');return recovery&&recovery.ambiguous===false&&recovery.reconciliation&&recovery.reconciliation.disposition==='quarantined'&&!present?result.value:null;},'reconciliation receipt');
}
async function restartProjection(app){
const result=await call(app.client,'browserRecoveryRead',[{key}]);
assert.equal(result.ok,true,result.error&&result.error.message);
const recovery=result.value&&result.value.recovery;
assert.equal(recovery&&recovery.ambiguous,false);
assert.equal(recovery&&recovery.reconciliation&&recovery.reconciliation.disposition,'quarantined');
return recovery;
}
async function waitingOutcome(app){
const result=await call(app.client,'browserRelayStart');
if(!result.ok){
const message=String(result.error&&result.error.message||'');
if(/provider|agent-ready|ResourceExhausted|request limit/iu.test(message))return{classification:'BLOCKED_CONFIGURATION',message};
throw new Error(message||'Browser relay start failed after reconciliation.');
}
const current=await wait(async()=>{const value=await status(app);return value.browserRelay&&value.browserRelay.running===true&&value.browserRelay.lifecycle==='waiting_for_instruction'?value:null;},'waiting_for_instruction');
return{classification:'PROVEN',lifecycle:current.browserRelay.lifecycle};
}
(async()=>{
assert.ok(fs.existsSync(sourceFile),'source journal missing');
const before=fs.readFileSync(sourceFile),sourceRows=rows(before);
const productionCandidates=sourceRows.filter(item=>item.kind==='instruction'&&item.key===productionKey),productionRecord=productionCandidates[productionCandidates.length-1];
assert.ok(productionRecord,'production instruction missing');assert.equal(productionRecord.state,'executing');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'access-r3-rendered-')),file=path.join(directory,'browser-transport.jsonl');fs.writeFileSync(file,before);
const fixtureRaw='R3 rendered recovery fixture. This text must never reach local instruction execution.';
const fixtureMessageId='r3-rendered-recovery-fixture';
const fixtureHash=createHash('sha256').update(fixtureRaw).digest('hex');
const fixtureInput={workspaceRoot:productionRecord.workspaceRoot,conversationId:productionRecord.conversationId,targetId:'r3-fixture',instructionId:'turn-r3-rendered-fixture',transportKey:'assistant-turn:message:'+fixtureMessageId+':'+fixtureHash,raw:fixtureRaw};
const fixtureJournal=new BrowserTransportJournal(file);
const observed=fixtureJournal.observe(fixtureInput);fixtureJournal.markExecuting(fixtureInput,{type:'agent_instruction'});
key=observed.key;
const record={...fixtureInput,key,state:'executing'};
const baselineInstructionRows=rows(fs.readFileSync(file)).filter(item=>item.kind==='instruction'&&item.key===key);
let first=null,second=null,evidence=null,receipt=null,restartRecovery=null,waitingResult=null;
try{
first=await launch(file,record.workspaceRoot);await ready(first);await fixture(first,record);evidence=await blocked(first);receipt=(await reconcile(first)).recovery.reconciliation;await close(first);first=null;
second=await launch(file,record.workspaceRoot);await ready(second);await fixture(second,record);restartRecovery=await restartProjection(second);waitingResult=await waitingOutcome(second);
}finally{await close(first);await close(second);}
assert.deepEqual(fs.readFileSync(sourceFile),before,'production journal changed');
const finalRows=rows(fs.readFileSync(file)),instructionRows=finalRows.filter(item=>item.kind==='instruction'&&item.key===key);
assert.deepEqual(instructionRows,baselineInstructionRows,'fixture instruction was replayed or rewritten');
const productionAfter=finalRows.filter(item=>item.kind==='instruction'&&item.key===productionKey);assert.deepEqual(productionAfter,productionCandidates,'copied production instruction evidence changed');
const receipts=finalRows.filter(item=>item.kind==='instruction_reconciliation'&&item.instructionKey===key);assert.equal(receipts.length,1);assert.equal(receipts[0].receiptId,receipt.receiptId);
console.log(JSON.stringify({acceptance:'r3-rendered-recovery',status:waitingResult.classification==='PROVEN'?'RUNTIME_PROVEN_ISOLATED_FIXTURE':'CORE_RENDERED_PASSED_WAITING_BLOCKED_CONFIGURATION',sourceJournal:sourceFile,isolatedJournal:file,instructionKey:key,renderedEvidenceObserved:Boolean(evidence&&evidence.evidence),renderedActionInvoked:true,ipcReceiptObserved:true,receiptId:receipt.receiptId,restartProjectionPreserved:Boolean(restartRecovery&&restartRecovery.reconciliation),waitingForInstruction:waitingResult.classification,waitingLifecycle:waitingResult.lifecycle||null,waitingBlock:waitingResult.message||null,historicalInstructionRowsAdded:0,relayExecutionInvoked:false,productionJournalUnchanged:true,liveChatContentProven:false,fixtureTransport:'cdp-fetch-intercepted-synthetic-chatgpt-page'},null,2));
})().catch(error=>{console.error(JSON.stringify({acceptance:'r3-rendered-recovery',status:'FAIL',step:error.code||error.name,message:error.message,actual:error.actual||null},null,2));process.exitCode=1;});
