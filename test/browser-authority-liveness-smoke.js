'use strict';

const assert=require('node:assert/strict');
const {BrowserSessionAuthority}=require('../electron/browser-session-authority');

function baseRelay(){
  return {
    status:()=>({running:false,target:null,lifecycle:'stopped',error:null}),
    selectTarget:()=>{},start:async()=>({ok:true}),stop(){},clearTarget(){},
    checkOnce:async()=>({ok:true}),
  };
}
const baseChannel={
  snapshot:async()=>({}),send:async()=>({accepted:true}),
  expectedUrlFor:()=> '', listTabs:async()=>[],
};

function healthyChrome(verifyOk){
  const stubs={
    startCalls:0, stoppedCalls:0,
    status:()=>({lifecycle:'ready',endpoint:'http://127.0.0.1:7330',generation:1,bootstrapUrl:null,bootstrapTargetId:null}),
    async readyEndpoint(){ if(!verifyOk) throw Object.assign(new Error('endpoint not reachable'),{code:'CDP_UNAVAILABLE'}); return 'http://127.0.0.1:7330'; },
    async stop(){ stubs.stoppedCalls+=1; return {lifecycle:'stopped'}; },
    async start(){ stubs.startCalls+=1; return {lifecycle:'ready',endpoint:'http://127.0.0.1:7331',generation:2,bootstrapUrl:null,bootstrapTargetId:null}; },
    claimBootstrapTarget:()=>null, releaseBootstrapTarget:()=>false,
  };
  return stubs;
}

(async()=>{
  // A cached 'ready + endpoint' must be liveness-verified before reuse. When the
  // endpoint is actually healthy, it is reused without relaunching.
  const healthy=healthyChrome(true);
  const healthyAuthority=new BrowserSessionAuthority({managedChrome:healthy,channel:baseChannel,relay:baseRelay()});
  const reused=await healthyAuthority.ensureBrowser();
  assert.equal(healthy.startCalls,0,'a verified-live cached endpoint must be reused, not relaunched');
  assert.equal(reused.endpoint,'http://127.0.0.1:7330');

  // When the cached 'ready + endpoint' has gone stale (Chrome died), the cached
  // value must NOT be treated as healthy: invalidate and relaunch.
  const stale=healthyChrome(false);
  const staleAuthority=new BrowserSessionAuthority({managedChrome:stale,channel:baseChannel,relay:baseRelay()});
  const fresh=await staleAuthority.ensureBrowser();
  assert.equal(stale.stoppedCalls,1,'stale cached endpoint must be invalidated before relaunch');
  assert.equal(stale.startCalls,1,'a dead cached endpoint must trigger a fresh browser launch');
  assert.equal(fresh.endpoint,'http://127.0.0.1:7331','relaunched browser must expose the new CDP endpoint');

  // getLiveEndpoint — the authority-managed endpoint the live relay consumes —
  // must re-verify a cached ready endpoint and relaunch when stale.
  const liveHealthy=healthyChrome(true);
  const liveHealthyAuthority=new BrowserSessionAuthority({managedChrome:liveHealthy,channel:baseChannel,relay:baseRelay()});
  assert.equal(await liveHealthyAuthority.getLiveEndpoint(),'http://127.0.0.1:7330','healthy cached endpoint must be liveness-verified and reused');
  assert.equal(liveHealthy.startCalls,0,'reuse of a verified-live endpoint must not relaunch');

  const liveStale=healthyChrome(false);
  const liveStaleAuthority=new BrowserSessionAuthority({managedChrome:liveStale,channel:baseChannel,relay:baseRelay()});
  assert.equal(await liveStaleAuthority.getLiveEndpoint(),'http://127.0.0.1:7331','stale cached endpoint must be recovered before returning a live endpoint');
  assert.equal(liveStale.startCalls,1,'a dead cached endpoint must be relaunched by getLiveEndpoint');

  console.log('browser-authority-liveness-smoke: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});