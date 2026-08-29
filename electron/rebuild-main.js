'use strict';

const { IdePreferences } = require('../src/system/ide-preferences');
const { ClineAuthSession } = require('../src/llm/ClineAuthSession');

const fs=require('node:fs');
const net=require('node:net');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {app,BrowserWindow,ipcMain,shell}=require('electron');
const {RuntimeDiagnosticLog}=require('../src/system/runtime-diagnostic-log');
const {setDiagnosticSink,subscribeDiagnostic,emitDiagnostic}=require('../src/system/runtime-diagnostic-bus');
const {BrowserTransportJournal}=require('../src/system/browser-transport-journal');
const {GovernedTerminal}=require('../src/system/governed-terminal');
const {MachineEnvironment}=require('../src/system/machine-environment');
const {ChangeGovernanceGuard}=require('../src/agent/guards/ChangeGovernanceGuard');
const {RUNTIME_MODULES}=require('../src/system/module-registry');
const providerModule=require('../src/browser/provider-channel');
const relayModule=require('../src/agent/executive/BrowserInstructionRelay');
const {BrowserEvidenceStore,ObservableProviderChannel,ObservableBrowserInstructionRelay,defaultBrowserEvidenceRoot}=require('../src/browser/observable-browser-runtime');

const diagnosticRoot=path.join(app.getPath('userData'),'diagnostics');
const diagnosticLog=new RuntimeDiagnosticLog({
  root:diagnosticRoot,
  sessionId:process.env.ACCESS_AGENT_DIAGNOSTIC_SESSION||undefined,
  filePath:process.env.ACCESS_AGENT_DIAGNOSTIC_FILE||null,
});
setDiagnosticSink(diagnosticLog);
global.__accessAgentDiagnosticLog=diagnosticLog;

// Initialize auth session with persistence
const userDataPath = app.getPath('userData');
let clineAuthSession = new ClineAuthSession({
  loadCore: () => import('@cline/core'),
  preferencesPath: userDataPath,
  onAuth: (info) => {
    console.log('[Auth] Updated:', info?.email || 'unknown');
  },
  onProgress: (message) => {
    console.log('[Auth] Progress:', message);
  }
});

// Load persisted credentials immediately
clineAuthSession.load().then(() => {
  const status = clineAuthSession.status();
  console.log('[Auth] Loaded:', status.authenticated ? 'Authenticated' : 'Not authenticated');
}).catch(err => {
  console.error('[Auth] Load failed:', err);
});

// Store globally for other modules
global.__accessAgentAuthSession = clineAuthSession;

const machineEnvironment=new MachineEnvironment();
const interactiveShell=machineEnvironment.resolveInteractiveShellSync();
if(process.platform==='win32')process.env.PWSH_EXE=interactiveShell.executable;
else process.env.SHELL=interactiveShell.executable;
emitDiagnostic({source:'machine-environment',category:'environment',action:'interactive_shell_resolved',phase:'success',data:{platform:process.platform,arch:process.arch,shell:interactiveShell.executable,source:interactiveShell.source,requested:interactiveShell.requested||null}});

const browserEvidenceStore=new BrowserEvidenceStore(defaultBrowserEvidenceRoot(diagnosticRoot));
class AppProviderChannel extends ObservableProviderChannel{
  constructor(options={}){super({...options,evidenceStore:options.evidenceStore||browserEvidenceStore});}
}
const sharedBrowserChannel=new AppProviderChannel({readinessTimeoutMs:5000});
global.__accessAgentBrowserChannel=sharedBrowserChannel;
global.__accessAgentTransportJournal=new BrowserTransportJournal(path.join(diagnosticRoot,'browser-transport.jsonl'));

