'use strict';

const assert=require('node:assert/strict');
const ToolRegistry=require('../src/agent/ToolRegistry');
const {LiveAgentCore}=require('../src/agent/executive/LiveAgentCore');

(async()=>{
  const calls=[];
  const registry=new ToolRegistry([
    {name:'readFile',description:'read one file',category:'investigate',readOnly:true,schema:{type:'object',properties:{path:{type:'string'}},required:['path']},execute:async(_ctx,args)=>{calls.push(['readFile',args.path]);const error=new Error('File does not exist');error.code='ENOENT';throw error;}},
    {name:'searchFiles',description:'search workspace',category:'investigate',readOnly:true,schema:{type:'object',properties:{query:{type:'string'}},required:['query']},execute:async(_ctx,args)=>{calls.push(['searchFiles',args.query]);return{ok:true,matches:[{path:'src/runtime-owner.js'}]};}},
  ]);
  let turn=0;
  const seen=[];
  const provider={
    async complete({messages}){
      seen.push(JSON.parse(JSON.stringify(messages)));
      turn+=1;
      if(turn===1)return{content:'I will inspect the referenced document first.',toolCalls:[{id:'tc-read',name:'readFile',arguments:{path:'docs/missing.md'}}]};
      if(turn===2){
        const tool=[...messages].reverse().find(message=>message.role==='tool');
        assert.ok(tool,'failed tool observation must return to the model');
        const parsed=JSON.parse(tool.content);
        assert.equal(parsed.observation,'NOT_FOUND');
        assert.equal(parsed.error.code,'ENOENT');
        return{content:'The document is absent. I will search the active workspace for the runtime owner instead.',toolCalls:[{id:'tc-search',name:'searchFiles',arguments:{query:'runtime owner'}}]};
      }
      return{content:'Found the active runtime owner through workspace search and continued using available evidence.',toolCalls:[]};
    },
  };
  const execution=[];
  const agent=new LiveAgentCore({registry,provider,maxToolCalls:6});
  const result=await agent.step({sessionId:'adaptive-session',stepId:'adaptive-step',turnId:'adaptive-turn',objective:'Inspect the missing architecture file and determine the active runtime owner in the workspace.',pendingInstructions:[{instructionId:'instruction-adaptive',text:'Inspect the missing architecture file and determine the active runtime owner in the workspace.'}],emitExecutionEvent:async event=>{execution.push(event);return{data:event};},emitAgentEvent:async()=>{}});
  assert.equal(result.status,'completed');
  assert.deepEqual(calls,[['readFile','docs/missing.md'],['searchFiles','runtime owner']]);
  assert.ok(execution.some(event=>event.toolCallId==='tc-read'&&event.phase==='recovering'),'missing first tool must remain visible recovery evidence');
  assert.ok(execution.some(event=>event.toolCallId==='tc-search'&&event.status==='completed'),'alternate successful tool must execute');
  assert.match(result.summary,/continued using available evidence/u);
  assert.ok(seen.length>=3);
  console.log('rebuild-adaptive-agent-continuation-smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
