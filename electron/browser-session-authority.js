'use strict';

const { emitDiagnostic } = require('../src/system/runtime-diagnostic-bus');
const { conversationIdFromUrl } = require('../src/system/runtime-correlation');
const { BrowserToolRuntime } = require('../src/browser/browser-tool-runtime');

class BrowserSessionAuthority {
  constructor({ managedChrome, generalManagedChrome = managedChrome, channel, relay, evidenceStore = null, allowHosts = null, denyHosts = null } = {}) {
    if (!managedChrome || !channel || !relay) throw new Error('Browser session authority requires managed Chrome, provider channel, and relay.');
    this.managedChrome=managedChrome;
    this.generalManagedChrome=generalManagedChrome;
    this.channel=channel;
    this.relay=relay;
    this.targets=[];
    this.createdTarget=null;
    this.epoch=0;
    this.state='stopped';
    this.error=null;
    this.browserTools=new BrowserToolRuntime({
      getEndpoint:async()=>{
        const browser=await this._ensureLiveGeneralBrowser();
        if(!browser?.endpoint){
          const error=new Error('Managed browser did not expose a CDP endpoint for general browser tools.');
          error.code='BROWSER_ENDPOINT_UNAVAILABLE';
          error.classification='BROWSER';
          throw error;
        }
        return browser.endpoint;
      },
      isProtectedUrl:url=>{
        const target=this.relay.status().target;
        const expected=target?.targetId?(this.channel.expectedUrlFor?.(target.targetId)||target.url||''):'';
        const expectedId=conversationIdFromUrl(expected);
        return Boolean(expectedId&&conversationIdFromUrl(url)===expectedId);
      },
      evidenceStore,
      allowHosts,
      denyHosts,
    });
    global.__accessAgentBrowserToolRuntime=this.browserTools;
    global.__accessAgentConversationRuntime={read:options=>this.readConversation(options)};
  }

  _diag(action,phase,data={},error=null){
    const target=data.target||this.relay.status().target||null;
    emitDiagnostic({
      source:'browser-authority',category:'browser',action,phase,severity:error?'error':'info',
      correlation:{
        conversationId:conversationIdFromUrl(target?.url),
        targetId:target?.targetId||null,
        browserInstanceId:this.managedChrome.status()?.generation?`chrome-${this.managedChrome.status().generation}`:null,
      },
      data:{epoch:this.epoch,...data},error,
    });
  }

  status(){
    return{
      lifecycle:this.state,
      browser:this.managedChrome.status(),
      generalBrowserBackend:this.generalManagedChrome.status(),
      targets:this.targets.map(target=>({...target})),
      createdTarget:this.createdTarget?{...this.createdTarget}:null,
      selectedTarget:this.relay.status().target,
      relay:this.relay.status(),
      generalBrowser:{ownedTargetCount:this.browserTools?.ownedTargets?.size||0,currentTargetId:this.browserTools?.currentTargetId||null},
      error:this.error,
    };
  }

  _providerRuntime(){
    const runtime=global.__accessAgentRuntimeAdapter;
    if(runtime)return runtime;
    const error=new Error('Provider runtime is unavailable.');
    error.code='PROVIDER_RUNTIME_UNAVAILABLE';
    error.classification='PROVIDER';
    throw error;
  }

  _assertAgentReady(){
    const provider=this._providerRuntime().providerStatus?.();
    if(provider?.agentReady===true&&provider?.agentReadiness?.status==='agent_ready')return provider;
    const error=new Error('Browser Loop cannot start until the active provider/model has passed the agent capability probe.');
    error.code='PROVIDER_CAPABILITY_UNVERIFIED';
    error.classification='PROVIDER';
    this._diag('provider_readiness_gate','failed',{provider},error);
    throw error;
  }

  async _probeAgentReadiness(){
    const runtime=this._providerRuntime();
    if(typeof runtime.providerReadiness!=='function'){
      const error=new Error('Provider runtime does not expose the agent capability probe.');
      error.code='PROVIDER_READINESS_UNAVAILABLE';
      error.classification='PROVIDER';
      this._diag('provider_readiness_probe','failed',{},error);
      throw error;
    }
    this._diag('provider_readiness_probe','start');
    try{
      const result=await runtime.providerReadiness();
      const provider=runtime.providerStatus?.()||null;
      this._diag('provider_readiness_probe',provider?.agentReady===true?'success':'failed',{result,provider});
      return result;
    }catch(error){
      this._diag('provider_readiness_probe','failed',{},error);
      throw error;
    }
  }

