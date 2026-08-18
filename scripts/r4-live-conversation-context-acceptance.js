'use strict';

const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const CDP=require('chrome-remote-interface');
const electronExecutable=require('electron');
const {ProviderChannel}=require('../src/browser/provider-channel');

const HOST='127.0.0.1';
const POLL_MS=200;
const STEP_TIMEOUT_MS=Number(process.env.ACCESS_AGENT_R4_STEP_TIMEOUT_MS||120000);
const CYCLE_TIMEOUT_MS=Number(process.env.ACCESS_AGENT_R4_CYCLE_TIMEOUT_MS||300000);
const CHAT_URL=String(process.env.ACCESS_AGENT_ACCEPTANCE_CHAT_URL||'').trim();
const ROOT=path.resolve(__dirname,'..');
const nonce=`${Date.now()}-${process.pid}`;
const marker=`R4_HISTORY_MARKER_${nonce.replace(/[^A-Za-z0-9]/gu,'_')}`;
const seedAck=`R4_SEED_ACK_${nonce.replace(/[^A-Za-z0-9]/gu,'_')}`;
const queryTag=`R4_CONTEXT_QUERY_${nonce.replace(/[^A-Za-z0-9]/gu,'_')}`;
const journalFile=path.join(os.tmpdir(),`access-agent-r4-${nonce}.jsonl`);
const seedPrompt=`R4 fixture seed ${nonce}. Remember this exact historical token for a later comparison: ${marker}. Reply with exactly ${seedAck}. Do not repeat, quote, or expose the historical token in your reply.`;
const queryPrompt=`R4 context recovery probe ${nonce}. Ask the connected Access local agent exactly this task, preserving the tag ${queryTag}: "${queryTag}: Recover the exact historical token I gave earlier in this same ChatGPT conversation and return that token verbatim. The token is intentionally omitted from this instruction. Use the protected conversation context if needed. Do not ask me to repeat it." Do not include, quote, spell, or reveal the historical token yourself.`;

