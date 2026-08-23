// CRITICAL_TRIAGE: see docs/change-intents/2026-08-23-orphan-triage.md
// This file is flagged for behavior verification before any keep/wire/delete decision.
// Do not delete or change behavior without first recording a check result in the triage doc.

'use strict';

const assert=require('node:assert/strict');
const {
  renderedEnvelopeIdentity,
  renderedMessageMatchesIdentity,
  renderedMarker,
}=require('../src/browser/observable-browser-runtime');

const instructionId='turn-f32b28a624bff43d';
const resultSha='3a8a266d515ce5f192d1a37fbd1dba46f8bd49823cd1af362f55e402bc788aa5';
const raw=`=== ACCESS AGENT RESULT START ===
INSTRUCTION ID: ${instructionId}
STATUS: COMPLETE
MODEL REPORT:
**Repository Status Audit – Adobe_AI_Generations-04**
- **Current branch**: \`salvage/agent-registry-clean\` (from \`.git/HEAD\`)
RESULT RECORD SHA256: ${resultSha}
NEXT STATE: completed
=== ACCESS AGENT RESULT END ===`;

const rendered=`=== ACCESS AGENT RESULT START ===
INSTRUCTION ID: ${instructionId}
STATUS: COMPLETE
MODEL REPORT:
**Repository Status Audit – Adobe_AI_Generations-04**
- **Current branch**: salvage/agent-registry-clean (from .git/HEAD)
RESULT RECORD SHA256: ${resultSha}
NEXT STATE: completed
=== ACCESS AGENT RESULT END ===
Show less`;

const identity=renderedEnvelopeIdentity(raw);
assert.deepEqual(identity,{
  startMarker:'=== ACCESS AGENT RESULT START ===',
  instructionId,
  resultRecordSha256:resultSha,
});
assert.equal(renderedMessageMatchesIdentity(rendered,identity),true,'rendered ChatGPT innerText must correlate even when Markdown code spans are transformed');
assert.match(renderedMarker(raw),/^=== ACCESS AGENT RESULT START === INSTRUCTION ID: turn-f32b28a624bff43d/u);

const wrongInstruction=rendered.replace(instructionId,'turn-other');
assert.equal(renderedMessageMatchesIdentity(wrongInstruction,identity),false,'a different instruction ID must not verify');

const wrongSha=rendered.replace(resultSha,'4'.repeat(64));
assert.equal(renderedMessageMatchesIdentity(wrongSha,identity),false,'a different result-record SHA must not verify');

const missingSha=rendered.replace(`RESULT RECORD SHA256: ${resultSha}\n`,'');
assert.equal(renderedMessageMatchesIdentity(missingSha,identity),false,'a required result-record SHA must not disappear during verification');

console.log('rendered-delivery-envelope-identity-smoke: PASS');
