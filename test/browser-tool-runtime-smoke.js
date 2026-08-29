'use strict';

const assert = require('node:assert/strict');
const { BrowserToolRuntime, normalizeWebUrl, hostListed, defaultAllowHosts } = require('../src/browser/browser-tool-runtime');

function createFakeCdp({ rejectContext = false } = {}) {
  const pages = new Map([
    ['chat-transport', { id:'chat-transport', type:'page', url:'https://chatgpt.com/c/transport', title:'Chat transport', readyState:'complete', text:'transport', typed:'', settlementStartedAt:0, settlementLastMutationAt:0, settlementRevision:0 }],
  ]);
  let sequence = 0;
  let contextSequence = 0;
  const events = [];

  async function factory(options = {}) {
    const targetId = options.target ? String(options.target) : null;
    if (!targetId) {
      return {
        Target:{
          createBrowserContext:async()=>{
            if (rejectContext) throw Object.assign(new Error('Not allowed'), { code:'TARGET_CONTEXT_NOT_ALLOWED' });
            const browserContextId=`browser-context-${++contextSequence}`;
            events.push({type:'context-create',browserContextId});
            return{browserContextId};
          },
          disposeBrowserContext:async({browserContextId})=>{events.push({type:'context-dispose',browserContextId});return{};},
          createTarget:async ({url})=>{
            const id=`browser-${++sequence}`;
            pages.set(id,{id,type:'page',url,title:`Page ${sequence}`,readyState:'complete',text:`Body for ${url}`,typed:'',settlementStartedAt:0,settlementLastMutationAt:0,settlementRevision:0});
            events.push({type:'create',id,url});
            return{targetId:id};
          },
          closeTarget:async ({targetId:id})=>{
            const existed=pages.delete(String(id));
            events.push({type:'close',id:String(id),existed});
            return{success:existed};
          },
        },
        close:async()=>{},
      };
    }
    const page=pages.get(targetId);
    if(!page)throw Object.assign(new Error(`No such target ${targetId}`),{code:'NO_SUCH_TARGET'});
    return {
      Runtime:{
        enable:async()=>{},
        evaluate:async({expression})=>{
          if(expression.includes("document.querySelectorAll('[data-access-agent-ref]')")){
            return{result:{value:{
              url:page.url,title:page.title,readyState:page.readyState,text:page.text,textTruncated:false,
              interactive:[
                {ref:'aa-1',tag:'a',role:null,name:'Next',href:'https://example.com/next',inputType:null,disabled:false,contentEditable:false,rect:{x:0,y:0,width:50,height:20}},
                {ref:'aa-2',tag:'input',role:null,name:'Search',href:null,inputType:'text',disabled:false,contentEditable:false,rect:{x:0,y:30,width:100,height:20}},
                {ref:'aa-3',tag:'button',role:null,name:'Async update',href:null,inputType:null,disabled:false,contentEditable:false,rect:{x:0,y:60,width:100,height:20}},
              ],
              interactiveTruncated:false,
            }}};
          }
          if(expression.includes('__accessAgentSettlement')&&expression.includes('new MutationObserver')){
            const now=Date.now();
            page.settlementStartedAt=now;
            page.settlementLastMutationAt=now;
            page.settlementRevision=0;
            events.push({type:'settlement-start',targetId});
            return{result:{value:{startedAt:now,url:page.url,title:page.title,readyState:page.readyState}}};
          }
          if(expression.includes('settlementRevision')&&expression.includes('__accessAgentSettlement')){
            return{result:{value:{
              url:page.url,title:page.title,readyState:page.readyState,
              settlementStartedAt:page.settlementStartedAt,
              settlementLastMutationAt:page.settlementLastMutationAt,
              settlementRevision:page.settlementRevision,
            }}};
          }
          if(expression.includes('const ref="aa-1"')&&expression.includes('navigate-anchor')){
            const before=page.url;
            events.push({type:'click',targetId,ref:'aa-1'});
            return{result:{value:{ok:true,method:'navigate-anchor',before,element:{tag:'a',role:null,name:'Next',href:'https://example.com/next'},navigateUrl:'https://example.com/next'}}};
          }
          if(expression.includes('const ref="aa-3"')&&expression.includes('navigate-anchor')){
            const before=page.url;
            events.push({type:'click',targetId,ref:'aa-3'});
            setTimeout(()=>{
              page.title='Async settled';
              page.text='Async content settled';
              page.settlementRevision+=1;
              page.settlementLastMutationAt=Date.now();
              events.push({type:'async-mutation',targetId,ref:'aa-3'});
            },150);
            return{result:{value:{ok:true,method:'dom-click',before,element:{tag:'button',role:null,name:'Async update',href:null}}}};
          }
          if(expression.includes('const ref="aa-2"')&&expression.includes('BROWSER_ELEMENT_NOT_EDITABLE')){
            events.push({type:'type-prepare',targetId,ref:'aa-2'});
            if(expression.includes('return{ok:true,tag,type};'))return{result:{value:{ok:true,tag:'input',type:'text'}}};
          }
          if(expression.includes('valueLength:value.length')){
            return{result:{value:{present:true,valueLength:page.typed.length,url:page.url,title:page.title}}};
          }
          if(expression.includes('scrollIntoView')||expression.includes('window.scrollBy')){
            events.push({type:'scroll',targetId});
            return{result:{value:{ok:true,url:page.url,scrollX:0,scrollY:500}}};
          }
          return{result:{value:{readyState:page.readyState,url:page.url,title:page.title}}};
        },
      },
      Page:{
        enable:async()=>{},
        navigate:async({url})=>{
          page.url=url;page.title=`Navigated ${new URL(url).hostname}`;page.readyState='complete';page.text=`Body for ${url}`;
          events.push({type:'navigate',targetId,url});
          return{};
        },
        captureScreenshot:async()=>{events.push({type:'screenshot',targetId});return{data:'aGVsbG8='};}, // 'hello' base64
      },
      Input:{
        insertText:async({text})=>{page.typed+=String(text);events.push({type:'insertText',targetId,text:String(text)});},
      },
      Accessibility:{
        enable:async()=>{},
        getFullAXTree:async()=>({nodes:[{nodeId:'root',role:{value:'RootWebArea'},name:{value:page.title},ignored:false,childIds:[]}]}),
      },
      close:async()=>{},
    };
  }

  factory.List=async()=>Array.from(pages.values()).map(page=>({id:page.id,type:'page',url:page.url,title:page.title}));
  return{factory,pages,events};
}

