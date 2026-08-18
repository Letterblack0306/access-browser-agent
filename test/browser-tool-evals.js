'use strict';

const assert = require('node:assert/strict');
const { BrowserToolRuntime, normalizeWebUrl } = require('../src/browser/browser-tool-runtime');
const { buildLiveToolContext } = require('../src/agent/executive/LiveToolContext');
const { createFakeCdp } = require('./browser-tool-runtime-smoke');

function grade(name, fn) {
  return Promise.resolve().then(fn).then(
    detail=>({name,pass:true,detail:detail||null}),
    error=>({name,pass:false,error:error?.message||String(error),code:error?.code||null}),
  );
}

async function run() {
  const cases=[];

  cases.push(await grade('url-policy-http-https-only',async()=>{
    assert.equal(normalizeWebUrl('https://example.com/'),'https://example.com/');
    assert.throws(()=>normalizeWebUrl('file:///etc/passwd'),error=>error?.code==='BROWSER_URL_SCHEME_BLOCKED');
    assert.throws(()=>normalizeWebUrl('https://user:secret@example.com/'),error=>error?.code==='BROWSER_URL_CREDENTIALS_BLOCKED');
    return{policy:'http_https_only_no_url_credentials'};
  }));

  cases.push(await grade('agent-tool-manifest-exposes-browser-capabilities',async()=>{
    delete global.__accessAgentBrowserToolRuntime;
    const {registry}=buildLiveToolContext({workspaceRoot:process.cwd()});
    const manifest=registry.capabilityManifest();
    const names=new Set(manifest.map(item=>item.name));
    const expected=['browserOpen','browserTabs','browserNavigate','browserSnapshot','browserClick','browserType','browserScroll','browserClose'];
    for(const name of expected)assert.equal(names.has(name),true,`missing ${name}`);
    for(const name of expected)assert.equal(manifest.find(item=>item.name===name)?.category,'browser');
    const unavailable=await registry.execute('browserTabs',{},{});
    assert.equal(unavailable.ok,false);
    assert.equal(unavailable.output.code,'BROWSER_RUNTIME_UNAVAILABLE');
    return{tools:expected,unavailableObservation:unavailable.output.code};
  }));

  const harness=createFakeCdp();
  const runtime=new BrowserToolRuntime({cdpFactory:harness.factory,getEndpoint:async()=> 'http://127.0.0.1:9222',readinessTimeoutMs:500,pollIntervalMs:5});
  const {registry}=buildLiveToolContext({workspaceRoot:process.cwd(),browserRuntime:runtime});

  cases.push(await grade('transport-target-isolation',async()=>{
    const result=await registry.execute('browserNavigate',{targetId:'chat-transport',url:'https://example.com/'},{});
    assert.equal(result.ok,false);
    assert.equal(result.output.error.code,'BROWSER_TARGET_NOT_OWNED');
    assert.equal(harness.pages.get('chat-transport').url,'https://chatgpt.com/c/transport');
    return{blockedCode:result.output.error.code,transportUrl:harness.pages.get('chat-transport').url};
  }));

  let ownedTargetId=null;
  cases.push(await grade('open-and-snapshot-evidence',async()=>{
    const opened=await registry.execute('browserOpen',{url:'https://example.com/start'},{});
    assert.equal(opened.ok,true);
    ownedTargetId=opened.output.targetId;
    const snapshot=await registry.execute('browserSnapshot',{targetId:ownedTargetId},{});
    assert.equal(snapshot.ok,true);
    assert.match(snapshot.output.text,/Body for/u);
    assert.equal(snapshot.output.interactive.some(item=>item.ref==='aa-1'),true);
    return{targetId:ownedTargetId,textLength:snapshot.output.text.length,interactiveCount:snapshot.output.interactive.length};
  }));

  cases.push(await grade('interaction-evidence-does-not-overclaim',async()=>{
    assert.ok(ownedTargetId);
    const clicked=await registry.execute('browserClick',{targetId:ownedTargetId,ref:'aa-1'},{});
    assert.equal(clicked.ok,true);
    assert.equal(clicked.output.verifiedActionDispatch,true);
    assert.equal(clicked.output.downstreamOutcome,'UNVERIFIED');
    await registry.execute('browserSnapshot',{targetId:ownedTargetId},{});
    const typed=await registry.execute('browserType',{targetId:ownedTargetId,ref:'aa-2',text:'hello'},{});
    assert.equal(typed.ok,true);
    assert.equal(typed.output.submitted,false);
    const scrolled=await registry.execute('browserScroll',{targetId:ownedTargetId,y:400},{});
    assert.equal(scrolled.ok,true);
    return{clickOutcome:clicked.output.downstreamOutcome,typeSubmitted:typed.output.submitted,scrollY:scrolled.output.scrollY};
  }));

  cases.push(await grade('owned-navigation-and-close-preserve-transport',async()=>{
    assert.ok(ownedTargetId);
    const navigated=await registry.execute('browserNavigate',{targetId:ownedTargetId,url:'https://example.org/final'},{});
    assert.equal(navigated.ok,true);
    assert.equal(navigated.output.url,'https://example.org/final');
    const closed=await registry.execute('browserClose',{targetId:ownedTargetId},{});
    assert.equal(closed.ok,true);
    assert.equal(harness.pages.has(ownedTargetId),false);
    assert.equal(harness.pages.has('chat-transport'),true);
    return{closedTarget:ownedTargetId,transportPreserved:true};
  }));

  const passed=cases.filter(item=>item.pass).length;
  const report={
    eval:'general-browser-tools',
    frameworkPattern:'case_execution_grader_aggregate',
    passed,
    failed:cases.length-passed,
    total:cases.length,
    score:cases.length?passed/cases.length:0,
    cases,
  };
  console.log(JSON.stringify(report,null,2));
  if(passed!==cases.length)process.exitCode=1;
  return report;
}

if(require.main===module){
  run().catch(error=>{console.error(error);process.exitCode=1;});
}

module.exports={run};