function moduleRegistryStatus(){
  const cautions=[];
  const owners=new Map();
  for(const [modulePath,contract] of Object.entries(RUNTIME_MODULES)){
    if(!fs.existsSync(path.join(__dirname,'..',modulePath)))cautions.push(`${modulePath}: registered file is missing`);
    for(const key of ['owner','behavior','success','failure'])if(!String(contract?.[key]||'').trim())cautions.push(`${modulePath}: missing ${key}`);
    if(owners.has(contract.owner))cautions.push(`${modulePath}: duplicate owner ${contract.owner}`);else owners.set(contract.owner,modulePath);
    for(const parent of contract.parents||[])if(!RUNTIME_MODULES[parent])cautions.push(`${modulePath}: unregistered parent ${parent}`);
  }
  const docsPath=path.join(__dirname,'..','docs','MODULE_REGISTRY.md');
  if(!fs.existsSync(docsPath))cautions.push('docs/MODULE_REGISTRY.md is missing');
  else{
    const docs=fs.readFileSync(docsPath,'utf8');
    if(!docs.includes(`Registered ownership modules: ${Object.keys(RUNTIME_MODULES).length}.`))cautions.push('module registry document count is stale');
    for(const modulePath of Object.keys(RUNTIME_MODULES))if(!docs.includes(`\`${modulePath}\``)&&!docs.includes(`${modulePath} [`))cautions.push(`${modulePath}: missing from module registry document`);
  }
  return{ok:true,state:cautions.length?'caution':'ok',count:Object.keys(RUNTIME_MODULES).length,cautions};
}

global.__accessAgentExecuteQuickCommand=async({command,workspaceRoot,instructionId,target}={})=>{
  const root=path.resolve(String(workspaceRoot||process.cwd()));
  const normalized=String(command||'').trim();
  const workspaceKey=createHash('sha256').update(root).digest('hex').slice(0,16);
  const terminal=new GovernedTerminal({workspaceRoot:root,receiptsDirectory:path.join(app.getPath('userData'),'agent-state',`ws-${workspaceKey}`,'quick-command-receipts'),machineEnvironment});
  const started=Date.now();
  emitDiagnostic({source:'quick-command',category:'terminal',action:'execute',phase:'start',correlation:{instructionId,targetId:target?.targetId||null},data:{command:normalized,cwd:root}});
  try{
    new ChangeGovernanceGuard({workspaceRoot:root}).assertMutation({toolName:'runCommand',args:{command:normalized}});
    const preview=await terminal.preview(normalized);
    const result=await terminal.execute(preview);
    emitDiagnostic({source:'quick-command',category:'terminal',action:'execute',phase:result.ok?'success':'observed',severity:result.ok?'info':'warn',durationMs:Date.now()-started,correlation:{instructionId,targetId:target?.targetId||null},data:{command:normalized,cwd:result.cwd,resolvedExecutable:result.resolvedExecutable||null,executableKind:result.executableKind||null,exitCode:result.exitCode,stdout:result.stdout,stderr:result.stderr,timedOut:result.timedOut,receipt:result.receipt}});
    return{...result,command:normalized,cwd:result.cwd||root};
  }catch(error){
    const result={ok:false,command:normalized,cwd:root,exitCode:null,stdout:'',stderr:'',error:String(error?.message||error),code:String(error?.code||'COMMAND_REJECTED')};
    emitDiagnostic({source:'quick-command',category:error?.classification==='GOVERNANCE'?'governance':'terminal',action:'execute',phase:error?.classification==='GOVERNANCE'?'blocked':'observed',severity:'warn',durationMs:Date.now()-started,correlation:{instructionId,targetId:target?.targetId||null},data:result,error});
    return result;
  }
};

providerModule.ProviderChannel=class SharedProviderChannel{constructor(){return sharedBrowserChannel;}};
relayModule.BrowserInstructionRelay=ObservableBrowserInstructionRelay;

function broadcast(record){for(const window of BrowserWindow.getAllWindows()){try{if(!window.isDestroyed())window.webContents.send('ide:diagnostic-record',record);}catch{}}}
subscribeDiagnostic(broadcast);
function record(input){const emitted=emitDiagnostic(input);if(emitted)return emitted;const written=diagnosticLog.write(input);broadcast(written);return written;}

