'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

class BrowserTransportJournal {
  constructor(file) {
    const override=String(process.env.ACCESS_AGENT_TRANSPORT_JOURNAL_FILE||'').trim();
    this.file=path.resolve(override||file);
    this.records=new Map();
    this.loopStates=new Map();
 this.reconciliations=new Map();
    this._load();
  }

  _load() {
    try {
      const lines=fs.readFileSync(this.file,'utf8').split(/\r?\n/u).filter(Boolean);
      for (const line of lines) {
        try {
          const record=JSON.parse(line);
          if (record?.kind === 'loop_state' && record.scopeKey) this.loopStates.set(record.scopeKey,record);
 else if (record?.kind === 'instruction_reconciliation' && record.instructionKey) this.reconciliations.set(record.instructionKey,record);
          else if (record?.key) this.records.set(record.key,record);
        } catch {}
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  scopeKey({ workspaceRoot='', conversationId='' } = {}) {
    return createHash('sha256').update(JSON.stringify({
      workspaceRoot:String(workspaceRoot || ''),
      conversationId:String(conversationId || ''),
    })).digest('hex');
  }

  // targetId is deliberately excluded. Recover creates a new CDP target for
  // the same conversation; transport identity must survive that replacement.
  keyFor({ workspaceRoot='', conversationId='', transportKey='', raw='' } = {}) {
    const rawHash=createHash('sha256').update(String(raw || '')).digest('hex');
    return createHash('sha256').update(JSON.stringify({
      workspaceRoot:String(workspaceRoot || ''),
      conversationId:String(conversationId || ''),
      transportKey:String(transportKey || ''),
      rawHash,
    })).digest('hex');
  }

  get(input={}) { return this.records.get(this.keyFor(input)) || null; }
  getLoopState(input={}) { return this.loopStates.get(this.scopeKey(input)) || null; }

listUnresolvedRecoveries({ workspaceRoot='', conversationId='' } = {}) {
const expectedWorkspace=String(workspaceRoot || '');
const expectedConversation=String(conversationId || '');
const unresolved=[];
for (const record of this.records.values()) {
if (record.workspaceRoot !== expectedWorkspace || record.conversationId !== expectedConversation) continue;
const state=String(record.state || '');
if (!AMBIGUOUS_INSTRUCTION_STATES.has(state)) continue;
if (state === 'consumed' && SAFE_CONSUMED_DISPOSITIONS.has(String(record.disposition || ''))) continue;
if (this.reconciliations.has(record.key)) continue;
unresolved.push(this.getRecovery({key:record.key,workspaceRoot:expectedWorkspace,conversationId:expectedConversation}));
}
return unresolved.sort((left,right)=>{
const leftAt=String(left.record?.observedAt || left.record?.recordedAt || '');
const rightAt=String(right.record?.observedAt || right.record?.recordedAt || '');
return leftAt.localeCompare(rightAt) || String(left.key || '').localeCompare(String(right.key || ''));
});
}

getRecovery({ key='', workspaceRoot='', conversationId='' } = {}) {
const instructionKey=String(key || '');
const record=this.records.get(instructionKey) || null;
if (!record) throw recoveryError('RECOVERY_RECORD_NOT_FOUND','No durable instruction record exists for the supplied key.');
if (record.workspaceRoot !== String(workspaceRoot || '') || record.conversationId !== String(conversationId || '')) {
throw recoveryError('RECOVERY_SCOPE_MISMATCH','The durable instruction record does not belong to the supplied workspace and conversation.');
}
const reconciliation=this.reconciliations.get(instructionKey) || null;
const ambiguous=AMBIGUOUS_INSTRUCTION_STATES.has(String(record.state || '')) && !reconciliation;
return {
key:instructionKey,
ambiguous,
record:{...record},
reconciliation:reconciliation ? {...reconciliation,evidenceRefs:[...(reconciliation.evidenceRefs || [])]} : null,
availableEvidence:{instructionRecord:true,evidenceRefs:reconciliation ? [...(reconciliation.evidenceRefs || [])] : []},
missingEvidence:ambiguous ? ['durable_completion_or_abandonment_receipt'] : [],
};
}

reconcileRecovery({ key='', workspaceRoot='', conversationId='', disposition='', reason='', operator='', evidenceRefs=[] } = {}) {
const recovery=this.getRecovery({key,workspaceRoot,conversationId});
const normalizedDisposition=String(disposition || '').trim();
const normalizedReason=String(reason || '').trim();
const normalizedOperator=String(operator || '').trim();
 const normalizedEvidence=normalizeEvidenceRefs(evidenceRefs);
if (!RECOVERY_DISPOSITIONS.has(normalizedDisposition)) {
throw recoveryError('RECOVERY_DISPOSITION_UNSUPPORTED','Unsupported recovery disposition: '+(normalizedDisposition || '(empty)')+'.');
}
if (!normalizedReason) throw recoveryError('RECOVERY_REASON_REQUIRED','A durable operator reason is required.');
if (normalizedDisposition === 'proven_complete' && !normalizedEvidence.length) {
throw recoveryError('RECOVERY_EVIDENCE_REQUIRED','proven_complete requires at least one correlated durable evidence reference.');
}
const existing=recovery.reconciliation;
if (existing) {
const identical=existing.disposition === normalizedDisposition
&& existing.reason === normalizedReason
&& String(existing.operator || '') === normalizedOperator
&& JSON.stringify(existing.evidenceRefs || []) === JSON.stringify(normalizedEvidence);
if (identical) return existing;
throw recoveryError('RECOVERY_ALREADY_RECONCILED','The durable instruction already has a different reconciliation receipt.');
}
if (!AMBIGUOUS_INSTRUCTION_STATES.has(String(recovery.record.state || ''))) {
throw recoveryError('RECOVERY_RECORD_NOT_AMBIGUOUS','Instruction state '+(recovery.record.state || '(empty)')+' does not require recovery reconciliation.');
}
const reconciledAt=new Date().toISOString();
const receiptCore={
kind:'instruction_reconciliation',
instructionKey:recovery.key,
instructionId:String(recovery.record.instructionId || ''),
workspaceRoot:String(workspaceRoot || ''),
conversationId:String(conversationId || ''),
priorState:String(recovery.record.state || ''),
disposition:normalizedDisposition,
reason:normalizedReason,
operator:normalizedOperator,
evidenceRefs:normalizedEvidence,
instructionRecordSha256:createHash('sha256').update(JSON.stringify(recovery.record)).digest('hex'),
reconciledAt,
};
const persisted={
...receiptCore,
receiptId:createHash('sha256').update(JSON.stringify(receiptCore)).digest('hex'),
recordedAt:reconciledAt,
};
this._appendRaw(persisted);
this.reconciliations.set(recovery.key,persisted);
return persisted;
}

  observe(input={}) {
    const key=this.keyFor(input);
    const existing=this.records.get(key);
    if (existing) return existing;
    return this._appendInstruction({
      key,
      kind:'instruction',
      state:'observed',
      instructionId:String(input.instructionId || ''),
      transportKey:String(input.transportKey || ''),
      workspaceRoot:String(input.workspaceRoot || ''),
      conversationId:String(input.conversationId || ''),
      targetId:String(input.targetId || ''),
      rawSha256:createHash('sha256').update(String(input.raw || '')).digest('hex'),
      observedAt:new Date().toISOString(),
    });
  }

  markExecuting(input={}, extra={}) { return this._transition(input,'executing',{ executingAt:new Date().toISOString(), ...extra }); }
  markResultQueued(input={}, extra={}) { return this._transition(input,'result_queued',{ resultQueuedAt:new Date().toISOString(), ...extra }); }
  markDelivering(input={}, extra={}) { return this._transition(input,'delivering',{ deliveringAt:new Date().toISOString(), ...extra }); }
  markDelivered(input={}, extra={}) { return this._transition(input,'delivered',{ deliveredAt:new Date().toISOString(), ...extra }); }
  markDeliveryUnverified(input={}, extra={}) { return this._transition(input,'delivery_unverified',{ deliveryUnverifiedAt:new Date().toISOString(), ...extra }); }
  markDeliveryFailed(input={}, extra={}) { return this._transition(input,'delivery_failed',{ deliveryFailedAt:new Date().toISOString(), ...extra }); }
  markConsumed(input={}, extra={}) { return this._transition(input,'consumed',{ consumedAt:new Date().toISOString(), ...extra }); }
  markFailed(input={}, extra={}) { return this._transition(input,'failed',{ failedAt:new Date().toISOString(), ...extra }); }

  markLoopStarted(input={}, extra={}) {
    return this._appendLoopState(input,'running',{ startedAt:new Date().toISOString(), ...extra });
  }
  markLoopStopped(input={}, extra={}) {
    return this._appendLoopState(input,'stopped',{ stoppedAt:new Date().toISOString(), ...extra });
  }
  markLoopProgress(input={}, extra={}) {
    const current=this.getLoopState(input) || {};
    return this._appendLoopState(input,'running',{ startedAt:current.startedAt || new Date().toISOString(), ...current, ...extra });
  }

  _transition(input,state,extra={}) {
    const key=this.keyFor(input);
    const previous=this.records.get(key) || this.observe(input);
    return this._appendInstruction({ ...previous, ...extra, key, state, targetId:String(input.targetId || previous.targetId || '') });
  }

  _appendLoopState(input,state,extra={}) {
    const scopeKey=this.scopeKey(input);
    const persisted={
      kind:'loop_state',
      scopeKey,
      workspaceRoot:String(input.workspaceRoot || ''),
      conversationId:String(input.conversationId || ''),
      targetId:String(input.targetId || ''),
      state,
      ...extra,
      recordedAt:new Date().toISOString(),
    };
    this._appendRaw(persisted);
    this.loopStates.set(scopeKey,persisted);
    return persisted;
  }

  _appendInstruction(record) {
    const persisted={ ...record, recordedAt:new Date().toISOString() };
    this._appendRaw(persisted);
    this.records.set(persisted.key,persisted);
    return persisted;
  }

  _appendRaw(record) {
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    fs.appendFileSync(this.file,`${JSON.stringify(record)}\n`,'utf8');
  }
}

function normalizeEvidenceRefs(values) {
if(!Array.isArray(values))throw recoveryError('RECOVERY_EVIDENCE_INVALID','Evidence references must be an array of durable artifact objects.');
const normalized=[];
for(const value of values){
if(!value||typeof value!=='object'||Array.isArray(value))throw recoveryError('RECOVERY_EVIDENCE_INVALID','Each evidence reference must be a durable artifact object.');
const artifactId=String(value.artifactId||value.receiptId||'').trim();
const reference=String(value.path||value.relativePath||value.reference||'').trim();
const sha256=String(value.sha256||'').trim().toLowerCase();
if(!artifactId&&!reference)throw recoveryError('RECOVERY_EVIDENCE_INVALID','Each evidence reference requires artifactId, receiptId, path, relativePath, or reference.');
if(!/^[a-f0-9]{64}$/u.test(sha256))throw recoveryError('RECOVERY_EVIDENCE_INVALID','Each evidence reference requires an exact SHA-256 digest.');
normalized.push({
...(artifactId?{artifactId}:{}),
...(reference?{reference}:{}),
sha256,
});
}
const unique=new Map(normalized.map(value=>[JSON.stringify(value),value]));
return [...unique.values()].sort((left,right)=>JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

const AMBIGUOUS_INSTRUCTION_STATES=new Set(['executing','failed','delivering','delivery_unverified','delivery_failed','consumed']);
const SAFE_CONSUMED_DISPOSITIONS=new Set(['delivery_response','first_start_historical_baseline','known_historical_baseline']);
const RECOVERY_DISPOSITIONS=new Set(['abandoned','quarantined','proven_complete']);

function recoveryError(code,message) {
 const error=new Error(message);
 error.code=code;
 error.classification='TRANSPORT';
 return error;
}

module.exports={BrowserTransportJournal};