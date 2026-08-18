'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {BrowserTransportJournal}=require('../src/system/browser-transport-journal');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'access-r3-recovery-'));
const file=path.join(root,'transport.jsonl');
const workspaceRoot=['G:','Demo'].join(path.win32.sep);
const wrongWorkspaceRoot=['G:','Wrong'].join(path.win32.sep);
const conversationId=['https:','','chatgpt.com','c','r3'].join('/');
const input={
workspaceRoot,
conversationId,
targetId:'tab-old',
instructionId:'turn-r3',
transportKey:'assistant-turn:r3',
raw:'Perform one side effect.',
};

const journal=new BrowserTransportJournal(file);
const observed=journal.observe(input);
journal.markExecuting(input,{type:'agent_instruction'});
const before=fs.readFileSync(file,'utf8');

const blocked=journal.getRecovery({key:observed.key,workspaceRoot,conversationId});
assert.equal(blocked.ambiguous,true);
assert.equal(blocked.record.state,'executing');
assert.equal(blocked.reconciliation,null);

assert.throws(()=>journal.reconcileRecovery({
key:observed.key,workspaceRoot,conversationId,
disposition:'proven_complete',
reason:'Operator claims it completed.',
}),error=>error.code==='RECOVERY_EVIDENCE_REQUIRED');

const provableInput={...input,instructionId:'turn-r3-proven',transportKey:'assistant-turn:r3-proven',raw:'Provable side effect.'};
const provableObserved=journal.observe(provableInput);
journal.markExecuting(provableInput,{type:'agent_instruction'});
assert.throws(()=>journal.reconcileRecovery({
key:provableObserved.key,workspaceRoot,conversationId,
disposition:'proven_complete',
reason:'Unstructured text is not durable proof.',
evidenceRefs:['anything'],
}),error=>error.code==='RECOVERY_EVIDENCE_INVALID');
const provenReceipt=journal.reconcileRecovery({
key:provableObserved.key,workspaceRoot,conversationId,
disposition:'proven_complete',
reason:'Correlated artifact proves completion.',
operator:'local-operator',
evidenceRefs:[{artifactId:'artifact-r3',sha256:'a'.repeat(64)}],
});
assert.equal(provenReceipt.evidenceRefs[0].artifactId,'artifact-r3');
assert.equal(provenReceipt.evidenceRefs[0].sha256,'a'.repeat(64));


assert.throws(()=>journal.reconcileRecovery({
key:observed.key,workspaceRoot:wrongWorkspaceRoot,conversationId,
disposition:'abandoned',
reason:'Wrong workspace.',
}),error=>error.code==='RECOVERY_SCOPE_MISMATCH');

const request={
key:observed.key,workspaceRoot,conversationId,
disposition:'quarantined',
reason:'Side effects cannot be proven; preserve evidence and skip replay.',
operator:'local-operator',
};
const receipt=journal.reconcileRecovery(request);
assert.equal(receipt.kind,'instruction_reconciliation');
assert.equal(receipt.instructionKey,observed.key);
assert.equal(receipt.disposition,'quarantined');
assert.equal(fs.readFileSync(file,'utf8').startsWith(before),true,'original journal bytes must remain intact');

const afterFirst=fs.readFileSync(file,'utf8');
const repeated=journal.reconcileRecovery(request);
assert.deepEqual(repeated,receipt);
assert.equal(fs.readFileSync(file,'utf8'),afterFirst,'identical reconciliation must not append twice');

assert.throws(()=>journal.reconcileRecovery({
key:observed.key,workspaceRoot,conversationId,
disposition:'abandoned',
reason:'Conflicting disposition.',
}),error=>error.code==='RECOVERY_ALREADY_RECONCILED');

const restarted=new BrowserTransportJournal(file);
const recovered=restarted.getRecovery({key:observed.key,workspaceRoot,conversationId});
assert.equal(recovered.ambiguous,false);
assert.equal(recovered.reconciliation.disposition,'quarantined');
assert.equal(recovered.record.state,'executing','original instruction evidence must not be rewritten');

console.log('browser-recovery-reconciliation-smoke: PASS');