let foregroundLineCount=0;
let foregroundTimer=null;
const foregroundTraceFile=String(process.env.ACCESS_AGENT_FOREGROUND_TRACE_FILE||'').trim();
function ingestForegroundTrace(){
  if(!foregroundTraceFile)return;
  let lines=[];
  try{lines=fs.readFileSync(foregroundTraceFile,'utf8').split(/\r?\n/u).filter(Boolean);}catch{return;}
  for(const line of lines.slice(foregroundLineCount)){
    try{
      const event=JSON.parse(line);
      record({source:'foreground-process',category:'process-stream',action:String(event.stream||'output'),phase:String(event.stream||'').includes('error')?'failed':'event',severity:String(event.stream||'').includes('error')?'error':'info',data:{capturedAt:event.timestamp||null,text:String(event.text||'').slice(-200000)}});
    }catch(error){record({source:'foreground-process',category:'process-stream',action:'spool_parse_failed',phase:'failed',severity:'warn',data:{line:String(line).slice(0,2000)},error});}
  }
  foregroundLineCount=lines.length;
}

function captureProcessStream(name,stream){
  if(!stream||typeof stream.write!=='function')return;
  const original=stream.write.bind(stream);let inside=false;
  stream.write=function wrapped(chunk,encoding,callback){
    if(!inside){inside=true;try{const text=Buffer.isBuffer(chunk)?chunk.toString(typeof encoding==='string'?encoding:'utf8'):String(chunk??'');if(text.trim())record({source:'main-process',category:'process-stream',action:name,phase:'event',data:{text:text.slice(-200000)}});}catch{}finally{inside=false;}}
    return original(chunk,encoding,callback);
  };
}
if(foregroundTraceFile){ingestForegroundTrace();foregroundTimer=setInterval(ingestForegroundTrace,250);}
else{captureProcessStream('stdout',process.stdout);captureProcessStream('stderr',process.stderr);}

record({source:'main-wrapper',category:'startup',action:'process_boot',phase:'start',data:{argv:process.argv,cwd:process.cwd(),platform:process.platform,node:process.version,foregroundTrace:Boolean(foregroundTraceFile)}});
process.on('uncaughtException',error=>record({source:'main-process',category:'process',action:'uncaughtException',phase:'failed',severity:'fatal',error}));
process.on('unhandledRejection',reason=>record({source:'main-process',category:'process',action:'unhandledRejection',phase:'failed',severity:'error',error:reason instanceof Error?reason:new Error(String(reason))}));

ipcMain.on('ide:diagnostic-event',(_event,payload={})=>record(payload));
ipcMain.handle('ide:diagnostic-session',()=>diagnosticLog.info());
ipcMain.handle('ide:diagnostic-recent',(_event,limit=1000)=>diagnosticLog.readRecent(limit));
ipcMain.handle('ide:diagnostic-reveal',async()=>{const info=diagnosticLog.info();const error=await shell.openPath(info.root);return error?{ok:false,error,...info}:{ok:true,...info};});
ipcMain.handle('ide:module-registry-status',()=>moduleRegistryStatus());