  _invalidateBrowserContinuity(reason,error=null){
    this.epoch+=1;
    this.targets=[];
    this.createdTarget=null;
    this.relay.clearTarget(reason);
    this.state='recovery';
    this.error=reason;
    this._diag('browser_continuity_invalidated','failed',{reason},error||new Error(reason));
  }

  async _ensureLiveBrowser(){
    const current=this.managedChrome.status();
    if(current.lifecycle==='ready'&&current.endpoint){
      // Cached 'ready + endpoint' does not prove a live CDP control channel.
      // Re-verify the exact endpoint before reuse, then invalidate and relaunch
      // when it is stale (e.g. the Chrome process died after the last probe).
      try{
        await this.managedChrome.readyEndpoint();
        return this.managedChrome.status();
      }catch(staleError){
        this._diag('ensure_browser','cached_endpoint_stale',{browser:current},staleError);
        await this.managedChrome.stop();
      }
    }
    return this.managedChrome.start();
  }

  async getLiveEndpoint(){
    // The single authority-managed source of a live CDP endpoint. Never returns
    // a cached endpoint without re-verifying it is reachable (and relaunching
    // the browser when it is not). Components performing browser work must
    // consume this instead of trusting ManagedChrome status directly.
    const browser=await this._ensureLiveBrowser();
    return browser?.endpoint ? String(browser.endpoint) : '';
  }

  async _ensureLiveGeneralBrowser(){
    const current=this.generalManagedChrome.status();
    if(current.lifecycle==='ready'&&current.endpoint){
      try{
        await this.generalManagedChrome.readyEndpoint();
        return this.generalManagedChrome.status();
      }catch(staleError){
        this._diag('ensure_general_browser','cached_endpoint_stale',{browser:current},staleError);
        await this.generalManagedChrome.stop();
      }
    }
    return this.generalManagedChrome.start();
  }

  async ensureBrowser(){
    const current=this.managedChrome.status();
    this._diag('ensure_browser','start',{browser:current});
    try{
      const browser=await this._ensureLiveBrowser();
      if(!browser.endpoint||browser.lifecycle!=='ready')throw new Error('Managed Chrome did not become ready.');
      if(!browser.bootstrapTargetId&&browser.bootstrapUrl&&typeof this.managedChrome.claimBootstrapTarget==='function'){
        const targets=await this.channel.listTabs(browser.endpoint);
        this.managedChrome.claimBootstrapTarget(targets);
      }
      this._diag('ensure_browser','success',{browser:this.managedChrome.status()});
      return browser;
    }catch(error){
      this._invalidateBrowserContinuity(`Managed browser startup failed: ${error?.message||String(error)}`,error);
      this._diag('ensure_browser','failed',{},error);
      throw error;
    }
  }

  async _retireBootstrapTarget(endpoint,retainedTargetId){
    const browser=this.managedChrome.status();
    const bootstrapTargetId=String(browser.bootstrapTargetId||'');
    if(!bootstrapTargetId)return{retired:false,reason:'not_owned'};
    if(bootstrapTargetId===String(retainedTargetId||'')){
      this.managedChrome.releaseBootstrapTarget(bootstrapTargetId);
      return{retired:false,reused:true,targetId:bootstrapTargetId};
    }
    if(typeof this.channel.closeTarget!=='function')throw new Error('Provider channel cannot retire the exact owned bootstrap target.');
    await this.channel.closeTarget(endpoint,bootstrapTargetId);
    this.managedChrome.releaseBootstrapTarget(bootstrapTargetId);
    this._diag('bootstrap_target_retired','success',{targetId:bootstrapTargetId,retainedTargetId});
    return{retired:true,targetId:bootstrapTargetId};
  }

  async refreshTargets(endpoint){
    this._diag('refresh_targets','start',{endpoint});
    try{
      this.targets=await this.channel.listTabs(endpoint);
      this._diag('refresh_targets','success',{endpoint,count:this.targets.length,targets:this.targets.map(t=>({targetId:t.targetId,title:t.title,url:t.url,providerId:t.providerId,supported:t.supported!==false}))});
      return this.targets;
    }catch(error){this._diag('refresh_targets','failed',{endpoint},error);throw error;}
  }

