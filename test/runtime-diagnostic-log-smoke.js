'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RuntimeDiagnosticLog,SUPPRESSED_DIAGNOSTIC}=require('../src/system/runtime-diagnostic-log');
const {setDiagnosticSink,subscribeDiagnostic,emitDiagnostic}=require('../src/system/runtime-diagnostic-bus');

(()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'access-diagnostic-coalesce-'));
  let now=Date.parse('2026-08-15T00:00:00.000Z');
  const clock=()=>new Date(now).toISOString();
  const log=new RuntimeDiagnosticLog({root,sessionId:'coalesce-test',clock,clockMs:()=>now,duplicateWindowMs:15000});
  const input={source:'poller',category:'status',action:'refresh',phase:'success',data:{state:'ready'},correlation:{operationId:'op-1'}};
  const first=log.write(input);
  assert.equal(first.seq,1);
  const duplicate=log.write(input);
  assert.equal(duplicate,SUPPRESSED_DIAGNOSTIC,'identical evidence inside the coalescing window must be handled without appending');
  assert.equal(log.info().seq,1,'suppressed duplicate must not advance sequence');

  const changed=log.write({...input,data:{state:'degraded'}});
  assert.equal(changed.seq,2,'material state change must append immediately');

  now+=16000;
  const recurrence=log.write(input);
  assert.equal(recurrence.seq,3);
  assert.equal(recurrence.repeat?.suppressed,1,'next emitted recurrence must retain suppressed-count evidence');
  assert.equal(log.readRecent(20).length,3);

  setDiagnosticSink(log);
  const seen=[];
  const unsubscribe=subscribeDiagnostic(record=>seen.push(record));
  now+=100;
  const busFirst=emitDiagnostic({source:'bus',category:'status',action:'same',phase:'success',data:{ok:true}});
  const busDuplicate=emitDiagnostic({source:'bus',category:'status',action:'same',phase:'success',data:{ok:true}});
  assert.notEqual(busFirst?.suppressed,true,'first bus event must be emitted normally');
  assert.equal(busDuplicate?.suppressed,true,'duplicate bus event must be marked handled/suppressed');
  assert.equal(seen.length,1,'suppressed diagnostic must not be broadcast to the UI');
  unsubscribe();
  setDiagnosticSink(null);

  const preload=fs.readFileSync(path.join(__dirname,'..','electron','preload.js'),'utf8');
  assert.match(preload,/QUIET_SUCCESS_IPC/u);
  assert.match(preload,/'ide:status'/u);
  assert.match(preload,/'ide:diagnostic-recent'/u);
  assert.match(preload,/'ide:terminal-write'/u);
  assert.match(preload,/if \(!quiet\) diagnostic\(\{ source:'preload', category:'ipc', action:channel, phase:'success'/u);
  assert.match(preload,/phase:'failed'[\s\S]*quietObservation:quiet/u,'quiet observations must still log failures');

  console.log('Runtime diagnostic coalescing smoke PASS');
})();