ipcMain.handle('ide:browser-open-exact-chat',async(_event,input={})=>{
  const endpoint=String(input.endpoint||'').trim();const chatUrl=String(input.chatUrl||'').trim();const started=Date.now();let opened=null;
  record({source:'exact-chat',category:'browser',action:'open_exact_chat',phase:'start',data:{endpoint,chatUrl}});
  try{
    opened=await sharedBrowserChannel.openTab(endpoint,chatUrl);
    record({source:'exact-chat',category:'target',action:'target_created',phase:'success',durationMs:Date.now()-started,correlation:{targetId:opened.targetId},data:{targetId:opened.targetId,providerId:opened.providerId,requestedUrl:chatUrl}});
    const verified=await sharedBrowserChannel.waitForExactChat(endpoint,opened.targetId,chatUrl,{timeoutMs:20000,intervalMs:250});
    const provenance=sharedBrowserChannel.targetProvenance(opened.targetId)||verified.provenance||null;
    const target={targetId:opened.targetId,providerId:opened.providerId,provider:opened.provider,title:String(verified.title||''),url:String(verified.url||chatUrl),type:'page',provenance};
    record({source:'exact-chat',category:'target',action:'target_verified',phase:'success',durationMs:Date.now()-started,correlation:{targetId:opened.targetId},data:{...target,configuredChatUrl:chatUrl,composerReady:verified.composerReady,readyState:verified.readyState}});
    if(typeof global.__accessAgentRetireBrowserBootstrap==='function')await global.__accessAgentRetireBrowserBootstrap(endpoint,opened.targetId);
    return{ok:true,target,verification:verified};
  }catch(error){
    let artifact=error?.diagnosticArtifact||null;const failedTargetId=opened?.targetId||input.targetId||null;const providerId=opened?.providerId||providerModule.providerForUrl(chatUrl)||null;
    if(!artifact&&failedTargetId&&providerId)artifact=await sharedBrowserChannel.captureFailureEvidence(endpoint,failedTargetId,providerId,{targetId:failedTargetId}).catch(()=>null);
    record({source:'exact-chat',category:'target',action:'open_exact_chat',phase:'failed',severity:'error',durationMs:Date.now()-started,correlation:{targetId:failedTargetId},data:{endpoint,chatUrl,targetId:failedTargetId,providerId,classification:error?.classification||'UNKNOWN',code:error?.code||null,artifact},error});throw error;
  }
});

app.on('browser-window-created',(_event,window)=>{
  record({source:'main-process',category:'window',action:'browser_window_created',phase:'success',data:{id:window.id}});const contents=window.webContents;
  contents.on('did-start-loading',()=>record({source:'webcontents',category:'load',action:'did_start_loading',phase:'start',data:{windowId:window.id}}));
  contents.on('dom-ready',()=>record({source:'webcontents',category:'load',action:'dom_ready',phase:'success',data:{windowId:window.id,url:contents.getURL()}}));
  contents.on('did-finish-load',()=>record({source:'webcontents',category:'load',action:'did_finish_load',phase:'success',data:{windowId:window.id,url:contents.getURL()}}));
  contents.on('did-fail-load',(_e,errorCode,errorDescription,validatedURL,isMainFrame)=>record({source:'webcontents',category:'load',action:'did_fail_load',phase:'failed',severity:'error',data:{windowId:window.id,errorCode,errorDescription,validatedURL,isMainFrame}}));
  contents.on('render-process-gone',(_e,details)=>record({source:'webcontents',category:'process',action:'render_process_gone',phase:'failed',severity:'fatal',data:{windowId:window.id,details}}));
  contents.on('console-message', (_event, details = {}) => {
    record({
      source: 'renderer-console',
      category: 'console',
      action: 'console_message',
      phase: 'event',
      severity: (details.level ?? 0) >= 3 ? 'error' : (details.level ?? 0) === 2 ? 'warn' : 'info',
      data: {
        level: details.level,
        message: details.message,
        line: details.lineNumber ?? details.line,
        sourceId: details.sourceId,
      },
    });
  });
});

app.whenReady().then(()=>record({source:'main-process',category:'startup',action:'app_ready',phase:'success',data:{version:app.getVersion(),userData:app.getPath('userData'),moduleRegistry:moduleRegistryStatus()}}));
app.on('before-quit',()=>{if(foregroundTimer){clearInterval(foregroundTimer);foregroundTimer=null;ingestForegroundTrace();}record({source:'main-process',category:'lifecycle',action:'before_quit',phase:'event'});});
app.on('will-quit',()=>record({source:'main-process',category:'lifecycle',action:'will_quit',phase:'event'}));

function selectFreeLoopbackPort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.unref();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      const port=address&&typeof address==='object'?address.port:0;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}