  async _validatedTarget(endpoint,target){
    if(!target?.providerId||target.supported===false){
      const error=new Error('Selected page does not have a supported chat adapter.');
      error.code='UNSUPPORTED_CHAT_PROVIDER';
      error.classification='USER_SETUP';
      throw error;
    }
    const inspected=await this.channel.inspectTarget(endpoint,target.targetId,target.providerId);
    const expected=this.channel.expectedUrlFor?.(target.targetId)||target.url||'';
    if(!this.channel.expectedUrlFor?.(target.targetId)&&expected&&this.channel.targetUrls?.set){
      this.channel.targetUrls.set(String(target.targetId),String(expected));
    }
    const provenance=this.channel.targetProvenance?.(target.targetId)||inspected.targetProvenance||inspected.provenance||null;
    return{
      ...target,
      title:String(inspected.title||target.title||''),
      url:String(inspected.url||target.url||''),
      provenance,
    };
  }

  async readConversation({limit=20}={}){
    const browser=await this.ensureBrowser();
    const target=this.relay.status().target;
    if(!target?.targetId||!target?.providerId){
      const error=new Error('No Browser Loop conversation is selected. Select the exact supported chat target before requesting conversation context.');
      error.code='CONVERSATION_TARGET_UNAVAILABLE';
      error.classification='TARGET';
      throw error;
    }
    if(typeof this.channel.readConversation!=='function'){
      const error=new Error('The active provider adapter does not expose read-only conversation context.');
      error.code='CONVERSATION_READER_UNAVAILABLE';
      error.classification='BROWSER';
      throw error;
    }
    const result=await this.channel.readConversation(browser.endpoint,target.targetId,target.providerId,{limit});
    this._diag('read_conversation','success',{target,count:Array.isArray(result?.messages)?result.messages.length:0});
    return result;
  }

  async openBrowser(){await this.ensureBrowser();this.state='browser_ready';this.error=null;this._diag('open_browser','success');return this.status();}

  async listProviderTabs(){
    const browser=await this.ensureBrowser();
    const targets=await this.refreshTargets(browser.endpoint);
    const selected=this.relay.status().target;
    if(selected&&!targets.some(target=>target.targetId===selected.targetId&&target.providerId===selected.providerId)){
      this.relay.clearTarget('Selected provider tab disappeared. Select a currently available supported chat tab.');
      this.state='recovery';this.error='Selected provider tab disappeared.';
      this._diag('selected_target_lost','failed',{target:selected},new Error(this.error));
    }
    return targets;
  }

  async selectExistingTarget(input){
    const browser=await this.ensureBrowser();
    const targetId=String(typeof input==='object'?input?.targetId||'':input||'');
    const providerId=String(typeof input==='object'?input?.providerId||'':'');
    const target=(await this.refreshTargets(browser.endpoint)).find(item=>item.targetId===targetId&&(!providerId||item.providerId===providerId));
    if(!target){const error=new Error('Selected provider tab is no longer available. Refresh provider tabs and choose one explicitly.');this._diag('select_target','failed',{targetId,providerId},error);throw error;}
    const active=this.relay.status();
    if(active.running){
      if(active.target?.targetId===target.targetId&&active.target?.providerId===target.providerId)return this.status();
      const error=new Error('Stop the browser relay before changing to a different provider tab.');this._diag('select_target','failed',{target},error);throw error;
    }
    let validated;
    try{validated=await this._validatedTarget(browser.endpoint,target);}catch(error){this._diag('select_target','failed',{target},error);throw error;}
    this.relay.selectTarget(validated);
    await this._retireBootstrapTarget(browser.endpoint,validated.targetId);
    this.state='provider_ready';this.error=null;
    this._diag('select_target','success',{target:validated});
    return this.status();
  }

  async startRelay(){
    let readinessError=null;
    try{this._assertAgentReady();}catch(error){readinessError=error;}
    const browser=await this.ensureBrowser();
    const selected=this.relay.status().target;
    if(!selected){const error=new Error('Choose a supported chat target before starting the browser relay.');this._diag('start_relay','failed',{},error);throw error;}
    const listed=(await this.refreshTargets(browser.endpoint)).find(item=>item.targetId===selected.targetId&&item.providerId===selected.providerId);
    if(!listed){
      this.relay.clearTarget('Selected provider tab is no longer available. Refresh provider tabs and choose one explicitly.');
      this.state='recovery';this.error='Selected provider tab is no longer available.';
      const error=new Error(this.error);this._diag('start_relay','failed',{target:selected},error);throw error;
    }
    let target;
    try{target=await this._validatedTarget(browser.endpoint,{...listed,url:selected.url||listed.url});}
    catch(error){this.state='recovery';this.error=error.message;this._diag('start_relay','failed',{target:selected},error);throw error;}
    this.relay.selectTarget(target);
    this._diag('start_relay','start',{target});
    if(readinessError){
      try{await this.relay.start({recoveryOnly:true});}
      catch(error){this.state='recovery';this.error=error?.message||String(error);this._diag('start_relay','failed',{target,recoveryPreflight:true},error);throw error;}
      await this._probeAgentReadiness();
      this._assertAgentReady();
    }
    try{
      const relay=await this.relay.start();
      this.state=relay.running?'connected':relay.lifecycle==='recovery'?'recovery':'degraded';
      this.error=relay.running?null:relay.error||'Relay did not start.';
      this._diag('start_relay',relay.running?'success':'failed',{target,relay},relay.running?null:new Error(this.error));
      return this.status();
    }catch(error){
      this.state='recovery';
      this.error=error?.message||String(error);
      this._diag('start_relay','failed',{target},error);
      throw error;
    }
  }

