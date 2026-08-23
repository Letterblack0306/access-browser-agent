// CRITICAL_TRIAGE: see docs/change-intents/2026-08-23-orphan-triage.md
// This file is flagged for behavior verification before any keep/wire/delete decision.
// Do not delete or change behavior without first recording a check result in the triage doc.

'use strict';

const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs');

const journalPath=path.join(os.tmpdir(),`access-agent-ui-acceptance-${process.pid}-${Date.now()}.jsonl`);
process.env.ACCESS_AGENT_TRANSPORT_JOURNAL_FILE=journalPath;
console.log(`ACCEPTANCE_TRANSPORT_JOURNAL=${journalPath}`);

process.once('exit',()=>{
  try{fs.unlinkSync(journalPath);}catch(error){if(error?.code!=='ENOENT')console.error(`ACCEPTANCE_JOURNAL_CLEANUP_FAILED: ${error.message}`);}
});

require('./ui-state-driven-acceptance-v2.js');
