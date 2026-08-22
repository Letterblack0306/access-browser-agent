'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ProviderChannel, sameChatIdentity, endpointParts } = require('./provider-channel');
const { BrowserInstructionRelay } = require('../agent/executive/BrowserInstructionRelay');
const { emitDiagnostic } = require('../system/runtime-diagnostic-bus');
const { createCorrelation, extendCorrelation, newId } = require('../system/runtime-correlation');

const RETRYABLE_DELIVERY_CODES=new Set([
  'COMPOSER_NOT_FOUND','PROVIDER_GENERATING','SEND_BUTTON_UNAVAILABLE','TARGET_TEMPORARILY_UNAVAILABLE',
]);

class BrowserEvidenceStore {
  constructor(root) { this.root=path.resolve(root); }

  async put(input={}) {
    await fs.mkdir(this.root,{recursive:true});
    const stamp=new Date().toISOString().replace(/[:.]/gu,'-');
    const id=String(input.artifactId || newId('artifact'));
    const base=`${stamp}-${id}`;
    const refs=[];
    const privacy={
      state:String(input.privacy?.state || 'minimized'),
      screenshotPolicy:String(input.privacy?.screenshotPolicy || 'disabled_by_default'),
      containsConversationContent:input.privacy?.containsConversationContent === true,
      redactionNotes:Array.isArray(input.privacy?.redactionNotes) ? input.privacy.redactionNotes.map(String) : [],
    };

    if (input.dom) {
      const file=path.join(this.root,`${base}.json`);
      const body=JSON.stringify({ correlation:input.correlation || {}, privacy, evidence:input.dom },null,2);
      await fs.writeFile(file,body,'utf8');
      refs.push({ type:'dom', path:file, sha256:createHash('sha256').update(body).digest('hex'), privacy:{...privacy} });
    }

    if (input.screenshotBase64) {
      const bytes=Buffer.from(input.screenshotBase64,'base64');
      const file=path.join(this.root,`${base}.png`);
      await fs.writeFile(file,bytes);
      refs.push({ type:'screenshot', path:file, sha256:createHash('sha256').update(bytes).digest('hex'), privacy:{...privacy,state:'raw-local-opt-in',containsConversationContent:true} });
    }

    return { artifactId:id, refs, capturedAt:new Date().toISOString(), correlation:input.correlation || {}, privacy };
  }
}

class ObservableProviderChannel extends ProviderChannel {
  constructor(options={}) {
    super(options);
    this.evidenceStore=options.evidenceStore || null;
    this.renderTimeoutMs=Math.max(500,Number(options.renderTimeoutMs)||6000);
    this.captureScreenshots=options.captureScreenshots === true || process.env.ACCESS_AGENT_CAPTURE_BROWSER_SCREENSHOT === '1';
  }

  async send(endpoint,targetId,providerId,text,options={}) {
    const configuredChatUrl=String(options.configuredChatUrl || this.expectedUrlFor(targetId) || '');
    const correlation=createCorrelation({ ...(options.correlation || {}), targetId, url:configuredChatUrl });
    const started=Date.now();
    emitDiagnostic({ source:'provider-channel', category:'delivery', action:'send', phase:'start', correlation, data:{providerId,configuredChatUrl,evidenceLevel:'TEXT_INSERTED_PENDING'} });
    try {
      if (configuredChatUrl) {
        const before=await this.snapshot(endpoint,targetId,providerId);
        if (!sameChatIdentity(configuredChatUrl,before.url)) {
          const error=new Error('Conversation identity changed before result delivery.');
          error.code='CHAT_IDENTITY_CHANGED';error.classification='TARGET';throw error;
        }
      }
      const accepted=await super.send(endpoint,targetId,providerId,text);
      emitDiagnostic({ source:'provider-channel', category:'delivery', action:'submission', phase:'success', durationMs:Date.now()-started, correlation, data:{...accepted,evidenceLevel:'SUBMISSION_ACCEPTED'} });
      const rendered=await this.verifyRenderedDelivery(endpoint,targetId,providerId,text,configuredChatUrl);
      const result={...accepted,evidenceLevel:rendered.verified?'RENDERED_DELIVERY_VERIFIED':'SUBMISSION_ACCEPTED',rendered};
      if(!rendered.verified)result.artifact=await this.captureFailureEvidence(endpoint,targetId,providerId,correlation).catch(()=>null);
      emitDiagnostic({ source:'provider-channel', category:'delivery', action:'rendered_delivery', phase:rendered.verified?'success':'unverified', severity:rendered.verified?'info':'warn', durationMs:Date.now()-started, correlation, data:result });
      return result;
    } catch(error) {
      const artifact=await this.captureFailureEvidence(endpoint,targetId,providerId,correlation).catch(()=>null);
      emitDiagnostic({ source:'provider-channel', category:'delivery', action:'send', phase:'failed', severity:'error', durationMs:Date.now()-started, correlation, data:{providerId,configuredChatUrl,artifact}, error });
      if(artifact)error.diagnosticArtifact=artifact;
      throw error;
    }
  }