  async checkOnce(){
    await this.ensureBrowser();this._diag('check_once','start');
    try{
      const result=await this.relay.checkOnce();
      this.state=this.relay.status().running?'connected':'provider_ready';this.error=null;
      this._diag('check_once','success',{result});return{...this.status(),check:result};
    }catch(error){this._diag('check_once','failed',{},error);throw error;}
  }

_recoveryScope() {
const target=this.relay.status().target;
if(!target?.targetId)throw recoveryAuthorityError('RECOVERY_TARGET_REQUIRED','Select the exact provider conversation before reading or reconciling durable recovery.');
const journal=this.relay.journal;
if(!journal||typeof journal.getRecovery!=='function'||typeof journal.reconcileRecovery!=='function') {
throw recoveryAuthorityError('RECOVERY_JOURNAL_UNAVAILABLE','The active browser relay has no durable recovery authority.');
}
return {
journal,
workspaceRoot:String(this.relay.getWorkspaceRoot?.() || ''),
conversationId:String(this.channel.expectedUrlFor?.(target.targetId) || target.url || ''),
target,
};
}

getRecovery(input={}) {
const scope=this._recoveryScope();
const recovery=scope.journal.getRecovery({
key:String(input.key || ''),
workspaceRoot:scope.workspaceRoot,
conversationId:scope.conversationId,
});
return {recovery,target:{...scope.target}};
}

reconcileRecovery(input={}) {
if(this.relay.status().running)throw recoveryAuthorityError('RECOVERY_RELAY_MUST_BE_STOPPED','Stop the Browser Loop before reconciling durable recovery.');
const scope=this._recoveryScope();
const receipt=scope.journal.reconcileRecovery({
key:String(input.key || ''),
workspaceRoot:scope.workspaceRoot,
conversationId:scope.conversationId,
disposition:input.disposition,
reason:input.reason,
operator:input.operator,
evidenceRefs:input.evidenceRefs,
});
const recovery=scope.journal.getRecovery({key:receipt.instructionKey,workspaceRoot:scope.workspaceRoot,conversationId:scope.conversationId});
this.state='provider_ready';this.error=null;
this._diag('reconcile_recovery','success',{target:scope.target,instructionId:receipt.instructionId,receiptId:receipt.receiptId,disposition:receipt.disposition});
return {receipt,recovery,target:{...scope.target}};
}

  stopRelay(){this.relay.stop();this.state=this.relay.status().target?'provider_ready':'stopped';this.error=null;this._diag('stop_relay','success');return this.status();}

  stop(){
    this.epoch+=1;this.createdTarget=null;this.targets=[];this.relay.clearTarget('Browser session stopped.');
    // FIX #P2: Introduce 'stopping' intermediate state so observable state
    // reflects the in-progress Chrome termination rather than prematurely
    // reporting 'stopped' while the process is still alive.
    this.state='stopping';this.error=null;this._diag('stop_browser','start');
    return this.managedChrome.stop().then(async result=>{
      if(this.generalManagedChrome!==this.managedChrome) await this.generalManagedChrome.stop();
      this.state='stopped';
      this._diag('stop_browser','success',{browser:result,generalBrowser:this.generalManagedChrome.status()});
      return result;
    },error=>{
      // Even on failure, transition to 'stopped' — the authority considers
      // itself stopped regardless; the OS will reclaim the process.
      this.state='stopped';
      this._diag('stop_browser','failed',{},error);throw error;
    });
  }
}
function recoveryAuthorityError(code,message){
 const error=new Error(message);
 error.code=code;
 error.classification='TRANSPORT';
 return error;
}

module.exports={BrowserSessionAuthority};
