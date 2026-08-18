'use strict';

const assert=require('node:assert/strict');
const ToolRegistry=require('../src/agent/ToolRegistry');

(async()=>{
  let commandCalls=0;
  let workspaceCalls=0;
  const registry=new ToolRegistry();
  registry.register('runCommand','exact governed terminal',{type:'object',properties:{command:{type:'string'}}},async()=>{
    commandCalls+=1;
    const error=new Error("Command 'rg' is outside the governed executable set.");
    error.code='COMMAND_NOT_ALLOWLISTED';
    throw error;
  });
  const workspace={
    gitStatus:async()=>{workspaceCalls+=1;return{ok:true};},
    list:async()=>{workspaceCalls+=1;return{ok:true};},
    search:async()=>{workspaceCalls+=1;return{ok:true};},
    inspect:async()=>{workspaceCalls+=1;return{ok:true};},
  };
  const result=await registry.execute('runCommand',{command:'rg BrowserLoopController .'},{workspace});
  assert.equal(result.ok,false);
  assert.equal(commandCalls,1,'the requested tool executes exactly once');
  assert.equal(workspaceCalls,0,'a denied command must never be replaced by another workspace operation');
  assert.equal(result.output.observation,'FAILED');
  assert.equal(result.output.error.code,'COMMAND_NOT_ALLOWLISTED');
  assert.match(result.output.error.message,/outside the governed executable set/u);
  assert.equal('fallback' in result.output,false);
  console.log('tool no-substitution smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
