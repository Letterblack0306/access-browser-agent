'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ToolRegistry=require('../src/agent/ToolRegistry');
const OpenAICompatibleProvider=require('../src/llm/OpenAICompatibleProvider');
const {RuntimeDiagnosticLog}=require('../src/system/runtime-diagnostic-log');
const {setDiagnosticSink,subscribeDiagnostic,emitDiagnostic}=require('../src/system/runtime-diagnostic-bus');
const {createCorrelation,extendCorrelation,conversationIdFromUrl}=require('../src/system/runtime-correlation');
const {runWithCorrelation}=require('../src/system/runtime-correlation-context');
const {BrowserEvidenceStore,ObservableProviderChannel,ObservableBrowserInstructionRelay,renderedMarker,normalizeRenderedText}=require('../src/browser/observable-browser-runtime');
const {BrowserTransportJournal}=require('../src/system/browser-transport-journal');

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'access-agent-truth-'));
  const log=new RuntimeDiagnosticLog({root,sessionId:'truth-test'});
  setDiagnosticSink(log);
  const streamed=[];
  const unsubscribe=subscribeDiagnostic(record=>streamed.push(record));

  const correlation=createCorrelation({chatUrl:'https://chatgpt.com/c/abc',instructionId:'i-1',targetId:'t-1'});
  assert.ok(correlation.operationId);
  assert.equal(correlation.conversationId,conversationIdFromUrl('https://chatgpt.com/c/abc?x=1'));
  assert.equal(extendCorrelation(correlation,{sessionId:'s-1'}).operationId,correlation.operationId);
  await runWithCorrelation(correlation,async()=>emitDiagnostic({source:'context-test',category:'agent',action:'inherited',phase:'event'}));
  assert.ok(streamed.some(item=>item.source==='context-test'&&item.correlation?.operationId===correlation.operationId&&item.correlation?.instructionId==='i-1'));
  await runWithCorrelation(correlation,async()=>emitDiagnostic({source:'context-merge-test',category:'agent',action:'defined-only-override',phase:'event',correlation:{operationId:undefined,toolCallId:'merge-tool'}}));
  assert.ok(streamed.some(item=>item.source==='context-merge-test'&&item.correlation?.operationId===correlation.operationId&&item.correlation?.toolCallId==='merge-tool'),'undefined explicit correlation must not erase inherited operation identity');

  const registry=new ToolRegistry([{name:'explode',description:'test',schema:{type:'object'},execute:async()=>{const error=new Error('missing file');error.code='ENOENT';throw error;}}]);
  const failed=await runWithCorrelation(correlation,()=>registry.execute('explode',{}, {sessionId:'s-1',turnId:'turn-1',toolCallId:'tc-1'}));
  assert.equal(failed.ok,false);assert.equal(failed.output.observation,'NOT_FOUND');assert.equal(failed.output.error.code,'ENOENT');
  const unavailable=await registry.execute('notRegistered',{}, {sessionId:'s-1',turnId:'turn-1',toolCallId:'tc-2'});
  assert.equal(unavailable.output.observation,'UNAVAILABLE');
  assert.ok(log.readRecent(30).some(item=>item.source==='tool-registry'&&item.correlation?.toolCallId==='tc-1'&&item.correlation?.operationId===correlation.operationId));

  const fakePayload={id:'req-123',object:'chat.completion',model:'tool-model',choices:[{finish_reason:'tool_calls',message:{content:'',tool_calls:[{id:'tc',function:{name:'diagnostic_probe',arguments:'{"value":"PING"}'}}]}}],usage:{prompt_tokens:1,completion_tokens:1}};
  const provider=new OpenAICompatibleProvider({baseUrl:'http://127.0.0.1:1234/v1',model:'tool-model',fetch:async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(fakePayload)})});
  const completion=await runWithCorrelation(correlation,()=>provider.complete({messages:[{role:'user',content:'probe'}],tools:[{type:'function',function:{name:'diagnostic_probe',parameters:{type:'object'}}}]}));
  assert.equal(completion.providerRequestId,'req-123');assert.equal(completion.providerStopReason,'tool_calls');assert.equal(completion.providerEventType,'chat.completion');assert.equal(completion.toolCalls[0].name,'diagnostic_probe');

  const store=new BrowserEvidenceStore(path.join(root,'artifacts'));
  const artifact=await store.put({dom:{url:'https://chatgpt.com/c/abc',composerCount:1},correlation,privacy:{state:'minimized',screenshotPolicy:'disabled_by_default',containsConversationContent:false}});
  assert.equal(artifact.refs.length,1);assert.equal(artifact.privacy.containsConversationContent,false);assert.equal(artifact.refs[0].type,'dom');assert.ok(artifact.refs[0].sha256&&fs.existsSync(artifact.refs[0].path));

  const resultEnvelope='=== ACCESS AGENT RESULT START ===\nINSTRUCTION ID: i-77\nSTATUS: COMPLETE\nMODEL REPORT:\nFinished safely.\n=== ACCESS AGENT RESULT END ===';
  const marker=renderedMarker(resultEnvelope);
  assert.match(marker,/^=== ACCESS AGENT RESULT START === INSTRUCTION ID: i-77 STATUS: COMPLETE/u);
  const originalInstruction='=== ACCESS AGENT INSTRUCTION START ===\nINSTRUCTION ID: i-77\nOBJECTIVE:\nDo work\n=== ACCESS AGENT INSTRUCTION END ===';
  assert.equal(normalizeRenderedText(originalInstruction).includes(marker),false);assert.equal(normalizeRenderedText(resultEnvelope).includes(marker),true);

  const renderedChannel=new ObservableProviderChannel({cdpFactory:async()=>{throw new Error('not used');},renderTimeoutMs:500});
  renderedChannel.readConversation=async()=>({
    ok:true,url:'https://chatgpt.com/c/abc',title:'ChatGPT',messages:[
      {role:'assistant',text:'Prior assistant turn.',messageIndex:1,messageId:'a-1'},
      {role:'user',text:resultEnvelope,messageIndex:2,messageId:'u-result'},
    ],
  });
  const rendered=await renderedChannel.verifyRenderedDelivery('http://127.0.0.1:9222','target-1','chatgpt',resultEnvelope,'https://chatgpt.com/c/abc');
  assert.equal(rendered.verified,true,'rendered delivery must be verified from the user-authored result turn, not the latest assistant turn');
  assert.equal(rendered.message.role,'user');
  assert.equal(rendered.message.messageId,'u-result');

  const journalFile=path.join(root,'browser-transport.jsonl');
  const journal=new BrowserTransportJournal(journalFile);
  const journalInput={workspaceRoot:'G:\\Demo',conversationId:'https://chatgpt.com/c/abc',targetId:'target-1',instructionId:'instruction-1',transportKey:'instruction:instruction-1',raw:'raw-envelope'};
  assert.equal(journal.observe(journalInput).state,'observed');
  assert.equal(journal.markExecuting(journalInput).state,'executing');
  assert.equal(journal.markResultQueued(journalInput,{payload:'RESULT',queuedAtMs:1}).state,'result_queued');
  assert.equal(journal.markDelivering(journalInput,{deliveryAttempts:1}).state,'delivering');
  assert.equal(journal.markDelivered(journalInput,{evidenceLevel:'RENDERED_DELIVERY_VERIFIED'}).state,'delivered');
  const recovered=new BrowserTransportJournal(journalFile);
  assert.equal(recovered.get({...journalInput,targetId:'different-target'}).state,'delivered','instruction identity must survive CDP target replacement');

  const ownershipJournal=new BrowserTransportJournal(path.join(root,'observable-ownership.jsonl'));
  const ownershipScope={workspaceRoot:'G:\\Demo',conversationId:'https://chatgpt.com/c/abc',targetId:'target-1'};
  ownershipJournal.markLoopStarted(ownershipScope,{lastInstructionHash:'hash-a'});
  const ownershipInput={workspaceRoot:'G:\\Demo',conversationId:'https://chatgpt.com/c/abc',targetId:'target-1',instructionId:'turn-a',transportKey:'assistant-turn:message:a:hash',raw:'Do bounded work.'};
  ownershipJournal.observe(ownershipInput);ownershipJournal.markExecuting(ownershipInput);ownershipJournal.markResultQueued(ownershipInput,{payload:resultEnvelope,queuedAtMs:Date.now(),resultRecordSha256:'c'.repeat(64)});
  const ownershipEvents=[];let ownershipSubmitCalls=0;
  const ownershipRelay=new ObservableBrowserInstructionRelay({
    channel:{
      snapshot:async()=>({targetId:'target-1',providerId:'chatgpt',text:'Provider acknowledgement.',generating:false,url:'https://chatgpt.com/c/abc',provenance:{verifiedAssistant:true,messagePresent:true,messageIndex:3,messageId:'assistant-b'}}),
      send:async()=>({accepted:true,evidenceLevel:'RENDERED_DELIVERY_VERIFIED',rendered:{verified:true,message:{role:'user',messageId:'u-result'}}}),
      expectedUrlFor:()=> 'https://chatgpt.com/c/abc',
    },
    getEndpoint:()=> 'http://127.0.0.1:9222',getWorkspaceRoot:()=> 'G:\\Demo',journal:ownershipJournal,
    submitInstruction:async()=>{ownershipSubmitCalls+=1;return{ok:true,terminalState:'completed',summary:'unexpected'};},onEvent:event=>ownershipEvents.push(event),
  });
  ownershipRelay.running=true;ownershipRelay.generation=1;ownershipRelay.activeTarget={targetId:'target-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'};ownershipRelay.target={...ownershipRelay.activeTarget};ownershipRelay.loopScope=ownershipScope;ownershipRelay.lastHash='hash-a';
  ownershipRelay.pending={generation:1,instructionId:'turn-a',payload:resultEnvelope,attempts:0,queuedAtMs:Date.now(),nextAttemptAt:0,journalInput:ownershipInput,resultRecordSha256:'c'.repeat(64)};
  ownershipRelay.delivery={state:'queued',instructionId:'turn-a',attempts:0,maxAttempts:5};
  await ownershipRelay._deliverPending({endpoint:'http://127.0.0.1:9222',target:ownershipRelay.activeTarget,generation:1});
  assert.equal(ownershipRelay.lifecycle,'waiting_for_instruction');
  assert.equal(ownershipRelay.running,true);
  assert.equal(ownershipJournal.getLoopState(ownershipScope).deliveryResponse.state,'pending','the active observable relay must persist provider-response ownership after verified result delivery');
  await ownershipRelay._tick({schedule:false});
  assert.equal(ownershipSubmitCalls,0,'the provider assistant response owned by result delivery must not be submitted to the local reasoning agent');
  assert.equal(ownershipJournal.getLoopState(ownershipScope).deliveryResponse.state,'consumed');
  assert.ok(ownershipEvents.some(event=>event.phase==='browser_relay.delivery_response_consumed'));

  const relayEvents=[];
  const relay=new ObservableBrowserInstructionRelay({
    channel:{snapshot:async()=>({targetId:'target-1',providerId:'chatgpt',text:'',generating:false,url:'https://chatgpt.com/c/abc',provenance:{verifiedAssistant:true,messagePresent:false}}),send:async()=>({accepted:true,evidenceLevel:'SUBMISSION_ACCEPTED',rendered:{verified:false,reason:'marker not observed'}}),expectedUrlFor:()=> 'https://chatgpt.com/c/abc'},
    getEndpoint:()=> 'http://127.0.0.1:9222',getWorkspaceRoot:()=> 'G:\\Demo',submitInstruction:async()=>({ok:true,sessionId:'session-relay',turnId:'turn-relay'}),onEvent:event=>relayEvents.push(event),
  });
  relay.running=true;relay.generation=1;relay.activeTarget={targetId:'target-1',providerId:'chatgpt',url:'https://chatgpt.com/c/abc'};
  relay.pending={generation:1,instructionId:'instruction-unverified',payload:'result',attempts:0,queuedAtMs:Date.now(),nextAttemptAt:0};relay.delivery={state:'queued',instructionId:'instruction-unverified',attempts:0,maxAttempts:5};
  await relay._deliverPending({endpoint:'http://127.0.0.1:9222',target:relay.activeTarget,generation:1});
  assert.equal(relay.lifecycle,'delivery_unverified');assert.equal(relay.running,false,'ambiguous accepted delivery must fail closed before any provider response can be reinterpreted as new work');assert.equal(relay.delivery.state,'submitted_unverified');assert.ok(relayEvents.some(event=>event.phase==='browser_relay.delivery_unverified'));assert.ok(!relayEvents.some(event=>event.phase==='browser_relay.result_sent'));

  const adapter=fs.readFileSync(path.join(__dirname,'..','electron','agent-runtime-adapter.js'),'utf8');
  const settings=fs.readFileSync(path.join(__dirname,'..','electron','rebuild-settings.js'),'utf8');
  const observable=fs.readFileSync(path.join(__dirname,'..','src','browser','observable-browser-runtime.js'),'utf8');
  const main=fs.readFileSync(path.join(__dirname,'..','electron','rebuild-main.js'),'utf8');
  const unified=fs.readFileSync(path.join(__dirname,'..','src','agent','executive','UnifiedAgentService.js'),'utf8');
  const bridge=fs.readFileSync(path.join(__dirname,'..','electron','task-state-router-bridge.js'),'utf8');
  const preload=fs.readFileSync(path.join(__dirname,'..','electron','preload.js'),'utf8');
  const relaySource=fs.readFileSync(path.join(__dirname,'..','src','agent','executive','BrowserInstructionRelay.js'),'utf8');
  const renderer=fs.readFileSync(path.join(__dirname,'..','electron','rebuild-renderer.js'),'utf8');
  const stabilityCss=fs.readFileSync(path.join(__dirname,'..','electron','rebuild-ui-stability.css'),'utf8');
  assert.match(adapter,/PROVIDER_CAPABILITY_UNVERIFIED/u);assert.match(adapter,/diagnostic_probe/u);
  assert.match(adapter,/if \(input\.discoverOnly === true\)/u);assert.match(adapter,/contactState:'not_checked'/u);
  assert.doesNotMatch(adapter,/const health=await provider\.checkHealth\(\)/u);
  assert.match(adapter,/readinessAttempt=await this\.providerReadiness\(\)/u);
  assert.doesNotMatch(settings,/configured\?\.provider\?\.healthy/u);
  assert.match(settings,/discoverOnly:true/u);assert.match(settings,/await api\.providerReadiness\(\)/u);
  assert.match(observable,/RENDERED_DELIVERY_VERIFIED/u);assert.match(observable,/disabled_by_default/u);assert.doesNotMatch(observable,/SEND_NOT_CONFIRMED'\s*,/u);
  assert.match(main,/sharedBrowserChannel/u);assert.match(main,/BrowserTransportJournal/u);
  assert.match(main,/ChangeGovernanceGuard/u);assert.match(main,/assertMutation\(\{toolName:'runCommand'/u);
  assert.ok(main.indexOf("assertMutation({toolName:'runCommand'") < main.indexOf('terminal.preview(normalized)'),'quick command governance must run before terminal execution');
  assert.doesNotMatch(main,/DEFAULT_ALLOWED_COMMANDS/u,'quick command must not impose the old product-wide executable list');
  assert.doesNotMatch(main,/replace\(\/\^\\s\*\(npm\|npx\|pnpm\|yarn\)/u,'quick command must not rewrite executable identity into Windows-specific suffixes');
  assert.match(main,/resolvedExecutable:result\.resolvedExecutable/u,'quick command diagnostics must retain resolved executable identity');
  assert.doesNotMatch(unified,/new ClineStyleAgentCore/u);assert.doesNotMatch(unified,/_pendingApprovals/u);
  assert.doesNotMatch(bridge,/require\([^\n]*TaskStateRouter[^\n]*\)/u);assert.doesNotMatch(bridge,/new\s+TaskStateRouter\s*\(/u);assert.doesNotMatch(bridge,/task_complete|level_complete|needs_decision/u);
  assert.doesNotMatch(preload,/agentApprove|agentReject|taskStateSnapshot|task-state:/u);
  assert.match(relaySource,/markResultQueued/u);assert.match(relaySource,/markDelivering/u);assert.match(relaySource,/markDelivered/u);assert.doesNotMatch(relaySource,/SEND_NOT_CONFIRMED','/u);
  assert.match(renderer,/cursorBlink:false/u);assert.doesNotMatch(renderer,/deliveryMeter'\)\.style\.width/u);
  assert.match(renderer,/latestStatusFingerprint/u);assert.match(renderer,/renderRuntimeTruth/u);assert.match(renderer,/runtimeTruthRecord/u);
  assert.doesNotMatch(renderer,/class=\\?"empty-state\\?" style=/u);assert.doesNotMatch(renderer,/class=\\?"file-row\\?" style=/u);
  assert.match(stabilityCss,/runtime-truth-row/u);assert.match(stabilityCss,/data-progress="10"/u);

  unsubscribe();
  console.log('rebuild-agent-truth-observability-smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