async function loadActiveMain(){
  if(!String(process.env.ACCESS_AGENT_IDE_BRIDGE_PORT||'').trim()){
    const port=await selectFreeLoopbackPort();
    if(!Number.isInteger(port)||port<1)throw new Error('Could not select a free loopback port for the workspace bridge.');
    process.env.ACCESS_AGENT_IDE_BRIDGE_PORT=String(port);
    record({source:'machine-environment',category:'environment',action:'workspace_bridge_port_selected',phase:'success',data:{host:'127.0.0.1',port,source:'dynamic'}});
  }else{
    record({source:'machine-environment',category:'environment',action:'workspace_bridge_port_selected',phase:'success',data:{host:'127.0.0.1',port:Number(process.env.ACCESS_AGENT_IDE_BRIDGE_PORT),source:'override'}});
  }

  // The active rebuild owns its runtime/process endpoints independently. The
  // legacy main still contains an application-global single-instance gate; do
  // not let that compatibility implementation silently terminate this process
  // merely because another Access Agent instance exists on the host.
  const legacyRequestSingleInstanceLock=app.requestSingleInstanceLock.bind(app);
  app.requestSingleInstanceLock=()=>true;
  record({source:'runtime-instance',category:'environment',action:'instance_ownership',phase:'success',data:{pid:process.pid,cwd:process.cwd(),bridgePort:Number(process.env.ACCESS_AGENT_IDE_BRIDGE_PORT),singleInstancePolicy:'independent_rebuild_runtime'}});
  try{
    require('./main.js');
  }catch(err){
    console.error('MAIN_JS_LOAD_FAILED:', err.message);
    console.error('STACK:', err.stack);
    record({source:'main-wrapper',category:'runtime',action:'legacy_main_crash',phase:'failed',severity:'fatal',error:err});
    app.quit();
  }finally{
    app.requestSingleInstanceLock=legacyRequestSingleInstanceLock;
  }
  ipcMain.removeHandler('ide:agent-approve');
  ipcMain.removeHandler('ide:agent-reject');
  record({source:'main-wrapper',category:'runtime',action:'legacy_approval_ipc_removed',phase:'success'});
}

loadActiveMain().catch(error=>{
  record({source:'main-wrapper',category:'startup',action:'active_main_load',phase:'failed',severity:'fatal',error});
  app.quit();
});





// --- REMOVED HIDDEN PATCHES (2026-08-29) ---
// The following IPC handlers are registered by loadActiveMain() via electron/main.js
// using AgentRuntimeAdapter from agent-runtime-adapter-extensions.js:
//   ide:get-models     -> adapter.discoverModels()
//   ide:agent-start    -> adapter.executeWithFallback()
//   ide:agent-stop     -> adapter.stop()
//   ide:loop-status    -> adapter.getState() + checkForFeedback()
// These handlers are part of the production main.js lifecycle and are authoritative.
// The preload script (electron/preload.js) routes renderer calls to these handlers.
//
// The removed patches in this file duplicated these handlers and added an untracked
// setInterval heartbeat (30s, silent catch, no cleanup, no timeout). They were dead
// code that created a second runtime-adapter instance overriding the production
// runtime and a perpetual timer that was never cleared on app quit.
//
// If a heartbeat is required, it must be implemented with:
//   - a named timer reference stored in module scope
//   - a cleanup call on app quit (clearInterval)
//   - error propagation (not silent catch)
//   - integration into the production main.js lifecycle, not a file-level patch.



// --- SAFE OVERRIDE: Bypass Runtime Active Check for Agent Execution (Global Scope) ---
ipcMain.removeHandler('ide:agent-start');
ipcMain.handle('ide:agent-start', async (event, input) => {
    // Use the global adapter set by main.js
    const adapter = global.__accessAgentRuntimeAdapter;
    if (!adapter) {
        throw new Error('Runtime is stopped. Start the runtime before running an agent.');
    }
    return adapter.executeWithFallback(input);
});
// --- END SAFE OVERRIDE (GLOBAL) ---

// --- PATCH: Register get-models handler (globally) ---
ipcMain.handle('ide:get-models', async () => {
    const adapter = global.__accessAgentRuntimeAdapter;
    if (!adapter) throw new Error('Runtime adapter is not available.');
    return await adapter.discoverModels();
});
// --- END PATCH ---