const GENERAL_BROWSER_TOOLS=new Set(['browserOpen','browserTabs','browserNavigate','browserSnapshot','browserClick','browserType','browserScroll','browserClose']);
const MUTATING_OR_EXTERNAL_TOOLS=new Set(['runCommand','writeFile','applyPatch','askUser']);

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function tail(value,limit=16000){const text=String(value||'');return text.length>limit?text.slice(-limit):text;}
function gitStatus(){try{return String(execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}));}catch(error){const e=new Error('Unable to read repository status before R4 acceptance: '+(error?.message||String(error)));e.code='R4_GIT_STATUS_FAILED';throw e;}}
function selectFreePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.unref();server.once('error',reject);server.listen(0,HOST,()=>{const address=server.address();const port=address&&typeof address==='object'?address.port:0;server.close(error=>error?reject(error):resolve(port));});});}
async function evaluate(client,expression){const result=await client.Runtime.evaluate({expression,returnByValue:true,awaitPromise:true});if(result?.exceptionDetails)throw Object.assign(new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'Renderer evaluation failed.'),{code:'R4_RENDERER_EVALUATION_FAILED'});return result?.result?.value;}
async function waitFor(reader,predicate,description,timeout=STEP_TIMEOUT_MS){const deadline=Date.now()+timeout;let actual=null;while(Date.now()<deadline){try{actual=await reader();}catch(error){if(error?.code&&String(error.code).startsWith('R4_'))throw error;actual={error:error?.message||String(error)};}if(predicate(actual))return actual;await delay(POLL_MS);}throw Object.assign(new Error(`Timed out waiting for ${description}`),{code:'R4_STEP_TIMEOUT',expected:description,actual});}
async function waitForRenderer(port){return waitFor(async()=>{try{const targets=await CDP.List({host:HOST,port});return targets.find(target=>target.type==='page'&&/rebuild|index\.html|access/iu.test(`${target.url||''} ${target.title||''}`))||null;}catch{return null;}},Boolean,'Access renderer',30000);}
async function api(client,method,args=[]){return evaluate(client,`(async()=>{try{return{ok:true,value:await window.accessIde[${JSON.stringify(method)}](...${JSON.stringify(args)})};}catch(error){return{ok:false,error:{message:error?.message||String(error),code:error?.code||null}};}})()`);}
async function status(client){return evaluate(client,"(async()=>window.accessIde.status())()");}
async function diagnostics(client,limit=2600){return evaluate(client,`(async()=>window.accessIde?.diagnosticRecent?window.accessIde.diagnosticRecent(${Number(limit)}):[])()`).catch(()=>[]);}
async function setChatUrl(client){return evaluate(client,`(()=>{const n=document.getElementById('chatUrl');if(!n)throw new Error('chatUrl missing');n.value=${JSON.stringify(CHAT_URL)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));return n.value;})()`);}
async function click(client,id){return evaluate(client,`(()=>{const n=document.getElementById(${JSON.stringify(id)});if(!n)throw new Error('control missing: '+${JSON.stringify(id)});if(n.disabled)throw new Error('control disabled: '+${JSON.stringify(id)});n.click();return true;})()`);}
function maxSeq(rows){return Math.max(0,...(Array.isArray(rows)?rows:[]).map(row=>Number(row?.seq||0)));}
function rowsAfter(rows,seq){return (Array.isArray(rows)?rows:[]).filter(row=>Number(row?.seq||0)>seq);}
function relayEvents(rows,action){return rows.filter(row=>row?.source==='browser-relay'&&row?.action===action);}
function agentEvents(rows,action){return rows.filter(row=>row?.source==='agent-runtime'&&row?.action===action);}
function explicitFailures(rows){return rows.filter(row=>(row?.severity==='error'||row?.phase==='failed')&&['browser-relay','provider-channel','renderer','agent-runtime'].includes(String(row?.source||'')));}
function toolName(row){return String(row?.data?.toolName||row?.data?.data?.toolName||'');}
function toolCallId(row){return String(row?.data?.toolCallId||row?.data?.data?.toolCallId||row?.correlation?.toolCallId||'');}
function toolMessage(row){return row?.data?.message||row?.data?.data?.message||null;}
function compactStatus(s){return{runtimeActive:s?.runtimeControl?.active===true,agent:{status:s?.agent?.status||null,sessionId:s?.agent?.sessionId||null,running:s?.agent?.running===true},browser:{lifecycle:s?.browser?.lifecycle||null,endpoint:s?.browser?.endpoint||null,backendReady:s?.browser?.backendReady===true},relay:{lifecycle:s?.browserRelay?.lifecycle||null,running:s?.browserRelay?.running===true,targetId:s?.browserRelay?.target?.targetId||null,providerId:s?.browserRelay?.target?.providerId||null,error:s?.browserRelay?.error||null}};}

async function waitForAssistant(channel,endpoint,targetId,providerId,{mustContain,previousMessageId='',previousText='',forbid=''}){
  return waitFor(async()=>{
    const snap=await channel.snapshot(endpoint,targetId,providerId);
    if(snap.generating)return null;
    const changed=String(snap?.provenance?.messageId||'')!==String(previousMessageId||'')||String(snap.text||'')!==String(previousText||'');
    if(!changed)return null;
    if(mustContain&&!String(snap.text||'').includes(mustContain))return null;
    if(forbid&&String(snap.text||'').includes(forbid)){
      const error=new Error('Browser-side assistant leaked the protected historical marker into a fixture turn.');
      error.code='R4_FIXTURE_MARKER_LEAK';
      error.actual={text:String(snap.text||'').slice(0,4000)};
      throw error;
    }
    return snap;
  },Boolean,`assistant turn containing ${mustContain}`,STEP_TIMEOUT_MS);
}