  async verifyRenderedDelivery(endpoint,targetId,providerId,text,configuredChatUrl='') {
    const identity=renderedEnvelopeIdentity(text);
    const marker=renderedMarker(text);
    const deadline=Date.now()+this.renderTimeoutMs;
    let last=null;
    while(Date.now()<=deadline) {
      last=await this.readConversation(endpoint,targetId,providerId,{limit:20});
      if(configuredChatUrl&&!sameChatIdentity(configuredChatUrl,last.url)) {
        const error=new Error('Conversation identity changed before rendered delivery could be verified.');
        error.code='CHAT_IDENTITY_CHANGED';error.classification='TARGET';throw error;
      }
      const renderedUser=[...(Array.isArray(last.messages)?last.messages:[])].reverse().find(message=>message?.role==='user'&&renderedMessageMatchesIdentity(message.text||'',identity));
      if(renderedUser)return{verified:true,marker,identity,url:last.url,title:last.title,checkedAt:new Date().toISOString(),message:{role:'user',messageId:String(renderedUser.messageId||''),messageIndex:Number.isInteger(renderedUser.messageIndex)?renderedUser.messageIndex:null}};
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    return{verified:false,marker,identity,url:last?.url||null,title:last?.title||null,checkedAt:new Date().toISOString(),reason:'Rendered result envelope was not observed in a user-authored conversation turn before timeout.',message:null};
  }

  async captureFailureEvidence(endpoint,targetId,providerId,correlation={}) {
    if(!this.evidenceStore)return null;
    const client=await this.cdpFactory({...endpointParts(endpoint),target:String(targetId)});
    try {
      await client.Runtime.enable();
      if(client.Page?.enable)await client.Page.enable();
      const evaluated=await client.Runtime.evaluate({
        expression:`(()=>({url:location.href,title:document.title,readyState:document.readyState,composerCount:document.querySelectorAll("textarea,[contenteditable=true]").length,supportedAssistantCount:document.querySelectorAll('[data-message-author-role="assistant"]').length,hasSendControl:Boolean(document.querySelector('button[data-testid="send-button"],button[aria-label*="Send" i]')),hasStopControl:Boolean(document.querySelector('button[data-testid="stop-button"],button[aria-label*="Stop" i]'))}))()`,
        returnByValue:true,
      });
      let screenshotBase64=null;
      if(this.captureScreenshots) {
        try{screenshotBase64=(await client.Page.captureScreenshot({format:'png',fromSurface:true}))?.data||null;}catch{}
      }
      return this.evidenceStore.put({
        dom:evaluated?.result?.value||{},
        screenshotBase64,
        correlation,
        privacy:{
          state:'minimized',
          screenshotPolicy:this.captureScreenshots?'raw_local_opt_in':'disabled_by_default',
          containsConversationContent:Boolean(screenshotBase64),
          redactionNotes:['DOM evidence excludes page body/chat text.','Screenshots are disabled unless ACCESS_AGENT_CAPTURE_BROWSER_SCREENSHOT=1.'],
        },
      });
    } finally {await client.close();}
  }
}

class ObservableBrowserInstructionRelay extends BrowserInstructionRelay {
  constructor(options={}) {
    const correlationByInstruction=new Map();
    const deliveryByInstruction=new Map();
    const originalSubmit=options.submitInstruction;
    const journal=options.journal || global.__accessAgentTransportJournal || null;
    const executeQuickCommand=options.executeQuickCommand || global.__accessAgentExecuteQuickCommand || null;
    super({
      ...options,
      journal,
      executeQuickCommand,
      submitInstruction:async input=>{
        const configuredUrl=options.channel?.expectedUrlFor?.(input.browser?.targetId)||input.browser?.url||'';
        const base=createCorrelation({instructionId:input.instructionId,targetId:input.browser?.targetId,url:configuredUrl,operationId:input.operationId});
        correlationByInstruction.set(input.instructionId,base);
        emitDiagnostic({source:'browser-relay',category:'loop',action:'instruction_submit',phase:'start',correlation:base,data:{source:input.source,configuredUrl}});
        try {
          const result=await originalSubmit({...input,correlation:base,operationId:base.operationId});
          const full=extendCorrelation(base,{sessionId:result?.sessionId,turnId:result?.turnId});
          correlationByInstruction.set(input.instructionId,full);
          emitDiagnostic({source:'browser-relay',category:'loop',action:'instruction_submit',phase:'success',correlation:full,data:{terminalState:result?.terminalState||result?.status||null}});
          return{...result,correlation:full,operationId:full.operationId};
        } catch(error) {
          emitDiagnostic({source:'browser-relay',category:'loop',action:'instruction_submit',phase:'failed',severity:'error',correlation:base,error});
          throw error;
        }
      },
      onEvent:event=>{
        if(event?.instructionId&&event?.phase==='browser_relay.result_queued'&&!deliveryByInstruction.has(event.instructionId))deliveryByInstruction.set(event.instructionId,newId('delivery'));
        const base=event?.instructionId?correlationByInstruction.get(event.instructionId):null;
        const deliveryId=event?.instructionId?deliveryByInstruction.get(event.instructionId)||null:null;
        const correlation=extendCorrelation(base||{},{instructionId:event?.instructionId,targetId:event?.targetId,deliveryId});
        emitDiagnostic({
          source:'browser-relay',
          category:event?.phase?.includes('delivery')||event?.phase?.includes('result')?'delivery':'loop',
          action:event?.phase||'event',
          phase:event?.status||'event',
          severity:event?.status==='failed'?'error':event?.phase==='browser_relay.delivery_unverified'||event?.phase==='browser_relay.instruction_recovery_required'?'warn':'info',
          correlation,
          data:{...event,deliveryId},
        });
        options.onEvent?.({...event,deliveryId,correlation});
        if(event?.instructionId&&['browser_relay.result_sent','browser_relay.delivery_failed','browser_relay.delivery_unverified'].includes(event?.phase))deliveryByInstruction.delete(event.instructionId);
      },
    });
    this._correlationByInstruction=correlationByInstruction;
    this._deliveryByInstruction=deliveryByInstruction;
  }

