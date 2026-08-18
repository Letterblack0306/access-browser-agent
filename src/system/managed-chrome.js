'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MachineEnvironment } = require('./machine-environment');

function chromeExecutable(configured = '') {
  return String(configured || '').trim();
}

function defaultManagedProfilePath() {
  const root = process.env.APPDATA || process.env.LOCALAPPDATA || process.env.HOME || process.cwd();
  return path.join(root, 'Access Agent', 'Managed Chrome');
}

function commonChromeCandidates({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
    const relatives = [
      ['Google','Chrome','Application','chrome.exe'],
      ['Chromium','Application','chrome.exe'],
    ];
    return unique(roots.flatMap(root => relatives.map(parts => path.join(root, ...parts))));
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [];
}

async function resolveChromeExecutable(configured = '', { machineEnvironment = new MachineEnvironment(), access = fs.access } = {}) {
  const explicit = chromeExecutable(configured);
  if (explicit) {
    const resolved = path.resolve(explicit);
    try { await access(resolved); return { executable:resolved, source:'override' }; }
    catch (error) {
      const wrapped = new Error(`Configured Chrome executable is unavailable: ${resolved}: ${error.message}`);
      wrapped.code = 'CHROME_EXECUTABLE_NOT_FOUND'; wrapped.classification = 'ENVIRONMENT'; throw wrapped;
    }
  }

  const names = machineEnvironment.platform === 'win32'
    ? ['chrome','chromium']
    : machineEnvironment.platform === 'darwin'
      ? ['google-chrome','chromium']
      : ['google-chrome','google-chrome-stable','chromium','chromium-browser'];
  for (const name of names) {
    const result = await machineEnvironment.resolveExecutable(name).catch(() => null);
    if (result?.available && result.resolved) return { executable:result.resolved, source:'PATH', requested:name };
  }

  for (const candidate of commonChromeCandidates({ platform:machineEnvironment.platform, env:machineEnvironment.env })) {
    try { await access(candidate); return { executable:path.resolve(candidate), source:'common_location' }; }
    catch {}
  }

  const error = new Error('Google Chrome or Chromium was not found on the active host. Configure a browser executable override or install a supported browser.');
  error.code = 'CHROME_EXECUTABLE_NOT_FOUND'; error.classification = 'ENVIRONMENT'; throw error;
}

function diagnostic(action, phase, data = {}, error = null) {
  try { global.__accessAgentDiagnosticLog?.write?.({ source:'managed-chrome', category:'browser', action, phase, severity:error ? 'error' : 'info', data, error }); } catch {}
}

class ManagedChrome {
  constructor({ getSettings, spawnImpl = spawn, readFile = fs.readFile, unlinkImpl = fs.unlink, delayImpl = delay, fetchImpl = global.fetch, defaultProfilePath = defaultManagedProfilePath(), machineEnvironment = new MachineEnvironment(), accessImpl = fs.access } = {}) {
    this.getSettings = getSettings || (() => ({})); this.spawn = spawnImpl; this.readFile = readFile; this.unlink = unlinkImpl; this.delay = delayImpl; this.fetch = fetchImpl;
    this.defaultProfilePath = path.resolve(String(defaultProfilePath || defaultManagedProfilePath()));
    this.machineEnvironment = machineEnvironment; this.access = accessImpl;
    this.child = null; this.endpoint = ''; this.error = ''; this.lifecycle = 'unconfigured'; this.launchActivePort = null; this.generation = 0; this.resolvedExecutable = null; this.executableSource = null;
    this.launchInProgress = false; this.launcherExit = null; this.bootstrapUrl = null; this.bootstrapTargetId = null;
  }
  profilePath(settings = this.getSettings() || {}) {
    const configured = String(settings.browserProfilePath || '').trim();
    return path.resolve(configured || this.defaultProfilePath);
  }
  status() {
    const settings = this.getSettings() || {};
    const configuredProfilePath = String(settings.browserProfilePath || '').trim();
    const launcherRunning = Boolean(this.child && !this.child.killed);
    const backendReady = Boolean(this.endpoint && this.lifecycle === 'ready');
    return {
      lifecycle:this.lifecycle,
      mode:settings.browserMode || 'managed',
      profilePath:this.profilePath(settings),
      profileSource:configuredProfilePath?'override':'access_owned_default',
      executable:this.resolvedExecutable || chromeExecutable(settings.browserExecutable) || null,
      executableSource:this.executableSource || (chromeExecutable(settings.browserExecutable)?'override_pending':'not_resolved'),
      endpoint:this.endpoint || null,
      running:backendReady || launcherRunning,
      backendReady,
      launcherRunning,
      launchInProgress:this.launchInProgress,
      pid:this.child?.pid || null,
      launcherExit:this.launcherExit ? { ...this.launcherExit } : null,
      error:this.error || null,
      generation:this.generation,
      bootstrapUrl:this.bootstrapUrl,
      bootstrapTargetId:this.bootstrapTargetId,
    };
  }
  async start() {
    const settings = this.getSettings() || {};
    if ((settings.browserMode || 'managed') !== 'managed') { this.lifecycle='unconfigured'; throw new Error('Managed Chrome is disabled. Select Managed Chrome in Settings to launch it.'); }
    const profilePath = this.profilePath(settings);
    this.lifecycle='discovering';
    let resolved;
    try {
      resolved = await resolveChromeExecutable(settings.browserExecutable, { machineEnvironment:this.machineEnvironment, access:this.access });
      this.resolvedExecutable = resolved.executable; this.executableSource = resolved.source;
      await fs.mkdir(profilePath,{recursive:true});
    } catch(error){ this.error=error.message; this.lifecycle='unavailable'; const wrapped=new Error(`Managed Chrome setup failed: ${error.message}`); wrapped.code=error.code || 'CHROME_SETUP_FAILED'; wrapped.classification='ENVIRONMENT'; diagnostic('setup','failed',{ profilePath },wrapped); throw wrapped; }
    const executable = resolved.executable;
    diagnostic('setup','success',{ executable, executableSource:resolved.source, profilePath, profileSource:String(settings.browserProfilePath||'').trim()?'override':'access_owned_default', requestedPort:0 });
    if (this.endpoint && this.lifecycle === 'ready') {
      await this.readyEndpoint();
      diagnostic('start','success',{ reused:true, pid:this.child?.pid || null, endpoint:this.endpoint, generation:this.generation });
      return this.status();
    }
    if (this.child && !this.child.killed) {
      await this.readyEndpoint();
      diagnostic('start','success',{ reused:true, pid:this.child.pid, endpoint:this.endpoint, generation:this.generation });
      return this.status();
    }
    const generation=++this.generation;
    this.bootstrapUrl=`data:text/html;charset=utf-8,<title>Access%20Agent%20bootstrap%20${generation}</title>`;
    this.bootstrapTargetId=null;
    const args=['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profilePath}`,'--no-first-run','--no-default-browser-check','--new-window',this.bootstrapUrl];
    this.endpoint='';
    const previousActivePort=await this._clearStaleActivePort(profilePath);
    this.launchActivePort=null;
    this.launcherExit=null;
    this.launchInProgress=true;
    diagnostic('spawn','start',{ executable, executableSource:resolved.source, args, generation, previousDevToolsActivePort:Boolean(previousActivePort), staleMarkerCleared:true, profileSource:String(settings.browserProfilePath||'').trim()?'override':'access_owned_default' });
    let child=null;
    try {
      child=this.spawn(executable,args,{detached:false,stdio:'ignore',windowsHide:true});
      this.child=child; this.error='';
      diagnostic('spawn','success',{ pid:child.pid, generation });
      child.once('exit',(code,signal)=>{
        const ownsCurrent=this.child===child;
        const ownsGeneration=this.generation===generation;
        const exit={ pid:child.pid || null, code:code ?? null, signal:signal || null, generation, at:new Date().toISOString() };
        diagnostic('process_exit','event',{ ...exit, ownsCurrent, ownsGeneration, backendReady:Boolean(this.endpoint) });
        if(!ownsGeneration)return;
        this.launcherExit=exit;
        if(!ownsCurrent)return;
        this.child=null;
        this.launchActivePort=null;
        if(this.endpoint){
          this.lifecycle='ready';
          return;
        }
        this.lifecycle=this.launchInProgress?'discovering':'stopped';
      });
      await this.readyEndpoint();
      this.launchInProgress=false;
      diagnostic('start','success',{ pid:child.pid, endpoint:this.endpoint, generation, launcherExit:this.launcherExit });
      return this.status();
    } catch(error){
      this.launchInProgress=false;
      if(child && this.child===child && !child.killed) child.kill();
      if(this.child===child)this.child=null;
      this.endpoint=''; this.error=error.message; this.lifecycle='unavailable';
      const wrapped=new Error(`Could not launch Managed Chrome: ${error.message}`);
      wrapped.code=error.code || 'CHROME_LAUNCH_FAILED'; wrapped.classification=error.classification || 'BROWSER';
      wrapped.launcherExit=this.launcherExit ? { ...this.launcherExit } : null;
      diagnostic('start','failed',{ generation, launcherExit:this.launcherExit },wrapped);
      throw wrapped;
    }
  }
  async _readActivePort(profilePath) {
    const activePortFile=path.join(profilePath,'DevToolsActivePort');
    try { const value=String(await this.readFile(activePortFile,'utf8')); diagnostic('devtools_active_port_read','success',{ file:activePortFile, contentPresent:Boolean(value) }); return value; }
    catch(error){ diagnostic('devtools_active_port_read','event',{ file:activePortFile, code:error?.code || null }); return null; }
  }
  async _clearStaleActivePort(profilePath) {
    const activePortFile=path.join(profilePath,'DevToolsActivePort');
    const previous=await this._readActivePort(profilePath);
    if(previous===null)return null;
    try { await this.unlink(activePortFile); diagnostic('devtools_active_port_stale_cleanup','success',{file:activePortFile,contentPresent:Boolean(previous)}); }
    catch(error){
      if(error?.code!=='ENOENT'){
        const wrapped=new Error(`Could not clear stale DevToolsActivePort marker: ${error.message}`);
        wrapped.code='CDP_STALE_MARKER_CLEANUP_FAILED'; wrapped.classification='BROWSER'; throw wrapped;
      }
    }
    return previous;
  }
  async _discoverEndpoint(profilePath) {
    const content=await this._readActivePort(profilePath);
    if(!content)return '';
    const [port]=content.split(/\r?\n/u); const endpoint=positivePort(port)?`http://127.0.0.1:${port}`:'';
    if(endpoint) diagnostic('endpoint_discovered','success',{ endpoint });
    return endpoint;
  }
  async readyEndpoint() {
    const hasLauncher=Boolean(this.child && !this.child.killed);
    const hasBackend=Boolean(this.endpoint);
    if(!hasLauncher && !hasBackend && !this.launchInProgress){
      this.endpoint='';this.lifecycle='unavailable';
      const error=new Error('Managed Chrome is not running; launch it before using the CDP endpoint.');
      error.code='CHROME_NOT_RUNNING';error.classification='BROWSER';throw error;
    }
    const settings=this.getSettings()||{}; const profilePath=this.profilePath(settings); let lastError=null; const attempted=new Set();
    for(let attempt=0;attempt<30;attempt+=1){
      this.lifecycle=this.endpoint?'reconnecting':'discovering';
      const discovered=await this._discoverEndpoint(profilePath);
      const candidates=[...new Set([this.endpoint,discovered].filter(Boolean))];
      const newCandidates=candidates.filter(candidate=>!attempted.has(candidate));
      if(newCandidates.length||attempt===29)diagnostic('endpoint_probe_cycle','event',{attempt:attempt+1,candidates,newCandidates,launcherRunning:Boolean(this.child&&!this.child.killed),launcherExit:this.launcherExit});
      for(const candidate of candidates){
        const firstAttempt=!attempted.has(candidate);
        attempted.add(candidate);
        try{
          this.lifecycle='connecting';
          if(typeof this.fetch!=='function')throw new Error('Fetch is unavailable for CDP verification.');
          const response=await this.fetch(`${candidate}/json/version`,{signal:AbortSignal.timeout(2500)});
          if(!response.ok)throw new Error(`CDP returned HTTP ${response.status}.`);
          this.endpoint=candidate;this.error='';this.lifecycle='ready';
          diagnostic('endpoint_verified','success',{ endpoint:candidate, attempt:attempt+1, status:response.status, launcherRunning:Boolean(this.child&&!this.child.killed), launcherExit:this.launcherExit });
          return candidate;
        }catch(error){
          lastError=error;
          if(firstAttempt||attempt===29)diagnostic('endpoint_probe','failed',{ endpoint:candidate, attempt:attempt+1 },error);
          if(candidate===this.endpoint)this.endpoint='';
        }
      }
      if(attempt<29)await this.delay(100);
    }
    this.endpoint='';
    const targets=attempted.size?[...attempted].join(', '):'no discovered endpoint';
    let error;
    if(this.launcherExit){
      error=new Error(`Managed Chrome launcher exited before a usable current-generation CDP endpoint was verified (exitCode=${this.launcherExit.code ?? 'unknown'}, signal=${this.launcherExit.signal || 'none'}).`);
      error.code='CHROME_EXITED_BEFORE_CDP';
      error.launcherExit={...this.launcherExit};
    }else{
      error=new Error(`Managed Chrome CDP is unavailable at ${targets}: ${lastError?.message || 'connection failed'}`);
      error.code='CDP_UNAVAILABLE';
    }
    error.classification='BROWSER';
    this.error=error.message;this.lifecycle='unavailable';
    diagnostic('endpoint_verified','failed',{ attempted:[...attempted], launcherExit:this.launcherExit },error);
    throw error;
  }
  claimBootstrapTarget(targets=[]) {
    if(this.bootstrapTargetId||!this.bootstrapUrl)return this.bootstrapTargetId;
    const matches=targets.filter(target=>target?.type==='page'&&String(target.url||'')===this.bootstrapUrl);
    if(matches.length!==1)return null;
    this.bootstrapTargetId=String(matches[0].targetId||matches[0].id||'')||null;
    diagnostic('bootstrap_target_claimed','success',{generation:this.generation,targetId:this.bootstrapTargetId});
    return this.bootstrapTargetId;
  }
  releaseBootstrapTarget(targetId) {
    if(!this.bootstrapTargetId||String(targetId)!==this.bootstrapTargetId)return false;
    diagnostic('bootstrap_target_released','success',{generation:this.generation,targetId:this.bootstrapTargetId});
    this.bootstrapTargetId=null;this.bootstrapUrl=null;return true;
  }
  async stop() {
    const child=this.child; const generation=++this.generation; this.lifecycle='stopping'; this.launchInProgress=false;
    diagnostic('stop','start',{ pid:child?.pid || null, endpoint:this.endpoint || null, generation });
    if(child && !child.killed){try{child.kill();}catch(error){diagnostic('stop_kill','failed',{pid:child.pid},error);}}
    if(this.child===child)this.child=null;
    this.endpoint='';this.error='';this.launchActivePort=null;this.launcherExit=null;this.bootstrapUrl=null;this.bootstrapTargetId=null;this.lifecycle='stopped';
    diagnostic('stop','success',{ pid:child?.pid || null, generation });
    return this.status();
  }
}

function positivePort(value){const port=Number(value);return Number.isInteger(port)&&port>=1024&&port<=65535?port:null;}
function unique(items){return [...new Set(items)];}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
module.exports={ManagedChrome,chromeExecutable,resolveChromeExecutable,commonChromeCandidates,defaultManagedProfilePath,positivePort};