async function main(){
  if(!CHAT_URL)throw Object.assign(new Error('ACCESS_AGENT_ACCEPTANCE_CHAT_URL is required.'),{code:'R4_CHAT_URL_REQUIRED'});
  const beforeGit=gitStatus();
  if(beforeGit.trim())throw Object.assign(new Error('Canonical acceptance worktree must be clean before R4.'),{code:'R4_WORKTREE_NOT_CLEAN',actual:beforeGit});

  const port=await selectFreePort();
  const stdout=[];const stderr=[];let child=null;let client=null;
  try{
    child=spawn(electronExecutable,[`--remote-debugging-port=${port}`,ROOT],{cwd:ROOT,env:{...process.env,ACCESS_AGENT_UI_ACCEPTANCE:'1',ACCESS_AGENT_TRANSPORT_JOURNAL_FILE:journalFile},windowsHide:false,stdio:['ignore','pipe','pipe']});
    child.stdout?.on('data',chunk=>stdout.push(String(chunk)));child.stderr?.on('data',chunk=>stderr.push(String(chunk)));
    const renderer=await waitForRenderer(port);client=await CDP({host:HOST,port,target:renderer.id});await client.Runtime.enable();
    await waitFor(()=>evaluate(client,"(()=>({ready:document.readyState,api:Boolean(window.accessIde?.status),browser:Boolean(window.accessIde?.browserStart&&window.accessIde?.browserOpenExactChat),start:Boolean(document.getElementById('loopStart'))}))()"),value=>value?.ready==='complete'&&value?.api&&value?.browser&&value?.start,'renderer APIs',30000);
    await setChatUrl(client);

    // Seed the protected exact chat before Browser Loop exists so the local agent cannot learn the marker from its own session history.
    const browserStarted=await api(client,'browserStart');if(!browserStarted.ok)throw Object.assign(new Error(browserStarted.error?.message||'browserStart failed'),{code:'R4_BROWSER_START_FAILED'});
    const browser=browserStarted.value?.browser||browserStarted.value;const endpoint=String(browser?.endpoint||'');if(!endpoint)throw Object.assign(new Error('Managed Chrome endpoint missing.'),{code:'R4_BROWSER_ENDPOINT_MISSING'});
    const opened=await api(client,'browserOpenExactChat',[{endpoint,chatUrl:CHAT_URL}]);if(!opened.ok||opened.value?.ok!==true)throw Object.assign(new Error(opened.error?.message||opened.value?.error?.message||'browserOpenExactChat failed'),{code:'R4_EXACT_CHAT_OPEN_FAILED',actual:opened});
    const targetId=String(opened.value?.target?.targetId||'');const providerId=String(opened.value?.target?.providerId||'chatgpt');if(!targetId)throw Object.assign(new Error('Exact chat targetId missing.'),{code:'R4_TARGET_ID_MISSING'});
    const channel=new ProviderChannel({readinessTimeoutMs:10000});channel.targetUrls.set(targetId,CHAT_URL);
    const beforeSeed=await channel.snapshot(endpoint,targetId,providerId);
    await channel.send(endpoint,targetId,providerId,seedPrompt);
    const seededAssistant=await waitForAssistant(channel,endpoint,targetId,providerId,{mustContain:seedAck,previousMessageId:beforeSeed?.provenance?.messageId,previousText:beforeSeed?.text,forbid:marker});
    const seededConversation=await channel.readConversation(endpoint,targetId,providerId,{limit:12});
    const seedUser=seededConversation.messages.find(message=>message.role==='user'&&String(message.text||'').includes(marker));
    if(!seedUser)throw Object.assign(new Error('Historical marker was not observed in the protected exact-chat history.'),{code:'R4_SEED_MARKER_NOT_OBSERVED'});
    if(seededConversation.messages.some(message=>message.role==='assistant'&&String(message.text||'').includes(marker)))throw Object.assign(new Error('Historical marker leaked into an assistant turn before local execution.'),{code:'R4_FIXTURE_MARKER_LEAK'});

    // Start Browser Loop only after the marker is safely historical. The seed acknowledgement must become a baseline, never a local instruction.
    const startBaselineSeq=maxSeq(await diagnostics(client));
    await click(client,'loopStart');
    const started=await waitFor(async()=>{const s=await status(client);return s?.runtimeControl?.active===true&&s?.browser?.backendReady===true&&s?.browserRelay?.running===true&&s?.browserRelay?.lifecycle==='waiting_for_instruction'&&s?.browserRelay?.target?.targetId?s:null;},Boolean,'R4 relay waiting_for_instruction',180000);
    await delay(2500);
    const afterStartRows=rowsAfter(await diagnostics(client,2200),startBaselineSeq);
    const historicalSubmits=relayEvents(afterStartRows,'instruction_submit').filter(row=>row?.phase==='start');
    if(historicalSubmits.length)throw Object.assign(new Error('Seed acknowledgement entered the local agent instead of remaining a first-start historical baseline.'),{code:'R4_FIXTURE_SEED_ENTERED_LOCAL_SESSION',actual:{historicalSubmits:historicalSubmits.length}});

    const activeTargetId=String(started.browserRelay.target.targetId);const activeProviderId=String(started.browserRelay.target.providerId||'chatgpt');const activeEndpoint=String(started.browser.endpoint);
    // Browser Loop may select an existing tab for the same configured conversation instead of the tab opened by the fixture.
    // Target identity is therefore not the acceptance boundary; exact-chat identity plus marker presence on the selected target is.
    channel.targetUrls.set(activeTargetId,CHAT_URL);
    const activeConversation=await channel.readConversation(activeEndpoint,activeTargetId,activeProviderId,{limit:12});
    const activeSeedUser=activeConversation.messages.find(message=>message.role==='user'&&String(message.text||'').includes(marker));
    if(!activeSeedUser)throw Object.assign(new Error('Browser Loop selected the exact chat URL, but the seeded historical marker is not visible on its active target.'),{code:'R4_ACTIVE_TARGET_MISSING_SEEDED_HISTORY',actual:{seedTargetId:targetId,activeTargetId,activeUrl:activeConversation.url}});
    if(activeConversation.messages.some(message=>message.role==='assistant'&&String(message.text||'').includes(marker)))throw Object.assign(new Error('Historical marker leaked into an assistant turn on the Browser Loop active target before local execution.'),{code:'R4_FIXTURE_MARKER_LEAK'});

    const baselineRows=await diagnostics(client,2600);const baselineSeq=maxSeq(baselineRows);
    const beforeQuery=await channel.snapshot(activeEndpoint,activeTargetId,activeProviderId);
    await channel.send(activeEndpoint,activeTargetId,activeProviderId,queryPrompt);
    const queryAssistant=await waitForAssistant(channel,activeEndpoint,activeTargetId,activeProviderId,{mustContain:queryTag,previousMessageId:beforeQuery?.provenance?.messageId,previousText:beforeQuery?.text,forbid:marker});
    if(String(queryAssistant.text||'').includes(marker))throw Object.assign(new Error('Current Browser Loop assistant turn contains the marker, so reader use is not required.'),{code:'R4_FIXTURE_CURRENT_TURN_LEAKED_MARKER'});

    const accepted=await waitFor(async()=>{
      const rows=rowsAfter(await diagnostics(client,3200),baselineSeq);
      const failures=explicitFailures(rows);
      if(failures.length)throw Object.assign(new Error('R4 observed an explicit runtime failure.'),{code:'R4_RUNTIME_FAILURE',actual:{failures:failures.slice(-10)}});
      const submits=relayEvents(rows,'instruction_submit').filter(row=>row?.phase==='start');
      if(submits.length>1)throw Object.assign(new Error('R4 produced duplicate local instruction submissions.'),{code:'R4_DUPLICATE_LOCAL_SUBMISSION',actual:{count:submits.length}});

      const startedTools=agentEvents(rows,'execution.tool.started');
      const readerStarts=startedTools.filter(row=>toolName(row)==='browserConversationRead');
      const disallowed=startedTools.filter(row=>GENERAL_BROWSER_TOOLS.has(toolName(row))||MUTATING_OR_EXTERNAL_TOOLS.has(toolName(row)));
      if(disallowed.length)throw Object.assign(new Error('R4 agent substituted a forbidden browser/mutation/ask-user tool.'),{code:'R4_FORBIDDEN_TOOL_SUBSTITUTION',actual:{tools:disallowed.map(toolName)}});

      const readerIds=new Set(readerStarts.map(toolCallId).filter(Boolean));
      const readerToolMessages=agentEvents(rows,'conversation.message').map(row=>toolMessage(row)).filter(message=>message?.role==='tool'&&readerIds.has(String(message.tool_call_id||'')));
      const readerReturnedMarker=readerToolMessages.some(message=>String(message.content||'').includes(marker));
      const completed=agentEvents(rows,'objective.completed');
      const completedWithMarker=completed.find(row=>String(row?.data?.summary||row?.data?.detail||row?.detail||'').includes(marker));
      const sent=relayEvents(rows,'browser_relay.result_sent');
      const consumed=relayEvents(rows,'browser_relay.delivery_response_consumed');

      if(submits.length===1&&readerStarts.length>=1&&readerReturnedMarker&&completedWithMarker&&sent.length>=1&&consumed.length>=1){
        const current=await status(client);
        if(current?.browserRelay?.running===true&&current?.browserRelay?.lifecycle==='waiting_for_instruction')return{rows,submits,startedTools,readerStarts,readerToolMessages,completedWithMarker,sent,consumed,status:current};
      }
      return null;
    },Boolean,'autonomous browserConversationRead -> marker -> local result -> same-chat delivery -> consumed response',CYCLE_TIMEOUT_MS);

    await delay(2000);
    const finalRows=rowsAfter(await diagnostics(client,3400),baselineSeq);
    const finalSubmits=relayEvents(finalRows,'instruction_submit').filter(row=>row?.phase==='start');
    if(finalSubmits.length!==1)throw Object.assign(new Error('R4 local submission count was not stable at exactly one.'),{code:'R4_UNSTABLE_SUBMISSION_COUNT',actual:{count:finalSubmits.length}});
    const finalStatus=await status(client);
    if(finalStatus?.browserRelay?.running!==true||finalStatus?.browserRelay?.lifecycle!=='waiting_for_instruction')throw Object.assign(new Error('R4 relay did not return to stable waiting.'),{code:'R4_NOT_STABLE_WAITING',actual:compactStatus(finalStatus)});

    const finalTools=agentEvents(finalRows,'execution.tool.started').map(toolName).filter(Boolean);
    const finalReaderStarts=finalTools.filter(name=>name==='browserConversationRead');
    const forbiddenTools=finalTools.filter(name=>GENERAL_BROWSER_TOOLS.has(name)||MUTATING_OR_EXTERNAL_TOOLS.has(name));
    if(!finalReaderStarts.length)throw Object.assign(new Error('Local result may be correct, but no correlated browserConversationRead call was observed.'),{code:'R4_READER_NOT_SELECTED',classification:'INCONCLUSIVE'});
    if(forbiddenTools.length)throw Object.assign(new Error('Forbidden tool use appeared after the causal cycle.'),{code:'R4_FORBIDDEN_TOOL_SUBSTITUTION',actual:{tools:forbiddenTools}});

    const afterGit=gitStatus();
    if(afterGit!==beforeGit)throw Object.assign(new Error('Repository worktree changed during read-only R4 acceptance.'),{code:'R4_WORKSPACE_MUTATION_DETECTED',actual:{before:beforeGit,after:afterGit}});

    console.log('R4 LIVE CONVERSATION CONTEXT ACCEPTANCE: PASS');
    console.log(JSON.stringify({
      chatUrl:CHAT_URL,
      nonce,
      marker,
      queryTag,
      journalFile,
      seedTargetId:targetId,
      activeTargetId,
      seedMarkerObservedInProtectedHistory:true,
      activeTargetMarkerObservedInProtectedHistory:true,
      seedAssistantExcludedMarker:true,
      historicalLocalSubmissions:0,
      currentAssistantExcludedMarker:true,
      localSubmissionCount:1,
      browserConversationReadCalls:finalReaderStarts.length,
      readerResultContainedMarker:true,
      finalLocalResultContainedMarker:true,
      forbiddenToolCalls:forbiddenTools,
      resultSentCount:accepted.sent.length,
      deliveryResponseConsumedCount:accepted.consumed.length,
      worktreeUnchanged:true,
      finalStatus:compactStatus(finalStatus),
    },null,2));
  }catch(error){
    const current=client?await status(client).catch(()=>null):null;
    const rows=client?await diagnostics(client,3400).catch(()=>[]):[];
    console.error('R4 LIVE CONVERSATION CONTEXT ACCEPTANCE: FAIL');
    console.error(JSON.stringify({code:error?.code||null,classification:error?.classification||null,message:error?.message||String(error),expected:error?.expected||null,actual:error?.actual||null,status:compactStatus(current),diagnostics:(Array.isArray(rows)?rows:[]).slice(-120),stdout:tail(stdout.join('')),stderr:tail(stderr.join('')),journalFile,marker,queryTag},null,2));
    process.exitCode=1;
  }finally{
    if(client){try{const current=await status(client);if(current?.runtimeControl?.active===true||current?.browser?.endpoint||current?.browserRelay?.running===true)await click(client,'stopAll').catch(()=>{});}catch{}await client.close().catch(()=>{});}
    if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
    try{fs.rmSync(journalFile,{force:true});}catch{}
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});