  async _deliverPending({endpoint,target,generation}) {
    const pending=this.pending;
    if(!pending||pending.generation!==generation)return;
    const current=Date.now();
    if(pending.nextAttemptAt&&current<pending.nextAttemptAt)return;
    pending.attempts+=1;
    this.lifecycle='delivering';
    this.delivery={...this.delivery,state:'delivering',instructionId:pending.instructionId,attempts:pending.attempts,lastAttemptAt:nowIso(),error:null};
    if(pending.journalInput)this.journal.markDelivering(pending.journalInput,{payload:pending.payload,deliveryAttempts:pending.attempts,queuedAtMs:pending.queuedAtMs});
    this._event('browser_relay.delivery_attempt',{status:'delivering',instructionId:pending.instructionId,attempt:pending.attempts,targetId:target.targetId,providerId:target.providerId});
    try {
      const correlation=this._correlationByInstruction.get(pending.instructionId)||{};
      const delivery=await this.channel.send(endpoint,target.targetId,target.providerId,pending.payload,{configuredChatUrl:this.channel.expectedUrlFor?.(target.targetId)||target.url||'',correlation});
      if(generation!==this.generation||!this.running||this.pending!==pending)return;
      this.error=null;
      if(delivery?.evidenceLevel==='RENDERED_DELIVERY_VERIFIED') {
        if(pending.journalInput)this.journal.markDelivered(pending.journalInput,{deliveryAttempts:pending.attempts,evidenceLevel:'RENDERED_DELIVERY_VERIFIED'});
        const submittedAt=nowIso();
        if(this.loopScope)this.journal.markLoopProgress(this.loopScope,{lastInstructionHash:this.lastHash||null,lastInstructionId:pending.instructionId,deliveryResponse:{state:'pending',sourceInstructionId:pending.instructionId,sourceTransportKey:pending.journalInput?.transportKey||null,resultRecordSha256:pending.resultRecordSha256||null,submittedAt}});
        this.pending=null;
        this.lifecycle='waiting_for_instruction';
        this.delivery={...this.delivery,state:'rendered_verified',acceptedAt:submittedAt,error:null,evidenceLevel:'RENDERED_DELIVERY_VERIFIED'};
        this._event('browser_relay.result_sent',{status:'waiting_for_browser',instructionId:pending.instructionId,targetId:target.targetId,providerId:target.providerId,delivery});
      } else {
        const reason=delivery?.rendered?.reason||'Submission was accepted but the rendered result was not observed.';
        if(pending.journalInput)this.journal.markDeliveryUnverified(pending.journalInput,{deliveryAttempts:pending.attempts,evidenceLevel:delivery?.evidenceLevel||'SUBMISSION_ACCEPTED',reason,artifact:delivery?.artifact||null});
        this.pending=null;
        this.running=false;
        this.lifecycle='delivery_unverified';
        this.delivery={...this.delivery,state:'submitted_unverified',acceptedAt:nowIso(),error:{code:'RENDERED_DELIVERY_UNVERIFIED',message:reason},evidenceLevel:delivery?.evidenceLevel||'SUBMISSION_ACCEPTED'};
        this._event('browser_relay.delivery_unverified',{status:'unverified',instructionId:pending.instructionId,targetId:target.targetId,providerId:target.providerId,code:'RENDERED_DELIVERY_UNVERIFIED',detail:reason,delivery});
      }
    } catch(error) {
      if(generation!==this.generation||!this.running||this.pending!==pending)return;
      const normalized=deliveryError(error);
      const elapsed=Date.now()-pending.queuedAtMs;
      const retryable=RETRYABLE_DELIVERY_CODES.has(normalized.code)&&pending.attempts<this.deliveryMaxAttempts&&elapsed<this.deliveryMaxElapsedMs;
      if(retryable) {
        pending.nextAttemptAt=Date.now()+this.deliveryRetryMs*Math.min(pending.attempts,4);
        this.lifecycle='delivery_retry';
        this.delivery={...this.delivery,state:'retry_wait',error:normalized};
        if(pending.journalInput)this.journal.markResultQueued(pending.journalInput,{payload:pending.payload,deliveryAttempts:pending.attempts,queuedAtMs:pending.queuedAtMs,lastDeliveryError:normalized});
        this._event('browser_relay.delivery_retry',{status:'waiting_for_browser',instructionId:pending.instructionId,attempt:pending.attempts,maxAttempts:this.deliveryMaxAttempts,code:normalized.code,detail:normalized.message});
        return;
      }
      this.pending=null;
      if(normalized.code==='SEND_NOT_CONFIRMED') {
        if(pending.journalInput)this.journal.markDeliveryUnverified(pending.journalInput,{deliveryAttempts:pending.attempts,reason:normalized.message,artifact:error?.diagnosticArtifact||null});
        this.running=false;this.lifecycle='delivery_unverified';this.error=normalized.message;this.delivery={...this.delivery,state:'submitted_unverified',error:normalized};
        this._event('browser_relay.delivery_unverified',{status:'unverified',instructionId:pending.instructionId,attempt:pending.attempts,code:normalized.code,detail:normalized.message,artifact:error?.diagnosticArtifact||null});
      } else {
        if(pending.journalInput)this.journal.markDeliveryFailed(pending.journalInput,{deliveryAttempts:pending.attempts,error:normalized,artifact:error?.diagnosticArtifact||null});
        this.lifecycle='delivery_failed';this.error=normalized.message;this.delivery={...this.delivery,state:'failed',error:normalized};
        this._event('browser_relay.delivery_failed',{status:'failed',instructionId:pending.instructionId,attempt:pending.attempts,code:normalized.code,detail:normalized.message,artifact:error?.diagnosticArtifact||null});
      }
    }
  }

