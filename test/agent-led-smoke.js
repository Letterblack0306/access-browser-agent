'use strict';

const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs/promises');
const AgentSessionRuntime=require('../src/agent/executive/AgentSessionRuntime');
const {LiveAgentCore,SYSTEM_PROMPT,executionPhaseForTool,capabilityPrompt,requiredToolEvidence}=require('../src/agent/executive/LiveAgentCore');
const ToolRegistry=require('../src/agent/ToolRegistry');

class StubProvider{
  constructor(sequences){this.sequences=[...sequences];this.calls=[];}
  async complete({messages,tools}){this.calls.push({messages:JSON.parse(JSON.stringify(messages)),tools});return this.sequences.shift()||{content:'NO MORE',toolCalls:[]};}
}

(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'access-agent-led-'));
  assert.match(SYSTEM_PROMPT,/reasoning engineering agent/u);
  assert.match(SYSTEM_PROMPT,/failed tool call is not automatically a failed objective/u);
  assert.match(SYSTEM_PROMPT,/no mandatory semantic Plan -> Approve -> Execute sequence/u);
  assert.match(SYSTEM_PROMPT,/Never expose private chain-of-thought/u);
  assert.deepEqual(requiredToolEvidence('Inspect the workspace and run tests.'),[],'keywords must not prescribe semantic completion evidence');
  assert.equal(executionPhaseForTool('readFile'),'investigating');
  assert.equal(executionPhaseForTool('applyPatch'),'editing');
  assert.equal(executionPhaseForTool('runCommand'),'validating');

  const calls=[];
  const registry=new ToolRegistry();
  registry.register('echo','Echo a value.',{type:'object',properties:{value:{type:'string'}}},async(_ctx,args)=>{calls.push(args.value);return{ok:true,echoed:args.value};},{category:'investigate',readOnly:true});
  assert.match(capabilityPrompt(registry),/echo \[investigate; read-only\]/u);
  assert.doesNotMatch(capabilityPrompt(registry),/approval/u);

  const provider=new StubProvider([
    {content:'Checking the actual tool.',toolCalls:[{id:'c1',name:'echo',arguments:{value:'hello'}}]},
    {content:'DONE from observed evidence.',toolCalls:[]},
  ]);
  const phases=[];
  const agent=new LiveAgentCore({registry,provider,ctx:{},maxToolCalls:10});
  const runtime=new AgentSessionRuntime({workspaceRoot:root,stepRunnerFactory:({sessionId})=>stepContext=>agent.step({...stepContext,sessionId,emitExecutionEvent:async event=>{phases.push(event);return{data:event};}})});
  const accepted=await runtime.submitInstruction({instruction:'Say hi.'});
  const state=await accepted.runPromise;
  assert.equal(state.status,'completed');
  assert.equal(state.completion.summary,'DONE from observed evidence.');
  assert.deepEqual(calls,['hello']);
  assert.ok(phases.some(event=>event.type==='execution.tool.completed'));

  const adaptiveCalls=[];
  const adaptiveRegistry=new ToolRegistry([
    {name:'readFile',description:'read',schema:{type:'object'},execute:async()=>{adaptiveCalls.push('read');const error=new Error('missing');error.code='ENOENT';throw error;}},
    {name:'searchFiles',description:'search',schema:{type:'object'},execute:async()=>{adaptiveCalls.push('search');return{ok:true,matches:[{path:'src/owner.js'}]};}},
  ]);
  let turn=0;
  const adaptiveProvider=new StubProvider([]);
  adaptiveProvider.complete=async({messages})=>{
    turn+=1;
    if(turn===1)return{content:'Inspecting the referenced file.',toolCalls:[{id:'r1',name:'readFile',arguments:{path:'missing.md'}}]};
    if(turn===2){
      const tool=[...messages].reverse().find(message=>message.role==='tool');
      const observation=JSON.parse(tool.content);
      assert.equal(observation.observation,'NOT_FOUND');
      assert.equal(observation.error.code,'ENOENT');
      return{content:'That file is absent; searching the active workspace instead.',toolCalls:[{id:'s1',name:'searchFiles',arguments:{query:'owner'}}]};
    }
    return{content:'Found the owner through alternate evidence.',toolCalls:[]};
  };
  const adaptive=new LiveAgentCore({registry:adaptiveRegistry,provider:adaptiveProvider,maxToolCalls:5});
  const adaptiveResult=await adaptive.step({sessionId:'adaptive',objective:'Find the owner.'});
  assert.equal(adaptiveResult.status,'completed');
  assert.deepEqual(adaptiveCalls,['read','search']);
  assert.match(adaptiveResult.summary,/alternate evidence/u);

  // Reproduce the real AgentSessionRuntime -> AgentExecutive -> AgentEventStore ->
  // ExecutionEventSchema path. The first tool returns a NOT_FOUND observation;
  // that observation belongs to tool-result evidence, never execution status.
  const boundaryEvents=[];
  const boundaryProvider=new StubProvider([
    {content:'Checking the missing path.',toolCalls:[{id:'boundary-read',name:'readFile',arguments:{path:'missing.md'}}]},
    {content:'Continuing after the observation.',toolCalls:[{id:'boundary-search',name:'searchFiles',arguments:{query:'owner'}}]},
    {content:'Boundary path completed.',toolCalls:[]},
  ]);
  const boundaryAgent=new LiveAgentCore({registry:adaptiveRegistry,provider:boundaryProvider,maxToolCalls:5});
  const boundaryRuntime=new AgentSessionRuntime({
    workspaceRoot:root,
    stateRoot:path.join(root,'boundary-state'),
    onEvent:event=>boundaryEvents.push(event),
    stepRunnerFactory:({sessionId})=>stepContext=>boundaryAgent.step({...stepContext,sessionId}),
  });
  const boundaryAccepted=await boundaryRuntime.submitInstruction({instruction:'Find the owner through the browser-owned task path.'});
  const boundaryState=await boundaryAccepted.runPromise;
  assert.equal(boundaryState.status,'completed','non-success tool observations must not abort the execution-event pipeline');
  const completedEvents=boundaryEvents.filter(event=>event.type==='execution.tool.completed').map(event=>event.data);
  assert.equal(completedEvents.length,2);
  assert.ok(completedEvents.every(event=>event.status==='completed'),'execution.tool.completed must stay in the execution lifecycle domain');
  const missingObservation=completedEvents.find(event=>event.toolCallId==='boundary-read');
  assert.equal(missingObservation.outputSummary.observation,'NOT_FOUND','tool observation remains available as evidence');
  assert.notEqual(missingObservation.status,'observed','tool observation must never become execution status');

  const proseOnly=new LiveAgentCore({registry:new ToolRegistry(),provider:new StubProvider([{content:'Current status based only on available conversation context.',toolCalls:[]}])});
  const prose=await proseOnly.step({sessionId:'prose',objective:'Report what you know.'});
  assert.equal(prose.status,'completed');
  assert.deepEqual(prose.evidence,[],'model prose must never fabricate runtime evidence');

  console.log('Agent-led adaptive smoke PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
