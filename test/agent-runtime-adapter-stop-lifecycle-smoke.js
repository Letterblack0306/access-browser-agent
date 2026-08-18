'use strict';

const assert=require('node:assert/strict');
const {AgentRuntimeAdapter}=require('../electron/agent-runtime-adapter');

(async()=>{
  const completed=Object.create(AgentRuntimeAdapter.prototype);
  let completedStopCalls=0;
  completed.service={
    status:async()=>({running:false,status:'completed',sessionId:'session-completed',turnId:'session-completed'}),
    stop:async()=>{completedStopCalls+=1;throw new Error('completed session must not be terminalized');},
  };
  const preserved=await completed.stop('session-completed');
  assert.equal(preserved.ok,true);
  assert.equal(preserved.skipped,true);
  assert.equal(preserved.status,'completed');
  assert.equal(preserved.sessionId,'session-completed');
  assert.equal(completedStopCalls,0,'runtime shutdown must preserve a completed durable session');

  const running=Object.create(AgentRuntimeAdapter.prototype);
  let runningStopCalls=0;
  running.service={
    status:async()=>({running:true,status:'running',sessionId:'session-running',turnId:'session-running'}),
    stop:async id=>{runningStopCalls+=1;assert.equal(id,'session-running');return{ok:true,status:'stopped',sessionId:id};},
  };
  const stopped=await running.stop('session-running');
  assert.equal(stopped.status,'stopped');
  assert.equal(runningStopCalls,1,'an in-flight session must still use the authoritative stop path exactly once');

  console.log('agent-runtime-adapter-stop-lifecycle-smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
