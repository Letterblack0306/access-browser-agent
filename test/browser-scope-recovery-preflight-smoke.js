'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {BrowserInstructionRelay,assistantTurnFromSnapshot}=require('../src/agent/executive/BrowserInstructionRelay');
const {BrowserTransportJournal}=require('../src/system/browser-transport-journal');

const workspaceRoot='G:\\Demo';
const conversationId='https://chatgpt.com/c/scope-recovery';
const target={targetId:'tab-new',providerId:'chatgpt',url:conversationId};
const snap=(text,messageIndex,messageId)=>({
  targetId:target.targetId,
  providerId:target.providerId,
  text,
  generating:false,
  url:conversationId,
  provenance:{verifiedAssistant:true,messagePresent:true,messageIndex,messageId},
});

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'scope-recovery-'));
  const journal=new BrowserTransportJournal(path.join(temp,'transport.jsonl'));

  const historicalSnapshot=snap('Historical side-effecting turn A.',1,'historical-a');
  const historical=assistantTurnFromSnapshot(historicalSnapshot);
  const historicalInput={
    workspaceRoot,
    conversationId,
    targetId:'tab-old',
    instructionId:historical.instructionId,
    transportKey:historical.transportKey,
    raw:historical.raw,
  };
  const historicalRecord=journal.observe(historicalInput);
  journal.markExecuting(historicalInput,{type:'agent_instruction'});

  const safeSnapshot=snap('Known consumed delivery response.',2,'safe-consumed');
  const safe=assistantTurnFromSnapshot(safeSnapshot);
  const safeInput={workspaceRoot,conversationId,targetId:'tab-old',instructionId:safe.instructionId,transportKey:safe.transportKey,raw:safe.raw};
  journal.observe(safeInput);
  journal.markConsumed(safeInput,{disposition:'delivery_response'});

  const unresolved=journal.listUnresolvedRecoveries({workspaceRoot,conversationId});
  assert.equal(unresolved.length,1,'scope discovery must return only unreconciled ambiguous records');
  assert.equal(unresolved[0].key,historicalRecord.key);
  assert.equal(unresolved[0].record.instructionId,historical.instructionId);

  const currentSnapshot=snap('Newer currently visible turn B.',9,'current-b');
  const events=[];
  let submissions=0;
  const relay=new BrowserInstructionRelay({
    channel:{
      snapshot:async()=>currentSnapshot,
      send:async()=>({accepted:true}),
      expectedUrlFor:()=>conversationId,
    },
    getEndpoint:()=> 'http://127.0.0.1:7330',
    getWorkspaceRoot:()=>workspaceRoot,
    submitInstruction:async()=>{submissions+=1;return{ok:true,terminalState:'completed',summary:'must not run while historical recovery is unresolved'};},
    journal,
    onEvent:event=>events.push(event),
  });
  relay._schedule=()=>{};
  relay.selectTarget(target);

  await assert.rejects(
    ()=>relay.start({recoveryOnly:true}),
    error=>error.code==='INSTRUCTION_RECOVERY_REQUIRED',
    'recovery preflight must fail closed on historical unresolved A even when newer B is visible',
  );
  assert.equal(submissions,0,'scope recovery preflight must not submit newer visible work');
  assert.equal(relay.status().lifecycle,'recovery');
  const blocked=events.find(event=>event.phase==='browser_relay.instruction_recovery_required');
  assert.ok(blocked,'scope recovery must emit the existing operator-recovery event');
  assert.equal(blocked.instructionId,historical.instructionId);
  assert.equal(blocked.journalKey,historicalRecord.key);
  assert.equal(blocked.journalState,'executing');
  assert.equal(blocked.recovery?.ambiguous,true);

  journal.reconcileRecovery({
    key:historicalRecord.key,
    workspaceRoot,
    conversationId,
    disposition:'abandoned',
    reason:'Regression proves historical execution is explicitly abandoned before newer work may start.',
    operator:'smoke-test',
  });
  assert.equal(journal.listUnresolvedRecoveries({workspaceRoot,conversationId}).length,0,'explicit reconciliation must clear the scope-level recovery blocker');

  const resumedEvents=[];
  const resumed=new BrowserInstructionRelay({
    channel:{snapshot:async()=>currentSnapshot,send:async()=>({accepted:true}),expectedUrlFor:()=>conversationId},
    getEndpoint:()=> 'http://127.0.0.1:7330',
    getWorkspaceRoot:()=>workspaceRoot,
    submitInstruction:async()=>{submissions+=1;return{ok:true,terminalState:'completed',summary:'not executed by recovery-only preflight'};},
    journal,
    onEvent:event=>resumedEvents.push(event),
  });
  resumed._schedule=()=>{};
  resumed.selectTarget(target);
  const preflight=await resumed.start({recoveryOnly:true});
  assert.equal(preflight.ok,true);
  assert.equal(preflight.recoveryRequired,false);
  assert.equal(resumed.status().running,false,'recovery-only preflight must remain read-only');
  assert.equal(resumed.status().lifecycle,'checking_provider','successful recovery-only preflight must remain non-terminal while provider readiness is being resolved');
  assert.equal(preflight.lifecycle,'checking_provider','returned preflight status must not project a terminal stopped lifecycle');
  assert.equal(submissions,0,'successful recovery-only preflight must still execute zero work');
  assert.equal(resumedEvents.some(event=>event.phase==='browser_relay.instruction_recovery_required'),false);

  console.log('browser-scope-recovery-preflight-smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