  async _tick(options={}) {
    if (this.loopScope) {
      const loopState = this.journal.getLoopState(this.loopScope);
      if (loopState?.deliveryResponse?.state === 'pending') {
        const resolvedAt = new Date().toISOString();
        this.journal.markLoopProgress(this.loopScope, {
          deliveryResponse: {
            ...loopState.deliveryResponse,
            state: 'resolved',
            resolvedAt,
          },
        });
        this._event('browser_relay.delivery_response_resolved', {
          status: 'running',
          instructionId: loopState.deliveryResponse.sourceInstructionId || null,
        });
        return;
      }
    }
    return super._tick(options);
  }
}

function deliveryError(error){return{code:String(error?.code||'DELIVERY_FAILED'),message:error?.message||String(error)};}
function nowIso(){return new Date().toISOString();}
function normalizeRenderedText(value){return String(value||'').replace(/\s+/gu,' ').trim();}
function renderedEnvelopeIdentity(text){
  const source=String(text||'');
  const normalized=normalizeRenderedText(source);
  let startMarker='';
  if(normalized.startsWith('=== ACCESS AGENT RESULT START ==='))startMarker='=== ACCESS AGENT RESULT START ===';
  else if(normalized.startsWith('=== ACCESS AGENT QUICK COMMAND RESULT START ==='))startMarker='=== ACCESS AGENT QUICK COMMAND RESULT START ===';
  if(!startMarker)return null;
  const instructionId=String(/^\s*INSTRUCTION ID:\s*(.+?)\s*$/imu.exec(source)?.[1]||'').trim();
  if(!instructionId)return null;
  const resultRecordSha256=String(/^\s*RESULT RECORD SHA256:\s*([a-f0-9]{64})\s*$/imu.exec(source)?.[1]||'').trim().toLowerCase();
  return{startMarker,instructionId,resultRecordSha256:resultRecordSha256||null};
}
function renderedMessageMatchesIdentity(text,identity){
  if(!identity?.startMarker||!identity?.instructionId)return false;
  const candidate=renderedEnvelopeIdentity(text);
  if(!candidate)return false;
  if(candidate.startMarker!==identity.startMarker||candidate.instructionId!==identity.instructionId)return false;
  if(identity.resultRecordSha256&&candidate.resultRecordSha256!==identity.resultRecordSha256)return false;
  return true;
}
function renderedMarker(text){
  const source=String(text||'');
  const identity=renderedEnvelopeIdentity(source);
  if(!identity)return'';
  const status=String(/^\s*STATUS:\s*(.+?)\s*$/imu.exec(source)?.[1]||'').trim();
  return`${identity.startMarker} INSTRUCTION ID: ${identity.instructionId}${status?` STATUS: ${status}`:''}${identity.resultRecordSha256?` RESULT RECORD SHA256: ${identity.resultRecordSha256}`:''}`;
}

module.exports={BrowserEvidenceStore,ObservableProviderChannel,ObservableBrowserInstructionRelay,renderedMarker,normalizeRenderedText,renderedEnvelopeIdentity,renderedMessageMatchesIdentity};