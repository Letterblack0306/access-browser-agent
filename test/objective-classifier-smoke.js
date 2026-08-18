'use strict';

const assert=require('node:assert/strict');
const {LiveAgentCore,classifyObjective,requiredToolEvidence}=require('../src/agent/executive/LiveAgentCore');

const objective='Inspect package.json, run tests, then decide what evidence is actually useful.';
assert.deepEqual(requiredToolEvidence(objective),[],'external keyword parsing must not prescribe required capabilities');
assert.deepEqual(classifyObjective(objective),{
  capabilities:[],operations:[],requiresWorkspace:false,requiresUserInput:false,allowedMutations:[],forbiddenActions:[],
});

(async()=>{
  let calls=0;
  const registry={
    capabilityManifest:()=>[{name:'readFile',category:'investigate',readOnly:true}],
    openAiTools:()=>[{type:'function',function:{name:'readFile',parameters:{type:'object',properties:{}}}}],
    execute:async()=>({ok:true,output:{ok:true,path:'README.md'},evidence:{verified:true}}),
  };
  const provider={complete:async()=>{calls+=1;return{content:'',toolCalls:[{id:`tool-${calls}`,name:'readFile',arguments:{}}]};}};
  const core=new LiveAgentCore({registry,provider,maxToolCalls:1});
  const result=await core.step({sessionId:'budget-test',objective});
  assert.equal(result.status,'blocked');
  assert.equal(result.blocker,'tool_budget');
  assert.match(result.reason,/tool-call budget exhausted/iu);
  assert.equal(result.consumeInstructions,false);
  console.log('objective classifier inactive smoke passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
