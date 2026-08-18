'use strict';

const assert=require('node:assert/strict');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const CDP=require('chrome-remote-interface');
const electronExecutable=require('electron');

const HOST='127.0.0.1';
const TIMEOUT_MS=Number(process.env.ACCESS_AGENT_ACCEPTANCE_STEP_TIMEOUT_MS||30000);
const projectRoot=path.resolve(__dirname,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.unref();server.once('error',reject);server.listen(0,HOST,()=>{const address=server.address();server.close(error=>error?reject(error):resolve(address.port));});});}
async function wait(read,description){const deadline=Date.now()+TIMEOUT_MS;let latest=null;while(Date.now()<deadline){try{latest=await read();if(latest)return latest;}catch{}await delay(150);}throw Object.assign(new Error(`Timed out waiting for ${description}`),{code:'ACCEPTANCE_STEP_TIMEOUT',actual:latest});}
async function rendererTarget(port){return wait(async()=>{const targets=await CDP.List({host:HOST,port});return targets.find(target=>target.type==='page'&&/rebuild|index\.html|access/iu.test(`${target.url||''} ${target.title||''}`));},'Access renderer');}
async function evaluate(client,expression){const result=await client.Runtime.evaluate({expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||'Renderer evaluation failed.');return result.result.value;}
async function api(client,method,args=[]){return evaluate(client,`(async()=>{try{return{ok:true,value:await window.accessIde[${JSON.stringify(method)}](...${JSON.stringify(args)})};}catch(error){return{ok:false,error:{message:error?.message||String(error),code:error?.code||null}};}})()`);}

(async()=>{
  const port=await freePort();
  const output=[];
  let child=null,renderer=null;
  try{
    child=spawn(electronExecutable,[`--remote-debugging-port=${port}`,projectRoot],{cwd:projectRoot,env:{...process.env,ACCESS_AGENT_UI_ACCEPTANCE:'1'},windowsHide:false,stdio:['ignore','pipe','pipe']});
    child.stdout?.on('data',chunk=>output.push(String(chunk)));child.stderr?.on('data',chunk=>output.push(String(chunk)));
    const target=await rendererTarget(port);renderer=await CDP({host:HOST,port,target:target.id});await renderer.Runtime.enable();
    await wait(async()=>evaluate(renderer,"document.readyState==='complete'&&Boolean(window.accessIde?.browserStart&&window.accessIde?.browserOpenExactChat)"),'renderer browser API');
    const started=await api(renderer,'browserStart');assert.equal(started.ok,true,started.error?.message);
    const browser=started.value?.browser||started.value;const endpoint=String(browser?.endpoint||'');assert.ok(endpoint,'managed Chrome endpoint missing');
    const preferences=await api(renderer,'preferences');assert.equal(preferences.ok,true,preferences.error?.message);
    const configured=String(process.env.ACCESS_AGENT_ACCEPTANCE_CHAT_URL||preferences.value?.browserChatUrl||preferences.value?.browserProviderTarget?.url||'').trim();
    if(!configured){const error=new Error('Set ACCESS_AGENT_ACCEPTANCE_CHAT_URL or save one exact ChatGPT conversation URL.');error.code='ACCEPTANCE_CHAT_URL_REQUIRED';throw error;}
    const opened=await api(renderer,'browserOpenExactChat',[{endpoint,chatUrl:configured}]);assert.equal(opened.ok,true,opened.error?.message);assert.equal(opened.value?.ok,true,opened.value?.error?.message);
    const endpointUrl=new URL(endpoint);const targets=await CDP.List({host:endpointUrl.hostname,port:Number(endpointUrl.port)});
    const pages=targets.filter(item=>item.type==='page').map(item=>({targetId:String(item.id),url:String(item.url||''),title:String(item.title||'')}));
    const providerTargetId=String(opened.value.target?.targetId||'');assert.ok(pages.some(page=>page.targetId===providerTargetId),'verified provider target missing');
    const statusResult=await api(renderer,'status');assert.equal(statusResult.ok,true,statusResult.error?.message);
    assert.equal(statusResult.value?.browser?.bootstrapTargetId,null,'bootstrap ownership must be cleared after provider verification');
    const bootstrapPages=pages.filter(page=>/^data:text\/html;charset=utf-8,<title>Access%20Agent%20bootstrap%20\d+<\/title>$/u.test(page.url));
    assert.equal(bootstrapPages.length,0,'owned bootstrap page remains visible');
    console.log(JSON.stringify({acceptance:'managed-chrome-bootstrap-retirement',status:'VISIBLE_ACCEPTANCE_PASSED',providerTargetId,pageCount:pages.length,bootstrapPages:bootstrapPages.length,relayStarted:false,submissionAttempted:false,pages},null,2));
    await api(renderer,'browserStop');
  }finally{
    if(renderer)await renderer.close().catch(()=>{});
    if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  }
})().catch(error=>{console.error(JSON.stringify({acceptance:'managed-chrome-bootstrap-retirement',status:'FAIL',code:error.code||error.name,message:error.message},null,2));process.exitCode=1;});
