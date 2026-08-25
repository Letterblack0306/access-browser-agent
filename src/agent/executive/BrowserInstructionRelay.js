'use strict';

const { createHash } = require('node:crypto');

const START='=== ACCESS AGENT INSTRUCTION START ===';
const END='=== ACCESS AGENT INSTRUCTION END ===';
const RETRYABLE_DELIVERY_CODES=new Set([
  'COMPOSER_NOT_FOUND','PROVIDER_GENERATING','SEND_BUTTON_UNAVAILABLE','TARGET_TEMPORARILY_UNAVAILABLE',
]);
// Pre-submit CDP transport failures (endpoint unreachable because the browser
// died) mean the message was never sent. They are clearly transient, so a queued
// terminal result must be retained as `result_queued` and retried once the
// browser authority recovers, rather than failing closed as an ambiguous delivery.
const RETRYABLE_TRANSPORT_CODES=new Set([
  'ECONNREFUSED','ECONNRESET','EPIPE','ECONNABORTED','ETIMEDOUT',
  'ERR_EMPTY_RESPONSE','ERR_SOCKET_CLOSED','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT',
]);
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const ENVELOPE_GLOBAL=new RegExp(`${escape(START)}([\\s\\S]*?)${escape(END)}`,'gu');

function getField(body,name) {
  return String(new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`,'imu').exec(body)?.[1] || '').trim();
}

function buildQuickCommandEnvelope(match,workspaceRoot,occurrence) {
  const body=String(match?.[1] || '').trim();
  if (!body) return null;
  const version=getField(body,'VERSION');
  if (version && version !== '1') return null;
  if (getField(body,'TYPE').toLowerCase() !== 'quick_command') return null;
  const workspace=getField(body,'WORKSPACE');
  if (workspace && String(workspaceRoot || '').trim() && workspace.toLowerCase() !== String(workspaceRoot).trim().toLowerCase()) return null;
  const rawInstructionId=getField(body,'INSTRUCTION ID');
  const instructionId=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(rawInstructionId) ? rawInstructionId : null;
  const command=getField(body,'COMMAND');
  if (!command || command.length > 4000) return null;
  const transportKey=instructionId ? `quick-command:${instructionId}` : `quick-command:${occurrence}:${hash(body)}`;
  return {
    instructionId:instructionId || `quick-${hash(transportKey).slice(0,16)}`,
    workspace:workspace || null,
    type:'quick_command',
    command,
    objective:'',
    raw:match[0],
    transportKey,
    occurrence,
  };
}

function parseQuickCommandEnvelope(text,workspaceRoot) {
  const source=String(text || '');
  ENVELOPE_GLOBAL.lastIndex=0;
  let match=ENVELOPE_GLOBAL.exec(source);
  let latestValid=null;
  let occurrence=0;
  while (match) {
    occurrence+=1;
    const parsed=buildQuickCommandEnvelope(match,workspaceRoot,occurrence);
    if (parsed) latestValid=parsed;
    match=ENVELOPE_GLOBAL.exec(source);
  }
  ENVELOPE_GLOBAL.lastIndex=0;
  return latestValid;
}

function assistantTurnFromSnapshot(snapshot) {
  const objective=String(snapshot?.text || '').trim();
  if (!objective || objective.length > 16000) return null;
  if (snapshot?.provenance?.verifiedAssistant === false) return null;
  const messageId=String(snapshot?.provenance?.messageId || '').trim();
  const messageIndex=Number.isInteger(snapshot?.provenance?.messageIndex) ? snapshot.provenance.messageIndex : -1;
  const identity=messageId ? `message:${messageId}` : `assistant-index:${messageIndex}`;
  const transportKey=`assistant-turn:${identity}:${hash(objective)}`;
  return {
    instructionId:`turn-${hash(transportKey).slice(0,16)}`,
    workspace:null,
    type:'agent_instruction',
    command:null,
    objective,
    raw:objective,
    transportKey,
    occurrence:messageIndex >= 0 ? messageIndex : null,
  };
}

function parseTransportTurn(snapshot,workspaceRoot) {
  const quick=parseQuickCommandEnvelope(snapshot?.text,workspaceRoot);
  return quick || assistantTurnFromSnapshot(snapshot);
}

function resultEnvelope({instructionId,result,record=null}={}) {
  const terminal=String(result?.terminalState || '').toLowerCase();
  const summary=String(result?.summary || result?.text || result?.error || '').trim().slice(0,1800);
  const evidence=Array.isArray(result?.evidence) ? result.evidence : [];
  const complete=result?.ok === true && terminal === 'completed' && Boolean(summary || evidence.length);
  const status=terminal === 'completed' ? (complete ? 'COMPLETE' : 'FAILED') : terminal === 'waiting_for_input' || terminal === 'waiting_for_user' || terminal === 'waiting_for_dependency' ? 'WAITING' : terminal === 'blocked' ? 'BLOCKED' : terminal === 'timed_out' ? 'TIMED_OUT' : terminal === 'stopped' ? 'STOPPED' : terminal === 'cancelled' ? 'CANCELLED' : 'FAILED';
  const report=summary || 'Runtime returned no summary or runtime evidence; completion was rejected.';
  const compactEvidence=evidence.slice(0,8).map(item=>`- ${String(typeof item === 'string' ? item : JSON.stringify(item)).slice(0,280)}`);
  const nextState=String(result?.terminalState || (complete ? 'waiting_for_browser' : 'failed'));
  return [
    '=== ACCESS AGENT RESULT START ===',
    `INSTRUCTION ID: ${instructionId}`,
    `STATUS: ${status}`,
    'MODEL REPORT:',
    report,
    '',
    'RUNTIME EVIDENCE:',
    ...(compactEvidence.length ? compactEvidence : ['- No runtime execution evidence returned.']),
    record ? `RESULT RECORD SHA256: ${record.sha256}` : null,
    record ? `LOCAL RECORD: ${record.relativePath}` : null,
    `NEXT STATE: ${nextState}`,
    '=== ACCESS AGENT RESULT END ===',
  ].filter(Boolean).join('\n');
}

function quickCommandResultEnvelope({instructionId,result,record=null}={}) {
  const complete=result?.ok === true && Number(result?.exitCode) === 0;
  return [
    '=== ACCESS AGENT QUICK COMMAND RESULT START ===',
    `INSTRUCTION ID: ${instructionId}`,
    `STATUS: ${complete ? 'COMPLETE' : 'FAILED'}`,
    `COMMAND: ${String(result?.command || '')}`,
    `CWD: ${String(result?.cwd || '')}`,
    `EXIT CODE: ${result?.exitCode === null || result?.exitCode === undefined ? 'NONE' : result.exitCode}`,
    'STDOUT:', String(result?.stdout || '').slice(-12000),
    'STDERR:', String(result?.stderr || '').slice(-12000),
    result?.error ? `ERROR: ${String(result.error).slice(0,2000)}` : null,
    result?.receipt?.id || result?.receipt?.hash ? `TERMINAL RECEIPT: ${String(result.receipt.id || result.receipt.hash)}` : null,
    record ? `RESULT RECORD SHA256: ${record.sha256}` : null,
    record ? `LOCAL RECORD: ${record.relativePath}` : null,
    '=== ACCESS AGENT QUICK COMMAND RESULT END ===',
  ].filter(value=>value !== null && value !== undefined).join('\n');
}

function nowIso(){return new Date().toISOString();}
function hash(value){return createHash('sha256').update(String(value || '')).digest('hex');}
function deliveryError(error){return{code:String(error?.code||error?.cause?.code||'DELIVERY_FAILED'),message:error?.message||String(error)};}
function isTransientTransportError(error){return RETRYABLE_TRANSPORT_CODES.has(String(error?.cause?.code||error?.code||'').toUpperCase());}
// Non-side-effecting execution faults: the transport could not reach the
// provider (nothing delivered) or the provider itself timed out/errored before
// returning a result. These degrade per-instruction (the session keeps running)
// rather than halting the whole relay. True ambiguous-boundary faults (a result
// may have entered the conversation) are intentionally NOT in this set and keep
// the operator-gated recovery path.
function isTransientExecutionFault(error){
  const code=String(error?.code||error?.cause?.code||'').toUpperCase();
  return RETRYABLE_TRANSPORT_CODES.has(code)||code==='PROVIDER_TIMEOUT'||code==='INSTRUCTION_EXECUTION_TIMEOUT';
}
function isSafeConsumedBaseline(record){
  return record?.state==='consumed' && ['delivery_response','first_start_historical_baseline','known_historical_baseline'].includes(String(record?.disposition||''));
}
function assertSnapshotTarget(snapshot,target){
  if(!snapshot||String(snapshot.targetId||'')!==String(target.targetId)||String(snapshot.providerId||'')!==String(target.providerId)){
    const error=new Error('Selected provider tab is unavailable or no longer matches the relay target.');
    error.code='TARGET_UNAVAILABLE';
    throw error;
  }
  if(String(snapshot.text || '').trim() && snapshot.provenance?.verifiedAssistant !== true){
    const error=new Error('An assistant turn was present without verified assistant-message provenance.');
    error.code='ASSISTANT_PROVENANCE_UNVERIFIED';
    throw error;
  }
}

class MemoryJournal {
  constructor(){this.records=new Map();this.loop=new Map();}
  key(input){return hash(JSON.stringify({workspaceRoot:input.workspaceRoot||'',conversationId:input.conversationId||'',transportKey:input.transportKey||'',raw:hash(input.raw||'')}));}
  scope(input){return hash(JSON.stringify({workspaceRoot:input.workspaceRoot||'',conversationId:input.conversationId||''}));}
  get(input){return this.records.get(this.key(input))||null;}
  observe(input){const key=this.key(input);const record=this.records.get(key)||{key,state:'observed',instructionId:input.instructionId};this.records.set(key,record);return record;}
  _transition(input,state,extra={}){const record={...(this.get(input)||this.observe(input)),...extra,state,targetId:input.targetId||this.get(input)?.targetId||''};this.records.set(this.key(input),record);return record;}
  markExecuting(input,extra={}){return this._transition(input,'executing',extra);}
  markResultQueued(input,extra={}){return this._transition(input,'result_queued',extra);}
  markDelivering(input,extra={}){return this._transition(input,'delivering',extra);}
  markDelivered(input,extra={}){return this._transition(input,'delivered',extra);}
  markDeliveryUnverified(input,extra={}){return this._transition(input,'delivery_unverified',extra);}
  markDeliveryFailed(input,extra={}){return this._transition(input,'delivery_failed',extra);}
  markConsumed(input,extra={}){return this._transition(input,'consumed',extra);}
  markFailed(input,extra={}){return this._transition(input,'failed',extra);}
  getLoopState(input){return this.loop.get(this.scope(input))||null;}
  markLoopStarted(input,extra={}){const record={state:'running',...extra};this.loop.set(this.scope(input),record);return record;}
  markLoopProgress(input,extra={}){const current=this.getLoopState(input)||{};const record={...current,...extra,state:'running'};this.loop.set(this.scope(input),record);return record;}
  markLoopStopped(input,extra={}){const record={...this.getLoopState(input),...extra,state:'stopped'};this.loop.set(this.scope(input),record);return record;}
}

class BrowserInstructionRelay {
  constructor({
    channel,getEndpoint,getWorkspaceRoot,submitInstruction,executeQuickCommand,storeResult,onEvent,journal,
    pollIntervalMs=1500,deliveryRetryMs=750,deliveryMaxAttempts=5,deliveryMaxElapsedMs=30000,instructionMaxMs=0,
  }={}) {
    if(!channel||typeof channel.snapshot!=='function'||typeof channel.send!=='function')throw new Error('Browser relay requires a provider channel.');
    if(typeof getEndpoint!=='function'||typeof submitInstruction!=='function')throw new Error('Browser relay requires endpoint and instruction handlers.');
    this.channel=channel;this.getEndpoint=getEndpoint;this.getWorkspaceRoot=getWorkspaceRoot||(()=> '');
    this.submitInstruction=submitInstruction;this.executeQuickCommand=typeof executeQuickCommand==='function'?executeQuickCommand:null;
    this.storeResult=typeof storeResult==='function'?storeResult:null;this.onEvent=typeof onEvent==='function'?onEvent:()=>{};
    this.journal=journal||new MemoryJournal();
    this.pollIntervalMs=Math.min(2000,Math.max(1500,Number(pollIntervalMs)||1500));
    this.deliveryRetryMs=Math.max(100,Number(deliveryRetryMs)||750);this.deliveryMaxAttempts=Math.max(1,Number(deliveryMaxAttempts)||5);this.deliveryMaxElapsedMs=Math.max(1000,Number(deliveryMaxElapsedMs)||30000);this.instructionMaxMs=Math.max(0,Number(instructionMaxMs)||0);
    this.target=null;this.activeTarget=null;this.running=false;this.lifecycle='stopped';this.checking=false;this.generation=0;this.lastHash='';this.pending=null;this.timer=null;this.error=null;this.delivery=this._blankDelivery();this.loopScope=null;
  }

  _blankDelivery(){return{state:'idle',instructionId:null,attempts:0,maxAttempts:this?.deliveryMaxAttempts||5,queuedAt:null,lastAttemptAt:null,acceptedAt:null,error:null};}
  _conversationId(target){return String(this.channel.expectedUrlFor?.(target?.targetId)||target?.url||'');}
  _journalInput(instruction,target){return{workspaceRoot:this.getWorkspaceRoot(),conversationId:this._conversationId(target),targetId:target?.targetId||'',instructionId:instruction?.instructionId||'',transportKey:instruction?.transportKey||'',raw:instruction?.raw||''};}
_recoveryError(instruction,target,record){
const state=String(record?.state || 'unknown');
const recovery=record?.key && typeof this.journal.getRecovery==='function'
? this.journal.getRecovery({key:record.key,workspaceRoot:this.getWorkspaceRoot(),conversationId:this._conversationId(target)})
: null;
 const error=new Error('Assistant turn '+instruction.instructionId+' is in durable state '+state+'. Automatic re-execution or re-delivery is blocked because the previous side-effect boundary is ambiguous.');
error.code='INSTRUCTION_RECOVERY_REQUIRED';error.classification='TRANSPORT';
this.lifecycle='recovery';this.error=error.message;
this._event('browser_relay.instruction_recovery_required',{status:'blocked',instructionId:instruction.instructionId,targetId:target.targetId,providerId:target.providerId,detail:error.message,journalKey:record?.key||null,journalState:state,recovery});
return error;
}
  _deliveryResponseRecoveryError(target,ownership){
    const error=new Error(`Result delivery for assistant turn ${ownership?.sourceInstructionId||'unknown'} has unresolved provider-response ownership. Automatic execution is blocked until the response boundary is reconciled.`);
    error.code='DELIVERY_RESPONSE_RECOVERY_REQUIRED';error.classification='TRANSPORT';
    this.lifecycle='recovery';this.error=error.message;
    this._event('browser_relay.delivery_response_recovery_required',{status:'blocked',instructionId:ownership?.sourceInstructionId||null,targetId:target?.targetId||null,providerId:target?.providerId||null,detail:error.message,deliveryResponse:ownership||null});
    return error;
  }

  selectTarget(target){
    if(this.running)throw new Error('Stop the browser relay before changing its selected provider tab.');
    if(!target?.targetId||!target?.providerId)throw new Error('Choose a supported provider tab first.');
    this.target={targetId:String(target.targetId),providerId:String(target.providerId),provider:String(target.provider||''),title:String(target.title||''),url:String(target.url||''),type:String(target.type||'page'),provenance:target.provenance||null};
    this.error=null;this.delivery=this._blankDelivery();return this.status();
  }

  clearTarget(reason='Selected provider tab is no longer available.'){
    this.stop();this.target=null;this.activeTarget=null;this.pending=null;this.lifecycle='unavailable';this.error=reason;this._event('browser_relay.target_lost',{status:'failed',detail:reason});return this.status();
  }

  status(){return{lifecycle:this.lifecycle,running:this.running,checking:this.checking,generation:this.generation,target:this.target?{...this.target}:null,activeTarget:this.activeTarget?{...this.activeTarget}:null,pendingResult:Boolean(this.pending),lastInstructionHash:this.lastHash||null,delivery:{...this.delivery},error:this.error};}

 async start({recoveryOnly=false}={}){
    if(this.running)return{ok:true,...this.status(),alreadyRunning:true};
    if(!this.target)throw new Error('Choose a supported provider tab before starting the browser relay.');
    const endpoint=await this.getEndpoint();if(!endpoint)throw new Error('Managed Chrome has no discovered CDP endpoint yet. Relaunch it and try again.');
    this.lifecycle='attaching';
    try{
      const snapshot=await this.channel.snapshot(endpoint,this.target.targetId,this.target.providerId);assertSnapshotTarget(snapshot,this.target);
      const conversationId=this._conversationId(this.target)||String(snapshot.url||this.target.url||'');
      this.loopScope={workspaceRoot:this.getWorkspaceRoot(),conversationId,targetId:this.target.targetId};
      const previousLoop=this.journal.getLoopState(this.loopScope);
      if(previousLoop?.deliveryResponse?.state==='pending')throw this._deliveryResponseRecoveryError(this.target,previousLoop.deliveryResponse);
      const scopeRecoveries=typeof this.journal.listUnresolvedRecoveries==='function'
        ? this.journal.listUnresolvedRecoveries({workspaceRoot:this.getWorkspaceRoot(),conversationId})
        : [];
      if(scopeRecoveries.length){
        const blocked=scopeRecoveries[0];
        throw this._recoveryError({instructionId:String(blocked.record?.instructionId||'unknown')},this.target,blocked.record);
      }
      const existing=parseTransportTurn(snapshot,this.getWorkspaceRoot());
      let restoredPending=null;
      if(existing){
        const digest=hash(existing.transportKey);
        const input=this._journalInput(existing,this.target);
        const record=this.journal.get(input);
if(recoveryOnly){
if(['executing','failed','delivering','delivery_unverified','delivery_failed','consumed'].includes(record?.state)){
const recovery=record?.key && typeof this.journal.getRecovery==='function'
? this.journal.getRecovery({key:record.key,workspaceRoot:this.getWorkspaceRoot(),conversationId})
: null;
if(!recovery?.reconciliation)throw this._recoveryError(existing,this.target,record);
}
this.lifecycle='checking_provider';this.error=null;
return{ok:true,recoveryRequired:false,...this.status()};
}
        if(record?.state==='delivered'||isSafeConsumedBaseline(record))this.lastHash=digest;
        else if(record?.state==='result_queued'&&record?.payload){
          this.lastHash=digest;
          restoredPending={
            payload:String(record.payload),instructionId:existing.instructionId,sessionId:record.sessionId||null,
            targetId:this.target.targetId,providerId:this.target.providerId,endpoint,
            generation:0,attempts:Number(record.deliveryAttempts)||0,queuedAtMs:Number(record.queuedAtMs)||Date.now(),nextAttemptAt:0,journalInput:input,
            resultRecordSha256:record.resultRecordSha256||null,
          };
}else if(['executing','failed','delivering','delivery_unverified','delivery_failed','consumed'].includes(record?.state)){
const recovery=record?.key && typeof this.journal.getRecovery==='function'
? this.journal.getRecovery({key:record.key,workspaceRoot:this.getWorkspaceRoot(),conversationId})
: null;
if(recovery?.reconciliation)this.lastHash=digest;
else throw this._recoveryError(existing,this.target,record);
        }else if(!record){
          if(!previousLoop){
            this.journal.observe(input);this.journal.markConsumed(input,{disposition:'first_start_historical_baseline'});this.lastHash=digest;
          }else if(previousLoop.lastInstructionHash&&previousLoop.lastInstructionHash===digest){
            this.journal.observe(input);this.journal.markConsumed(input,{disposition:'known_historical_baseline'});this.lastHash=digest;
          }
        }
      }
 if(recoveryOnly){this.lifecycle='checking_provider';this.error=null;return{ok:true,recoveryRequired:false,...this.status()};}
      this.generation+=1;this.activeTarget={...this.target};this.running=true;this.error=null;
      if(restoredPending){
        restoredPending.generation=this.generation;this.pending=restoredPending;this.lifecycle='result_queued';
        this.delivery={state:'queued',instructionId:restoredPending.instructionId,attempts:restoredPending.attempts,maxAttempts:this.deliveryMaxAttempts,queuedAt:nowIso(),lastAttemptAt:null,acceptedAt:null,error:null};
      }else{this.pending=null;this.lifecycle='waiting_for_instruction';this.delivery=this._blankDelivery();}
      this.journal.markLoopStarted(this.loopScope,{baselineInstructionId:existing?.instructionId||null,lastInstructionHash:this.lastHash||previousLoop?.lastInstructionHash||null,deliveryResponse:previousLoop?.deliveryResponse||null});
      this._event('browser_relay.started',{status:this.pending?'result_queued':'waiting_for_browser',targetId:this.activeTarget.targetId,providerId:this.activeTarget.providerId,detail:this.pending?'Recovered a durable queued result; local execution will not repeat.':'Waiting for a new assistant-authored turn.'});
      this._schedule(0);return{ok:true,...this.status()};
    }catch(error){if(this.lifecycle!=='recovery')this.lifecycle='degraded';this.error=error?.message||String(error);this._event('browser_relay.failed',{status:'failed',targetId:this.target?.targetId||null,providerId:this.target?.providerId||null,detail:this.error,code:error?.code||null});throw error;}
  }

  stop(){
    if(this.loopScope)this.journal.markLoopStopped(this.loopScope,{reason:'explicit_stop',lastInstructionHash:this.lastHash||null});
    if(!this.running){this.lifecycle=this.lifecycle==='unavailable'?this.lifecycle:'stopped';return{ok:true,...this.status(),alreadyStopped:true};}
    this.lifecycle='stopping';this.generation+=1;this.running=false;this.checking=false;if(this.timer)clearTimeout(this.timer);this.timer=null;const deferred=this.pending;this.pending=null;this.activeTarget=null;
    if(deferred)this._event('browser_relay.result_discarded',{status:'stopped',instructionId:deferred.instructionId,detail:'Relay stopped with a durable queued result. It may be restored on the next clean start without repeating local execution.'});
    this.delivery=deferred?{...this.delivery,state:'deferred',error:{code:'RELAY_STOPPED',message:'Relay stopped before queued result delivery; durable queue retained.'}}:this._blankDelivery();this.lifecycle='stopped';this._event('browser_relay.stopped',{status:'stopped'});return{ok:true,...this.status()};
  }

  async checkOnce(){
    if(this.running){await this._tick({schedule:false});return{ok:true,...this.status()};}
    if(!this.target)throw new Error('Choose a supported provider tab before checking the browser relay.');
    const endpoint=await this.getEndpoint();if(!endpoint)throw new Error('Managed Chrome has no discovered CDP endpoint.');
    const snapshot=await this.channel.snapshot(endpoint,this.target.targetId,this.target.providerId);assertSnapshotTarget(snapshot,this.target);
    const instruction=parseTransportTurn(snapshot,this.getWorkspaceRoot());
    const journalRecord=instruction?this.journal.get(this._journalInput(instruction,this.target)):null;
    return{ok:true,target:{...this.target,title:String(snapshot.title||this.target.title||''),url:String(snapshot.url||this.target.url||''),provenance:snapshot.targetProvenance||snapshot.provenance||null},generating:snapshot.generating===true,hasTurn:Boolean(instruction),hasInstruction:Boolean(instruction),turnType:instruction?.type||null,instructionState:journalRecord?.state||null,assistantProvenance:snapshot.provenance||null};
  }

  _schedule(delay=this.pollIntervalMs){if(!this.running)return;if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>this._tick(),delay);}

  async _deliverPending({endpoint,target,generation}){
    const pending=this.pending;if(!pending||pending.generation!==generation)return;const now=Date.now();if(pending.nextAttemptAt&&now<pending.nextAttemptAt)return;pending.attempts+=1;this.lifecycle='delivering';this.delivery={...this.delivery,state:'delivering',instructionId:pending.instructionId,attempts:pending.attempts,lastAttemptAt:nowIso(),error:null};
    if(pending.journalInput)this.journal.markDelivering(pending.journalInput,{payload:pending.payload,deliveryAttempts:pending.attempts,queuedAtMs:pending.queuedAtMs});
    this._event('browser_relay.delivery_attempt',{status:'delivering',instructionId:pending.instructionId,attempt:pending.attempts,targetId:target.targetId,providerId:target.providerId});
    try{
      const delivery=await this.channel.send(endpoint,target.targetId,target.providerId,pending.payload,{configuredChatUrl:this._conversationId(target)});
      if(generation!==this.generation||!this.running||this.pending!==pending)return;
      if(pending.journalInput)this.journal.markDelivered(pending.journalInput,{deliveryAttempts:pending.attempts,evidenceLevel:delivery?.evidenceLevel||null});
      const submittedAt=nowIso();
      if(this.loopScope)this.journal.markLoopProgress(this.loopScope,{lastInstructionHash:this.lastHash||null,lastInstructionId:pending.instructionId,deliveryResponse:{state:'pending',sourceInstructionId:pending.instructionId,sourceTransportKey:pending.journalInput?.transportKey||null,resultRecordSha256:pending.resultRecordSha256||null,submittedAt}});
      this.pending=null;this.lifecycle='waiting_for_instruction';this.error=null;this.delivery={...this.delivery,state:'accepted',acceptedAt:submittedAt,error:null};this._event('browser_relay.result_sent',{status:'waiting_for_browser',instructionId:pending.instructionId,targetId:target.targetId,providerId:target.providerId,delivery});
    }catch(error){
      if(generation!==this.generation||!this.running||this.pending!==pending)return;
      const normalized=deliveryError(error);const elapsed=Date.now()-pending.queuedAtMs;const retryable=(RETRYABLE_DELIVERY_CODES.has(normalized.code)||RETRYABLE_TRANSPORT_CODES.has(normalized.code))&&pending.attempts<this.deliveryMaxAttempts&&elapsed<this.deliveryMaxElapsedMs;
      if(retryable){
        pending.nextAttemptAt=Date.now()+this.deliveryRetryMs*Math.min(pending.attempts,4);this.lifecycle='delivery_retry';this.delivery={...this.delivery,state:'retry_wait',error:normalized};
        if(pending.journalInput)this.journal.markResultQueued(pending.journalInput,{payload:pending.payload,deliveryAttempts:pending.attempts,queuedAtMs:pending.queuedAtMs,lastDeliveryError:normalized});
        this._event('browser_relay.delivery_retry',{status:'waiting_for_browser',instructionId:pending.instructionId,attempt:pending.attempts,maxAttempts:this.deliveryMaxAttempts,code:normalized.code,detail:normalized.message});return;
      }
      if(pending.journalInput)this.journal.markDeliveryFailed(pending.journalInput,{payload:pending.payload,deliveryAttempts:pending.attempts,error:normalized});
      this.pending=null;this.lifecycle=normalized.code==='SEND_NOT_CONFIRMED'?'delivery_unverified':'delivery_failed';this.error=normalized.message;this.delivery={...this.delivery,state:normalized.code==='SEND_NOT_CONFIRMED'?'submitted_unverified':'failed',error:normalized};
      this._event(normalized.code==='SEND_NOT_CONFIRMED'?'browser_relay.delivery_unverified':'browser_relay.delivery_failed',{status:normalized.code==='SEND_NOT_CONFIRMED'?'unverified':'failed',instructionId:pending.instructionId,attempt:pending.attempts,code:normalized.code,detail:normalized.message});
    }
  }

  async _tick({schedule=true}={}){
    if(!this.running||this.checking){if(schedule)this._schedule();return;}this.checking=true;const generation=this.generation;
    try{
      const target=this.activeTarget;if(!target)throw new Error('Browser relay has no active selected target.');
      let endpoint;
      try{
        // Consume an authority-managed, liveness-verified endpoint when available.
        endpoint=await this.getEndpoint();
      }catch(error){
        // The endpoint provider (browser authority) could not produce a live CDP
        // endpoint. Retain any queued terminal result; otherwise keep waiting for
        // the browser rather than crashing the loop.
        if(this.pending){
          this.lifecycle='delivery_retry';
          this.delivery={...this.delivery,state:'retry_wait',error:deliveryError(error)};
        }else{
          this.lifecycle='waiting_for_browser';
        }
        return;
      }
      if(!endpoint){
        // CDP authority is currently unavailable. Retain any queued terminal
        // result so it survives CDP recovery; keep the loop alive to retry.
        if(this.pending){
          this.lifecycle='delivery_retry';
          this.delivery={...this.delivery,state:'retry_wait',error:{code:'CDP_ENDPOINT_UNAVAILABLE',message:'Managed Chrome CDP endpoint is unavailable; queued terminal result retained.'}};
        }else{
          this.lifecycle='waiting_for_browser';
        }
        return;
      }
      let snapshot;
      try{
        snapshot=await this.channel.snapshot(endpoint,target.targetId,target.providerId);
      }catch(error){
        if(isTransientTransportError(error)){
          // Dead/transient CDP transport. Never discard a queued terminal result
          // and never invert to an ambiguous delivery failure before the message
          // was sent; retain it and keep polling until the browser recovers.
          if(this.pending){
            this.lifecycle='delivery_retry';
            this.delivery={...this.delivery,state:'retry_wait',error:deliveryError(error)};
          }else{
            this.lifecycle='waiting_for_browser';
          }
          return;
        }
        throw error;
      }
      assertSnapshotTarget(snapshot,target);if(generation!==this.generation||!this.running)return;
      if(this.pending){if(!snapshot.generating)await this._deliverPending({endpoint,target,generation});return;}if(snapshot.generating)return;
      const instruction=parseTransportTurn(snapshot,this.getWorkspaceRoot());if(!instruction)return;const digest=hash(instruction.transportKey);if(digest===this.lastHash)return;
      const loopState=this.loopScope?this.journal.getLoopState(this.loopScope):null;
      const responseOwnership=loopState?.deliveryResponse||null;
      if(responseOwnership?.state==='pending'){
        const resolvedAt=nowIso();
        this.journal.markLoopProgress(this.loopScope,{deliveryResponse:{...responseOwnership,state:'consumed',responseInstructionId:instruction.instructionId,responseTransportKey:instruction.transportKey,resolvedAt}});
        this._event('browser_relay.delivery_response_resolved',{status:'running',instructionId:responseOwnership.sourceInstructionId||null,responseInstructionId:instruction.instructionId,targetId:target.targetId,providerId:target.providerId,detail:'Resolved the preceding Access result delivery boundary and preserved the newly observed assistant turn for normal instruction execution.'});
      }
      const journalInput=this._journalInput(instruction,target);const existing=this.journal.get(journalInput);
      if(existing?.state==='delivered'||isSafeConsumedBaseline(existing)){this.lastHash=digest;return;}
      if(existing?.state==='result_queued'&&existing?.payload){
        this.lastHash=digest;this.pending={payload:String(existing.payload),instructionId:instruction.instructionId,sessionId:existing.sessionId||null,targetId:target.targetId,providerId:target.providerId,endpoint,generation,attempts:Number(existing.deliveryAttempts)||0,queuedAtMs:Number(existing.queuedAtMs)||Date.now(),nextAttemptAt:0,journalInput,resultRecordSha256:existing.resultRecordSha256||null};this.lifecycle='result_queued';this.delivery={state:'queued',instructionId:instruction.instructionId,attempts:this.pending.attempts,maxAttempts:this.deliveryMaxAttempts,queuedAt:nowIso(),lastAttemptAt:null,acceptedAt:null,error:null};return;
      }
      if(['executing','failed','delivering','delivery_unverified','delivery_failed','consumed'].includes(existing?.state)){
        this.running=false;throw this._recoveryError(instruction,target,existing.state);
      }
      this.journal.observe(journalInput);this.journal.markExecuting(journalInput,{type:instruction.type});this.lastHash=digest;this.journal.markLoopProgress?.(this.loopScope,{lastInstructionHash:digest,lastInstructionId:instruction.instructionId});this.lifecycle='executing';this._event('browser_relay.instruction_received',{status:'running',instructionId:instruction.instructionId,targetId:target.targetId,providerId:target.providerId,instructionType:instruction.type,detail:(instruction.type==='quick_command'?instruction.command:instruction.objective).slice(0,240)});
      let result;
      let executionTimedOut=false;
      const executeStep=async()=>{
        if(instruction.type==='quick_command'){
          if(!this.executeQuickCommand){const error=new Error('Governed quick-command executor is unavailable.');error.code='QUICK_COMMAND_UNAVAILABLE';throw error;}
          const commandResult=await this.executeQuickCommand({command:instruction.command,workspaceRoot:this.getWorkspaceRoot(),instructionId:instruction.instructionId,target});
          return {ok:commandResult?.ok===true,terminalState:commandResult?.ok===true?'completed':'failed',summary:commandResult?.ok===true?`Command completed with exit code ${commandResult.exitCode}.`:commandResult?.error||'Command failed.',evidence:[{type:'terminal_receipt',receiptId:commandResult?.receipt?.id||commandResult?.receipt?.hash||null,exitCode:commandResult?.exitCode,stdoutLength:String(commandResult?.stdout||'').length,stderrLength:String(commandResult?.stderr||'').length}],quickCommand:commandResult};
        }
        return this.submitInstruction({inbound:'assistant_turn',instructionId:instruction.instructionId,instruction:instruction.objective,objective:instruction.objective,source:'browser-provider',newSession:false,browser:{targetId:target.targetId,providerId:target.providerId,endpoint,url:this._conversationId(target),provenance:snapshot.provenance||null}});
      };
      try{
        if(this.instructionMaxMs>0){
          result=await Promise.race([
            executeStep(),
            new Promise((_,reject)=>setTimeout(()=>{executionTimedOut=true;const error=new Error(`Instruction execution exceeded ${this.instructionMaxMs} ms.`);error.code='INSTRUCTION_EXECUTION_TIMEOUT';reject(error);},this.instructionMaxMs)),
          ]);
        }else{
          result=await executeStep();
        }
      }catch(error){
        this.journal.markFailed(journalInput,{error:{code:error?.code||null,message:error?.message||String(error)}});
        if(executionTimedOut||isTransientExecutionFault(error)){
          this.lifecycle='waiting_for_instruction';this.error=error?.message||String(error);this.delivery=this._blankDelivery();
          this._event(executionTimedOut?'browser_relay.instruction_timeout':'browser_relay.instruction_failed',{status:'failed',instructionId:instruction.instructionId,targetId:target.targetId,providerId:target.providerId,code:error?.code||null,detail:error?.message||String(error),retryable:true,timeoutMs:executionTimedOut?this.instructionMaxMs:null});
          return;
        }
        throw error;
      }
      if(executionTimedOut)return;
      if(generation!==this.generation||!this.running||this.activeTarget?.targetId!==target.targetId)return;
      const suspendedState=String(result?.terminalState||'').toLowerCase();
      if(['waiting_for_user','waiting_for_input','waiting_for_dependency'].includes(suspendedState)){
        this.lifecycle='waiting_for_instruction';this.error=null;this.delivery=this._blankDelivery();
        this._event('browser_relay.suspended',{status:'waiting',instructionId:instruction.instructionId,targetId:target.targetId,providerId:target.providerId,suspendedState,detail:result?.question||result?.summary||'Awaiting subsequent user input before a terminal result is queued.'});
        return;
      }
      const correlation={instructionId:instruction.instructionId,sessionId:result?.sessionId||null,targetId:target.targetId,providerId:target.providerId,endpoint,createdAt:nowIso()};
      const record=this.storeResult?await this.storeResult({instruction,result,correlation,createdAt:correlation.createdAt}):null;
      const payload=instruction.type==='quick_command'?quickCommandResultEnvelope({instructionId:instruction.instructionId,result:result.quickCommand||{},record}):resultEnvelope({instructionId:instruction.instructionId,result,record});
      const queuedAtMs=Date.now();
      this.journal.markResultQueued(journalInput,{payload,resultRecordSha256:record?.sha256||null,resultRecordPath:record?.relativePath||null,terminalState:result?.terminalState||null,sessionId:result?.sessionId||null,deliveryAttempts:0,queuedAtMs});
      this.pending={payload,...correlation,generation,attempts:0,queuedAtMs,nextAttemptAt:0,journalInput,resultRecordSha256:record?.sha256||null};this.lifecycle='result_queued';this.delivery={state:'queued',instructionId:instruction.instructionId,attempts:0,maxAttempts:this.deliveryMaxAttempts,queuedAt:nowIso(),lastAttemptAt:null,acceptedAt:null,error:null};this._event('browser_relay.result_queued',{status:'result_queued',...correlation,instructionType:instruction.type,sha256:record?.sha256||null});
    }catch(error){if(generation===this.generation&&this.lifecycle!=='recovery'){this.running=false;this.lifecycle='degraded';this.error=error?.message||String(error);this._event('browser_relay.failed',{status:'failed',detail:this.error,code:error?.code||null,targetId:this.activeTarget?.targetId||this.target?.targetId||null,providerId:this.activeTarget?.providerId||this.target?.providerId||null});}}
    finally{if(generation===this.generation){this.checking=false;if(schedule&&this.running)this._schedule();}}
  }

  _event(phase,data={}){this.onEvent({phase,timestamp:nowIso(),...data});}
}

module.exports={BrowserInstructionRelay,parseQuickCommandEnvelope,assistantTurnFromSnapshot,parseTransportTurn,resultEnvelope,quickCommandResultEnvelope,RETRYABLE_DELIVERY_CODES,RETRYABLE_TRANSPORT_CODES,isTransientTransportError};