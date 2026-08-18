'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ManagedChrome, resolveChromeExecutable, chromeExecutable } = require('../src/system/managed-chrome');

(async () => {
  assert.equal(chromeExecutable(''), '', 'blank browser setting must not synthesize a development-machine Chrome path');
  const discoveredBrowser = await resolveChromeExecutable('', {
    machineEnvironment:{
      platform:'linux', env:{},
      resolveExecutable:async name => name === 'chromium'
        ? { available:true, resolved:'/host/bin/chromium' }
        : { available:false, resolved:null },
    },
    access:async () => { throw new Error('common path unavailable'); },
  });
  assert.equal(discoveredBrowser.executable, '/host/bin/chromium');
  assert.equal(discoveredBrowser.source, 'PATH');
  assert.equal(discoveredBrowser.requested, 'chromium');

  const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'access-managed-chrome-'));
  let spawnInput;
  let onExit;
  let initialReads = 0;
  const child = { pid: 4321, killed: false, once: (_event, handler) => { onExit = handler; }, kill() { this.killed = true; } };
  const chrome = new ManagedChrome({ getSettings: () => ({ browserMode: 'managed', browserProfilePath: profilePath, browserExecutable: process.execPath, browserCdpPort: 7444 }), spawnImpl: (executable, args) => { spawnInput = { executable, args }; return child; }, readFile: async () => { if (++initialReads === 1) throw new Error('no prior active port'); return '7330\n/devtools/browser/test'; }, delayImpl: async () => {}, fetchImpl: async url => { assert.equal(url, 'http://127.0.0.1:7330/json/version'); return { ok:true, status:200 }; } });
  const started = await chrome.start();
  assert.equal(started.running, true);
  assert.equal(started.backendReady, true);
  assert.equal(started.launcherRunning, true);
  assert.equal(started.lifecycle, 'ready');
  assert.equal(started.endpoint, 'http://127.0.0.1:7330');
  assert.equal(started.profileSource, 'override');
  assert.equal(started.executableSource, 'override');
  assert.equal(spawnInput.executable, path.resolve(process.execPath));
  assert.match(spawnInput.args.join(' '), /--remote-debugging-address=127\.0\.0\.1/u);
  assert.match(spawnInput.args.join(' '), /--remote-debugging-port=0/u, 'managed launch must ignore legacy fixed ports');
  assert.match(spawnInput.args.join(' '), new RegExp(`--user-data-dir=${profilePath.replace(/\\/gu, '\\\\')}`, 'u'));
  assert.match(spawnInput.args.join(' '), /--new-window data:text\/html;charset=utf-8,<title>Access%20Agent%20bootstrap%201<\/title>/u, 'managed launch must mark the current-generation bootstrap page');
  assert.equal(started.bootstrapTargetId,null);
  assert.equal(chrome.claimBootstrapTarget([{targetId:'owned-bootstrap',type:'page',url:started.bootstrapUrl},{targetId:'user-blank',type:'page',url:'about:blank'}]),'owned-bootstrap');
  assert.equal(chrome.status().bootstrapTargetId,'owned-bootstrap');
  assert.equal(chrome.releaseBootstrapTarget('user-blank'),false,'an unrelated blank page must never release bootstrap ownership');
  assert.equal(chrome.releaseBootstrapTarget('owned-bootstrap'),true);
  const stopped = await chrome.stop();
  assert.equal(stopped.running, false);
  assert.equal(stopped.lifecycle, 'stopped');
  onExit();
  assert.equal(chrome.status().endpoint, null, 'stale exit from a stopped generation must not restore browser state');
  assert.equal(chrome.status().launcherExit, null, 'stale exit from a prior generation must not become current exit evidence');

  const automaticProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'access-owned-profile-'));
  let automaticSpawn;
  let automaticReads = 0;
  const automaticChild = { pid: 7331, killed:false, once: () => {}, kill() { this.killed = true; } };
  const automatic = new ManagedChrome({
    getSettings: () => ({ browserMode:'managed', browserCdpPort:9222 }),
    defaultProfilePath: automaticProfile,
    machineEnvironment:{
      platform:'linux', env:{},
      resolveExecutable:async name => name === 'google-chrome'
        ? { available:true, resolved:process.execPath }
        : { available:false, resolved:null },
    },
    accessImpl:async file => { if(path.resolve(file)!==path.resolve(process.execPath)) throw new Error('not found'); },
    spawnImpl: (executable,args) => { automaticSpawn={executable,args}; return automaticChild; },
    readFile: async () => { if (++automaticReads === 1) throw new Error('no prior active port'); return '7331\n/devtools/browser/automatic'; },
    delayImpl: async () => {},
    fetchImpl: async url => { assert.equal(url,'http://127.0.0.1:7331/json/version'); return {ok:true,status:200}; },
  });
  assert.equal(automatic.status().profilePath, path.resolve(automaticProfile));
  assert.equal(automatic.status().profileSource, 'access_owned_default');
  assert.equal(automatic.status().executable, null, 'host executable is resolved on explicit Start, not during passive status');
  const automaticStarted = await automatic.start();
  assert.equal(automaticStarted.profileSource, 'access_owned_default');
  assert.equal(automaticStarted.executableSource, 'PATH');
  assert.equal(path.resolve(automaticSpawn.executable), path.resolve(process.execPath));
  assert.match(automaticSpawn.args.join(' '), new RegExp(`--user-data-dir=${path.resolve(automaticProfile).replace(/\\/gu,'\\\\')}`, 'u'));
  assert.match(automaticSpawn.args.join(' '), /--remote-debugging-port=0/u, 'automatic profile launch must still use dynamic CDP port ownership');
  await automatic.stop();

  let reads = 0;
  const staleThenReady = new ManagedChrome({
    getSettings: () => ({ browserMode: 'managed', browserProfilePath: profilePath, browserCdpPort: 0 }),
    readFile: async () => (++reads === 1 ? '62318\n/devtools/browser/stale' : '55069\n/devtools/browser/live'),
    delayImpl: async () => {},
    fetchImpl: async url => {
      if (url.includes(':62318/')) throw new Error('connection refused');
      assert.equal(url, 'http://127.0.0.1:55069/json/version');
      return { ok:true, status:200 };
    },
  });
  staleThenReady.child = { pid: 55069, killed:false, once: () => {} };
  assert.equal(await staleThenReady.readyEndpoint(), 'http://127.0.0.1:55069', 'an unavailable published endpoint must be retried until the owned browser publishes a reachable endpoint');
  assert.equal(staleThenReady.status().lifecycle, 'ready');
  const unavailable = new ManagedChrome({ getSettings: () => ({ browserMode:'managed', browserProfilePath:profilePath, browserCdpPort:7444 }), delayImpl:async () => {}, fetchImpl:async () => { throw new Error('connection refused'); } });
  unavailable.child = { pid:7444, killed:false, once: () => {} };
  await assert.rejects(() => unavailable.readyEndpoint(), /unavailable/u);
  assert.equal(unavailable.status().endpoint, null);
  assert.equal(unavailable.status().lifecycle, 'unavailable');
  const noOwnedProcess = new ManagedChrome({ getSettings: () => ({ browserMode:'managed', browserProfilePath:profilePath }) });
  await assert.rejects(() => noOwnedProcess.readyEndpoint(), /not running/u);

  let generationReads = 0;
  const freshLaunch = new ManagedChrome({
    getSettings: () => ({ browserMode:'managed', browserProfilePath:profilePath, browserExecutable:process.execPath, browserCdpPort:6555 }),
    spawnImpl: () => ({ pid:55069, killed:false, once: () => {} }),
    readFile: async () => (++generationReads === 1 ? '62318\n/devtools/browser/old' : '55069\n/devtools/browser/new'),
    unlinkImpl: async () => {},
    delayImpl: async () => {}, fetchImpl: async url => { assert.equal(url, 'http://127.0.0.1:55069/json/version'); return { ok:true, status:200 }; },
  });
  await freshLaunch.start();
  assert.equal(freshLaunch.status().endpoint, 'http://127.0.0.1:55069', 'a stale marker must be cleared before accepting the new managed generation');

  let samePortReads=0;
  let staleMarkerRemoved=false;
  const samePortReuse=new ManagedChrome({
    getSettings:()=>({browserMode:'managed',browserProfilePath:profilePath,browserExecutable:process.execPath}),
    spawnImpl:()=>({pid:7330,killed:false,once:()=>{}}),
    readFile:async()=>{samePortReads+=1;return '7330\n/devtools/browser/reused';},
    unlinkImpl:async()=>{staleMarkerRemoved=true;},
    delayImpl:async()=>{},
    fetchImpl:async url=>{assert.equal(url,'http://127.0.0.1:7330/json/version');return{ok:true,status:200};},
  });
  const samePortStarted=await samePortReuse.start();
  assert.equal(staleMarkerRemoved,true,'pre-launch DevToolsActivePort marker must be removed');
  assert.ok(samePortReads>=2,'current generation must republish DevToolsActivePort after stale cleanup');
  assert.equal(samePortStarted.endpoint,'http://127.0.0.1:7330','current Chrome generation may legitimately reuse the same port value');

  let handoffExit;
  let handoffReads=0;
  let handoffDelayCount=0;
  const handoffChild={pid:7445,killed:false,once:(_event,handler)=>{handoffExit=handler;},kill(){this.killed=true;}};
  const handoff=new ManagedChrome({
    getSettings:()=>({browserMode:'managed',browserProfilePath:profilePath,browserExecutable:process.execPath}),
    spawnImpl:()=>handoffChild,
    readFile:async()=>{handoffReads+=1;if(handoffReads<=2)throw Object.assign(new Error('marker not published yet'),{code:'ENOENT'});return '7445\n/devtools/browser/current';},
    delayImpl:async()=>{handoffDelayCount+=1;if(handoffDelayCount===1)handoffExit(0,null);},
    fetchImpl:async url=>{assert.equal(url,'http://127.0.0.1:7445/json/version');return{ok:true,status:200};},
  });
  const handoffStarted=await handoff.start();
  assert.equal(handoffStarted.endpoint,'http://127.0.0.1:7445','current-generation endpoint must remain discoverable after launcher exit');
  assert.equal(handoffStarted.backendReady,true,'verified CDP endpoint is the browser-ready predicate');
  assert.equal(handoffStarted.launcherRunning,false,'launcher process may be absent after endpoint handoff');
  assert.equal(handoffStarted.running,true,'verified backend remains running even without the initial launcher handle');
  assert.equal(handoffStarted.launcherExit?.code,0,'launcher exit evidence must be retained without overriding backend readiness');

  let postReadyExit;
  let postReadyReads=0;
  const postReadyChild={pid:7555,killed:false,once:(_event,handler)=>{postReadyExit=handler;},kill(){this.killed=true;}};
  const postReady=new ManagedChrome({
    getSettings:()=>({browserMode:'managed',browserProfilePath:profilePath,browserExecutable:process.execPath}),
    spawnImpl:()=>postReadyChild,
    readFile:async()=>{postReadyReads+=1;if(postReadyReads===1)throw Object.assign(new Error('no stale marker'),{code:'ENOENT'});return '7555\n/devtools/browser/ready';},
    delayImpl:async()=>{},
    fetchImpl:async url=>{assert.equal(url,'http://127.0.0.1:7555/json/version');return{ok:true,status:200};},
  });
  await postReady.start();
  postReadyExit(0,null);
  assert.equal(postReady.status().endpoint,'http://127.0.0.1:7555','launcher exit after verification must not erase a healthy backend endpoint');
  assert.equal(postReady.status().lifecycle,'ready');
  assert.equal(postReady.status().backendReady,true);
  assert.equal(postReady.status().launcherRunning,false);

  let failedExit;
  let failedDelayCount=0;
  const failedChild={pid:7666,killed:false,once:(_event,handler)=>{failedExit=handler;},kill(){this.killed=true;}};
  const exitedWithoutEndpoint=new ManagedChrome({
    getSettings:()=>({browserMode:'managed',browserProfilePath:profilePath,browserExecutable:process.execPath}),
    spawnImpl:()=>failedChild,
    readFile:async()=>{throw Object.assign(new Error('marker missing'),{code:'ENOENT'});},
    delayImpl:async()=>{failedDelayCount+=1;if(failedDelayCount===1)failedExit(7,null);},
    fetchImpl:async()=>{throw new Error('fetch must not run without a discovered endpoint');},
  });
  await assert.rejects(
    () => exitedWithoutEndpoint.start(),
    error => error.code === 'CHROME_EXITED_BEFORE_CDP' && error.launcherExit?.code === 7,
    'launcher exit must become the final classified failure only after bounded endpoint discovery is exhausted',
  );
  assert.equal(exitedWithoutEndpoint.status().lifecycle,'unavailable');

  console.log('Managed Chrome smoke PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
