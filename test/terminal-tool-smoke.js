'use strict';

const assert=require('node:assert/strict');
const {LiveAgentCore}=require('../src/agent/executive/LiveAgentCore');

const commonObjective='Run the governed command, then decide the result.';

function terminalRegistry(terminal){
  return {
    capabilityManifest:()=>[{name:'runCommand',category:'validate',readOnly:false}],
    openAiTools:()=>[{type:'function',function:{name:'runCommand',parameters:{type:'object',properties:{command:{type:'string'}}}}}],
    execute:async()=>terminal
      ? {ok:false,output:{ok:false,observation:'BLOCKED',code:'CHANGE_GOVERNANCE_BLOCKED',error:{code:'CHANGE_GOVERNANCE_BLOCKED',message:'Governance denied the mutation.',terminal:true,retryable:false}},evidence:{verified:false,governance:true}}
      : {ok:false,output:{ok:false,observation:'FAILED',error:{code:'TOOL_EXECUTION_FAILED',message:'temporary failure',terminal:false,retryable:true}},evidence:{verified:false}},
  };
}

function sequenceProvider(sequence){
  const provider={calls:0,complete:async()=>{
    provider.calls+=1;
    const step=sequence[Math.min(provider.calls-1,sequence.length-1)];
    if(step.toolCall)return{content:'',toolCalls:[{id:`tool-${provider.calls}`,name:step.toolCall,arguments:{command:'build'}}]};
    return{content:step.content,};
  }};
  return provider;
}

(async()=>{
  // A terminal tool result must terminate the current objective immediately
  // as BLOCKED instead of decaying into tool-budget exhaustion (maxToolCalls
  // defaults to 40, so a single terminal result must stop on call one).
  const terminalProvider=sequenceProvider([{toolCall:'runCommand'},{content:'unused'}]);
  const terminalCore=new LiveAgentCore({registry:terminalRegistry(true),provider:terminalProvider});
  const terminalResult=await terminalCore.step({sessionId:'terminal-tool',objective:commonObjective});
  assert.equal(terminalProvider.calls,1,'terminal result must not consume the remaining tool budget');
  assert.equal(terminalResult.status,'blocked');
  assert.equal(terminalResult.blocker,'terminal_tool');
  assert.match(terminalResult.reason,/terminal tool "runCommand" returned CHANGE_GOVERNANCE_BLOCKED/iu);
  assert.match(terminalResult.reason,/instead of exhausting the tool budget/iu);
  assert.equal(terminalResult.consumeInstructions,false);

  // A non-terminal failure must NOT trigger the terminal block; control returns
  // to the model so it can adapt.
  const recoverProvider=sequenceProvider([{toolCall:'runCommand'},{content:'adapted and done'}]);
  const recoverCore=new LiveAgentCore({registry:terminalRegistry(false),provider:recoverProvider});
  const recoverResult=await recoverCore.step({sessionId:'recover-tool',objective:commonObjective});
  assert.equal(recoverProvider.calls,2,'non-terminal failure must allow adaptation');
  assert.equal(recoverResult.status,'completed');

  console.log('terminal tool governance smoke passed');
})().catch(error=>{console.error(error);process.exitCode=1;});