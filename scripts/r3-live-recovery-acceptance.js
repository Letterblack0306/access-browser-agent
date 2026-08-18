'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const defaultSource=path.join(process.env.APPDATA||'', 'access-agent','diagnostics','browser-transport.jsonl');
const sourceFile=path.resolve(String(process.env.ACCESS_AGENT_R3_SOURCE_JOURNAL||defaultSource));
const instructionKey=String(process.env.ACCESS_AGENT_R3_INSTRUCTION_KEY||'5fad5bad16338bd15f885acc63165cda63088b2d4712640327c48d24b8c5929d');
assert.ok(fs.existsSync(sourceFile),'R3 source journal does not exist: '+sourceFile);

const sourceBefore=fs.readFileSync(sourceFile);
const records=sourceBefore.toString('utf8').split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line));
const instructionRecords=records.filter(record=>record.kind==='instruction'&&record.key===instructionKey);
assert.ok(instructionRecords.length,'R3 instruction key was not found in the source journal.');
const latest=instructionRecords[instructionRecords.length-1];
assert.ok(['executing','failed','delivering','delivery_unverified','delivery_failed','consumed'].includes(latest.state),'R3 source record is not ambiguous: '+latest.state);

const isolatedRoot=fs.mkdtempSync(path.join(os.tmpdir(),'access-r3-acceptance-'));
const isolatedFile=path.join(isolatedRoot,'browser-transport.jsonl');
fs.writeFileSync(isolatedFile,sourceBefore);

const previousOverride=process.env.ACCESS_AGENT_TRANSPORT_JOURNAL_FILE;
process.env.ACCESS_AGENT_TRANSPORT_JOURNAL_FILE=isolatedFile;
const modulePath=require.resolve('../src/system/browser-transport-journal');
delete require.cache[modulePath];
const {BrowserTransportJournal}=require(modulePath);

const journal=new BrowserTransportJournal(isolatedFile);
const before=journal.getRecovery({key:instructionKey,workspaceRoot:latest.workspaceRoot,conversationId:latest.conversationId});
assert.equal(before.ambiguous,true,'copied ambiguous record must remain blocked before reconciliation');
const receipt=journal.reconcileRecovery({
key:instructionKey,
workspaceRoot:latest.workspaceRoot,
conversationId:latest.conversationId,
disposition:'quarantined',
reason:'Isolated R3 acceptance: ambiguity preserved and automatic replay remains prohibited.',
operator:'r3-isolated-acceptance',
});
assert.equal(receipt.kind,'instruction_reconciliation');

const restarted=new BrowserTransportJournal(isolatedFile);
const after=restarted.getRecovery({key:instructionKey,workspaceRoot:latest.workspaceRoot,conversationId:latest.conversationId});
assert.equal(after.ambiguous,false);
assert.equal(after.reconciliation.receiptId,receipt.receiptId);
assert.equal(after.record.state,latest.state);
assert.deepEqual(fs.readFileSync(sourceFile),sourceBefore,'production source journal must remain byte-for-byte unchanged');

if(previousOverride===undefined)delete process.env.ACCESS_AGENT_TRANSPORT_JOURNAL_FILE;
else process.env.ACCESS_AGENT_TRANSPORT_JOURNAL_FILE=previousOverride;

console.log(JSON.stringify({
acceptance:'r3-ambiguous-durable-recovery',
sourceJournal:sourceFile,
isolatedJournal:isolatedFile,
instructionKey,
priorState:latest.state,
disposition:receipt.disposition,
receiptId:receipt.receiptId,
originalEvidencePreserved:true,
productionJournalUnchanged:true,
restartProjectionPreserved:true,
 relayExecutionInvoked:false,
},null,2));