async function run() {
  assert.equal(normalizeWebUrl('https://example.com/a'), 'https://example.com/a');
  for(const blocked of ['file:///tmp/a','javascript:alert(1)','data:text/plain,x','chrome://settings/']){
    assert.throws(()=>normalizeWebUrl(blocked),error=>error?.code==='BROWSER_URL_SCHEME_BLOCKED');
  }
  assert.throws(()=>normalizeWebUrl('https://user:pass@example.com/'),error=>error?.code==='BROWSER_URL_CREDENTIALS_BLOCKED');

  const harness=createFakeCdp();
  let endpoint='http://127.0.0.1:9222';
  const protectedUrl='https://chatgpt.com/c/transport';
  const runtime=new BrowserToolRuntime({
    cdpFactory:harness.factory,
    getEndpoint:async()=>endpoint,
    isProtectedUrl:url=>String(url).replace(/\/$/u,'')===protectedUrl,
    allowHosts:['example.com','example.org','example.net','chatgpt.com'],
    readinessTimeoutMs:500,
    pollIntervalMs:25,
    settlementQuietMs:200,
    settlementTimeoutMs:800,
  });

  await assert.rejects(()=>runtime.navigate({targetId:'chat-transport',url:'https://example.com/'}),error=>error?.code==='BROWSER_TARGET_NOT_OWNED');
  await assert.rejects(()=>runtime.open({url:protectedUrl}),error=>error?.code==='BROWSER_PROTECTED_CONVERSATION');
  assert.equal(harness.events.some(event=>event.type==='create'&&event.url===protectedUrl),false,'protected conversation must be rejected before Chrome target creation');

  const opened=await runtime.open({url:'https://example.com/start'});
  assert.equal(opened.ok,true);
  assert.equal(opened.owned,true);
  assert.equal(opened.settlement?.status,'settled');
  assert.match(opened.targetId,/^browser-/u);

  await assert.rejects(()=>runtime.navigate({targetId:opened.targetId,url:protectedUrl}),error=>error?.code==='BROWSER_PROTECTED_CONVERSATION');
  assert.equal(harness.events.some(event=>event.type==='navigate'&&event.url===protectedUrl),false,'protected conversation must be rejected before Page.navigate');

  const tabs=await runtime.tabs();
  assert.equal(tabs.tabs.find(item=>item.targetId==='chat-transport')?.owned,false);
  assert.equal(tabs.tabs.find(item=>item.targetId===opened.targetId)?.owned,true);

  const snapshot=await runtime.snapshot({targetId:opened.targetId});
  assert.equal(snapshot.ok,true);
  assert.match(snapshot.text,/Body for/u);
  assert.equal(snapshot.interactive[0].ref,'aa-1');
  assert.equal(snapshot.interactive[1].ref,'aa-2');
  assert.equal(snapshot.interactive[2].ref,'aa-3');
  assert.equal(snapshot.accessibility.status,'available');
  assert.equal(snapshot.accessibility.nodes[0].role,'RootWebArea');
  assert.equal(harness.events.some(event=>event.type==='context-create'),true);

  const clicked=await runtime.click({targetId:opened.targetId,ref:'aa-1'});
  assert.equal(clicked.ok,true);
  assert.equal(clicked.verifiedActionDispatch,true);
  assert.equal(clicked.downstreamOutcome,'SETTLED');
  assert.equal(clicked.settlement?.status,'settled');
  assert.equal(clicked.url,'https://example.com/next');

  const asyncClicked=await runtime.click({targetId:opened.targetId,ref:'aa-3'});
  assert.equal(asyncClicked.ok,true);
  assert.equal(asyncClicked.method,'dom-click');
  assert.equal(asyncClicked.downstreamOutcome,'SETTLED');
  assert.equal(asyncClicked.settlement?.status,'settled');
  assert.ok(asyncClicked.settlement?.revision>=1,'delayed post-click mutation must be observed before click returns');
  assert.equal(asyncClicked.title,'Async settled');
  assert.equal(harness.events.some(event=>event.type==='async-mutation'),true);

  const typed=await runtime.type({targetId:opened.targetId,ref:'aa-2',text:'hello'});
  assert.equal(typed.ok,true);
  assert.equal(typed.insertedCharacters,5);
  assert.equal(typed.submitted,false);

  const scrolled=await runtime.scroll({targetId:opened.targetId,y:500});
  assert.equal(scrolled.ok,true);
  assert.equal(scrolled.scrollY,500);

  const navigated=await runtime.navigate({targetId:opened.targetId,url:'https://example.org/page'});
  assert.equal(navigated.ok,true);
  assert.equal(navigated.url,'https://example.org/page');
  assert.equal(navigated.settlement?.status,'settled');

  const redirected=await runtime.open({url:'https://example.org/redirect-source'});
  harness.pages.get(redirected.targetId).url=protectedUrl;
  await assert.rejects(()=>runtime.snapshot({targetId:redirected.targetId}),error=>error?.code==='BROWSER_PROTECTED_CONVERSATION');
  assert.equal(runtime.ownedTargets.has(redirected.targetId),false,'a tab that redirects into the protected conversation must lose general-browser ownership');
  assert.notEqual(runtime.currentTargetId,redirected.targetId,'a protected redirect must clear the general-browser current target');

  endpoint='http://127.0.0.1:9333';
  await assert.rejects(
    ()=>runtime.navigate({targetId:opened.targetId,url:'https://example.net/reused'}),
    error=>error?.code==='BROWSER_TARGET_GENERATION_CHANGED',
  );
  assert.equal(runtime.ownedTargets.has(opened.targetId),false,'browser restart must invalidate old target ownership');
  assert.equal(runtime.currentTargetId,null,'browser restart must clear stale current target');
  assert.equal(harness.pages.get('chat-transport').url,'https://chatgpt.com/c/transport');

  endpoint='http://127.0.0.1:9333';
  const replacement=await runtime.open({url:'https://example.net/fresh'});
  const closed=await runtime.close({targetId:replacement.targetId});
  assert.equal(closed.ok,true);
  assert.equal(harness.pages.has(replacement.targetId),false);
  assert.equal(harness.pages.has('chat-transport'),true,'closing a browser-owned target must not close the ChatGPT transport tab');
  assert.equal(harness.events.some(event=>event.type==='context-dispose'),true,'closing the last general target must dispose its isolated context');

  const fallbackHarness=createFakeCdp({ rejectContext:true });
  const fallbackRuntime=new BrowserToolRuntime({
    cdpFactory:fallbackHarness.factory,
    getEndpoint:async()=> 'http://127.0.0.1:9444',
    requireIsolatedContext:false,
    allowHosts:['example.com'],
    readinessTimeoutMs:500,
    pollIntervalMs:25,
    settlementQuietMs:50,
    settlementTimeoutMs:500,
  });
  const fallbackOpened=await fallbackRuntime.open({ url:'https://example.com/fallback' });
  assert.equal(fallbackOpened.ok,true,'optional isolation must fall back when the host rejects context creation');
  assert.equal(fallbackHarness.events.some(event=>event.type==='create'),true);

  // --- Allowlist / denylist mechanism (local, fail-closed, deny-first) ---
  await assert.rejects(()=>runtime.open({url:'https://someothersite.io/x'}),error=>error?.code==='BROWSER_URL_NOT_ALLOWED','a host outside the allowlist must be rejected before target creation');
  assert.equal(defaultAllowHosts().includes('chatgpt.com'),true,'default allowlist must include provider hosts');
  assert.equal(defaultAllowHosts().includes('localhost'),true,'default allowlist must include loopback');
  assert.equal(hostListed('www.chatgpt.com',['chatgpt.com']),true,'a subdomain must match its allowlisted root');
  assert.equal(hostListed('evilchatgpt.com',['chatgpt.com']),false,'suffix matching must not allow unrelated sibling domains');
  assert.equal(hostListed('chatgpt.com.evil.test',['chatgpt.com']),false,'an allowlisted root as a suffix must not match a wider domain');

  const gatedHarness=createFakeCdp();
  const gatedRuntime=new BrowserToolRuntime({
    cdpFactory:gatedHarness.factory,
    getEndpoint:async()=> 'http://127.0.0.1:9555',
    allowHosts:['example.com'],
    denyHosts:['malicious.test'],
    requireIsolatedContext:false,
    readinessTimeoutMs:500,pollIntervalMs:25,settlementQuietMs:200,settlementTimeoutMs:800,
  });
  await assert.rejects(()=>gatedRuntime.open({url:'https://malicious.test/x'}),error=>error?.code==='BROWSER_URL_DENIED','a denied host must be rejected even before allowlist evaluation');
  await assert.rejects(()=>gatedRuntime.open({url:'https://unlisted.example.org/x'}),error=>error?.code==='BROWSER_URL_NOT_ALLOWED','an unallowlisted host must be rejected');
  await assert.rejects(()=>gatedRuntime.navigate({targetId:'nope',url:'https://example.com/x'}),error=>error?.code==='BROWSER_TARGET_NOT_OWNED','an unowned target must be rejected even when its URL is allowlisted');
  const gatedOwned=await gatedRuntime.open({url:'https://example.com/ok'});
  assert.equal(gatedOwned.ok,true,'an allowlisted host that is not denied must be permitted');

  // --- Lightweight action recorder (privacy-gated) ---
  const recStore={puts:[]};
  const recHarness=createFakeCdp();
  const recRuntime=new BrowserToolRuntime({
    cdpFactory:recHarness.factory,
    getEndpoint:async()=> 'http://127.0.0.1:9666',
    allowHosts:['example.com'],
    evidenceStore:{
      put:async(input)=>{recStore.puts.push(input);return{artifactId:'rec-art',capturedAt:new Date().toISOString(),refs:input.screenshotBase64?[{type:'screenshot',path:'/tmp/rec.png',sha256:'abc'}]:[]};},
    },
    captureActions:true,
    captureScreenshots:true,
    requireIsolatedContext:false,
    readinessTimeoutMs:500,pollIntervalMs:25,settlementQuietMs:200,settlementTimeoutMs:800,
  });
  const recOpened=await recRuntime.open({url:'https://example.com/rec'});
  assert.equal(recRuntime.actions.length,1,'a governed browser action must be recorded when capture is enabled');
  assert.equal(recRuntime.actions[0].action,'browser.open');
  assert.equal(recRuntime.actions[0].url,'https://example.com/rec');
  assert.equal(recRuntime.actions[0].artifactId,'rec-art');
  assert.equal(recStore.puts.length,1,'each recorded action must persist evidence through the evidence store');
  assert.equal(recStore.puts[0].privacy.containsConversationContent,true,'a captured screenshot must carry the conversation-content privacy flag');
  assert.equal(recStore.puts[0].privacy.screenshotPolicy,'raw_local_opt_in','a captured screenshot must carry the opt-in screenshot policy');
  await recRuntime.navigate({targetId:recOpened.targetId,url:'https://example.com/two'});
  assert.equal(recRuntime.actions[1].action,'browser.navigate','navigate actions must be recorded with their action label');

  const offHarness=createFakeCdp();
  const offRuntime=new BrowserToolRuntime({
    cdpFactory:offHarness.factory,
    getEndpoint:async()=> 'http://127.0.0.1:9777',
    allowHosts:['example.com'],
    evidenceStore:{put:async()=>({artifactId:'x',capturedAt:new Date().toISOString(),refs:[]})},
    captureActions:false,
    requireIsolatedContext:false,
    readinessTimeoutMs:500,pollIntervalMs:25,settlementQuietMs:200,settlementTimeoutMs:800,
  });
  await offRuntime.open({url:'https://example.com/no-rec'});
  assert.equal(offRuntime.actions.length,0,'recording must be disabled unless capture is explicitly enabled');

  console.log('browser-tool-runtime-smoke: PASS');
}

if(require.main===module){
  run().catch(error=>{console.error(error);process.exitCode=1;});
}

module.exports={createFakeCdp,run};
