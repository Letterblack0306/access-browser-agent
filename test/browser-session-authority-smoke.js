'use strict';

const assert=require('node:assert/strict');
const {BrowserSessionAuthority}=require('../electron/browser-session-authority');

(async()=>{
  const selected=[];
  const relay={
    running:false,target:null,
    recoveryPreflightError:null,recoveryPreflights:0,
    status(){return{running:this.running,target:this.target,lifecycle:this.running?'waiting_for_instruction':'stopped',error:null};},
    selectTarget(target){if(this.running)throw new Error('relay is running');this.target={...target};selected.push(target);return this.status();},
    async start(options={}){if(options.recoveryOnly){this.recoveryPreflights+=1;if(this.recoveryPreflightError)throw this.recoveryPreflightError;return this.status();}this.running=true;return this.status();},
    stop(){this.running=false;return this.status();},
    clearTarget(){this.stop();this.target=null;return this.status();},
    async checkOnce(){return{ok:true};},
  };
  const recoveryCalls=[];
  relay.getWorkspaceRoot=()=> ['G:','Demo'].join(require('node:path').win32.sep);
  relay.journal={
    getRecovery:input=>{recoveryCalls.push({type:'read',input});return{key:input.key,ambiguous:true,record:{state:'executing'},reconciliation:null};},
    reconcileRecovery:input=>{recoveryCalls.push({type:'reconcile',input});return{kind:'instruction_reconciliation',instructionKey:input.key,instructionId:'turn-r3',receiptId:'receipt-r3',disposition:input.disposition};},
  };
  const bootstrapUrl='data:text/html;charset=utf-8,<title>Access%20Agent%20bootstrap%201</title>';
  const closedTargets=[];
  const targets=[
    {targetId:'owned-bootstrap',providerId:null,provider:'Unsupported page',supported:false,title:'Access Agent bootstrap 1',url:bootstrapUrl,type:'page'},
    {targetId:'user-blank',providerId:null,provider:'Unsupported page',supported:false,title:'',url:'about:blank',type:'page'},
    {targetId:'chat',providerId:'chatgpt',provider:'ChatGPT',supported:true,title:'Conversation',url:'https://chatgpt.com/c/abc',type:'page'},
    {targetId:'random',providerId:null,provider:'Unsupported page',supported:false,title:'Random',url:'https://example.com/',type:'page'},
  ];
  const meta=new Map();
  const channel={
    targetUrls:new Map([['chat','https://chatgpt.com/c/abc']]),
    listTabs:async()=>targets.map(target=>({...target})),
    expectedUrlFor:id=>channel.targetUrls.get(String(id))||'',
    targetProvenance:id=>meta.get(String(id))||null,
    closeTarget:async(_endpoint,targetId)=>{closedTargets.push(String(targetId));return{success:true};},
    inspectTarget:async(_endpoint,id,providerId)=>{
      if(providerId!=='chatgpt')throw Object.assign(new Error('unsupported'),{code:'UNSUPPORTED_CHAT_PROVIDER'});
      const provenance={providerId,configuredUrl:'https://chatgpt.com/c/abc',selectedAt:'2026-08-14T00:00:00.000Z',lastValidatedAt:new Date().toISOString()};
      meta.set(String(id),provenance);
      return{targetId:id,providerId,title:'Conversation',url:'https://chatgpt.com/c/abc',provenance,targetProvenance:provenance};
    },
  };
  const managedState={lifecycle:'ready',endpoint:'http://127.0.0.1:7330',generation:1,bootstrapUrl,bootstrapTargetId:null};
  const managedChrome={
    status:()=>({...managedState}),start:async()=>({...managedState}),
    claimBootstrapTarget(items){const match=items.find(item=>item.url===managedState.bootstrapUrl);managedState.bootstrapTargetId=match?.targetId||null;return managedState.bootstrapTargetId;},
    releaseBootstrapTarget(targetId){if(managedState.bootstrapTargetId!==String(targetId))return false;managedState.bootstrapTargetId=null;managedState.bootstrapUrl=null;return true;},
    stop:async()=>({lifecycle:'stopped',endpoint:null,generation:2}),
  };
  const authority=new BrowserSessionAuthority({managedChrome,channel,relay,allowHosts:['example.com']});
  const generalState={lifecycle:'ready',endpoint:'http://127.0.0.1:7440',generation:1};
  const generalManagedChrome={
    status:()=>({...generalState}),
    readyEndpoint:async()=>generalState,
    start:async()=>({...generalState}),
    stop:async()=>({lifecycle:'stopped',endpoint:null,generation:2}),
  };
  const isolatedAuthority=new BrowserSessionAuthority({managedChrome,generalManagedChrome,channel,relay});
  const generalBrowser=await isolatedAuthority._ensureLiveGeneralBrowser();
  assert.equal(generalBrowser.endpoint,'http://127.0.0.1:7440');
  assert.notEqual(isolatedAuthority.generalManagedChrome,isolatedAuthority.managedChrome,'general tools must have a distinct browser owner');
  const browser=await authority.openBrowser();
  assert.equal(browser.lifecycle,'browser_ready');
  assert.equal(managedChrome.status().bootstrapTargetId,'owned-bootstrap');
  await assert.rejects(()=>authority.selectExistingTarget({targetId:'random'}),error=>error.code==='UNSUPPORTED_CHAT_PROVIDER');
  const opened=await authority.selectExistingTarget({targetId:'chat',providerId:'chatgpt'});
  assert.equal(opened.lifecycle,'provider_ready');
  assert.equal(opened.relay.running,false);
  assert.deepEqual(closedTargets,['owned-bootstrap'],'only the exact owned bootstrap target may be retired');
  assert.ok(targets.some(target=>target.targetId==='user-blank'),'a user-created blank target must remain untouched');
  assert.equal(selected.length,1);
  assert.ok(selected[0].provenance?.selectedAt);
  assert.ok(selected[0].provenance?.lastValidatedAt);
  assert.throws(()=>authority.browserTools._assertAllowedUrl('https://chatgpt.com/c/abc?query=ignored'),error=>error?.code==='BROWSER_PROTECTED_CONVERSATION','selected exact conversation must be mechanically denied to general browser tools');
  assert.equal(authority.browserTools._assertAllowedUrl('https://chatgpt.com/c/other'),'https://chatgpt.com/c/other','other ChatGPT conversations must not be overblocked by exact-conversation isolation');
  assert.equal(authority.browserTools._assertAllowedUrl('https://example.com/'),'https://example.com/','ordinary browser-tool URLs must remain available');
  const recoveryRead=authority.getRecovery({key:'journal-key',workspaceRoot:'caller-must-not-control'});
  assert.equal(recoveryRead.recovery.key,'journal-key');
  assert.equal(recoveryCalls[0].input.workspaceRoot,relay.getWorkspaceRoot());
  assert.equal(recoveryCalls[0].input.conversationId,channel.expectedUrlFor('chat'));
  const reconciled=authority.reconcileRecovery({key:'journal-key',disposition:'quarantined',reason:'Explicit operator decision.',operator:'test'});
  assert.equal(reconciled.receipt.receiptId,'receipt-r3');
  assert.equal(recoveryCalls[1].type,'reconcile');
  assert.equal(recoveryCalls[1].input.workspaceRoot,relay.getWorkspaceRoot());
  assert.equal(recoveryCalls[1].input.conversationId,channel.expectedUrlFor('chat'));

  let readinessProbeCalls=0;
  let readinessProbeMode='success';
  let providerState={agentReady:false,agentReadiness:{status:'unverified'}};
  global.__accessAgentRuntimeAdapter={
    providerStatus:()=>providerState,
    providerReadiness:async()=>{
      readinessProbeCalls+=1;
      if(readinessProbeMode==='throw')throw Object.assign(new Error('provider probe failed'),{code:'PROVIDER_PROBE_FAILED',classification:'PROVIDER'});
      if(readinessProbeMode==='success'){
        providerState={agentReady:true,agentReadiness:{status:'agent_ready'}};
        return{ok:true,agentReady:true};
      }
      return{ok:true,agentReady:false};
    },
  };

  const freshStarted=await authority.startRelay();
  assert.equal(freshStarted.relay.running,true,'fresh configured runtime should start after one successful capability probe');
  assert.equal(readinessProbeCalls,1,'fresh Browser Start must perform exactly one provider capability probe');
  assert.equal(relay.recoveryPreflights,1,'fresh readiness must be probed only after durable recovery preflight clears');
  assert.equal(selected.at(-1).targetId,'chat');
  assert.equal(selected.at(-1).providerId,'chatgpt');
  relay.stop();

  const cachedStarted=await authority.startRelay();
  assert.equal(cachedStarted.relay.running,true);
  assert.equal(readinessProbeCalls,1,'cached agent-ready state must not trigger another provider probe');
  assert.equal(relay.recoveryPreflights,1,'cached-ready Browser Start does not need recovery-only readiness preflight');
  relay.stop();

  providerState={agentReady:false,agentReadiness:{status:'unverified'}};
  readinessProbeMode='unverified';
  await assert.rejects(()=>authority.startRelay(),error=>error.code==='PROVIDER_CAPABILITY_UNVERIFIED');
  assert.equal(relay.running,false,'relay must remain stopped when the bounded provider probe does not establish agent readiness');
  assert.equal(readinessProbeCalls,2);
  assert.equal(relay.recoveryPreflights,2);

  const preflightRecovery=Object.assign(new Error('Durable recovery takes precedence over provider readiness.'),{code:'INSTRUCTION_RECOVERY_REQUIRED',classification:'TRANSPORT'});
  relay.recoveryPreflightError=preflightRecovery;
  readinessProbeMode='success';
  const callsBeforeRecovery=readinessProbeCalls;
  await assert.rejects(()=>authority.startRelay(),error=>error===preflightRecovery);
  assert.equal(relay.running,false);
  assert.equal(readinessProbeCalls,callsBeforeRecovery,'unresolved durable recovery must prevent provider contact');
  assert.equal(relay.recoveryPreflights,3);
  relay.recoveryPreflightError=null;

  providerState={agentReady:true,agentReadiness:{status:'agent_ready'}};
  targets.splice(targets.findIndex(target=>target.targetId==='chat'),1);
  await assert.rejects(()=>authority.startRelay(),/no longer available/u);
  assert.equal(relay.status().target,null);

  const failingRelay={
    running:false,target:{targetId:'stale',providerId:'chatgpt',url:'https://chatgpt.com/c/stale'},
    status(){return{running:this.running,target:this.target,lifecycle:'stopped',error:null};},
    stop(){this.running=false;},
    clearTarget(){this.running=false;this.target=null;},
  };
  const launchFailure=Object.assign(new Error('CDP unavailable'),{code:'CDP_UNAVAILABLE',classification:'BROWSER'});
  const failingChrome={
    status:()=>({lifecycle:'unavailable',endpoint:null,generation:9}),
    start:async()=>{throw launchFailure;},
  };
  const failingAuthority=new BrowserSessionAuthority({managedChrome:failingChrome,channel,relay:failingRelay});
  failingAuthority.targets=[{targetId:'stale'}];
  failingAuthority.createdTarget={targetId:'stale'};
  await assert.rejects(()=>failingAuthority.ensureBrowser(),error=>error===launchFailure);
  assert.equal(failingRelay.status().target,null,'browser-start failure must invalidate stale selected target identity');
  assert.equal(failingAuthority.targets.length,0,'browser-start failure must clear target cache');
  assert.equal(failingAuthority.createdTarget,null,'browser-start failure must clear created target identity');
  assert.equal(failingAuthority.status().lifecycle,'recovery');

  delete global.__accessAgentRuntimeAdapter;
  console.log('Browser session authority smoke PASS');
})().catch(error=>{delete global.__accessAgentRuntimeAdapter;console.error(error);process.exitCode=1;});
