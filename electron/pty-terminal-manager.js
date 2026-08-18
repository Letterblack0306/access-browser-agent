'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { emitDiagnostic } = require('../src/system/runtime-diagnostic-bus');

function loadNativePty() { try { return require('node-pty'); } catch { return null; } }

class PtyTerminalManager {
  constructor(options = {}) { this.pty=Object.prototype.hasOwnProperty.call(options,'pty')?options.pty:loadNativePty();this.spawn=options.spawn||childProcess.spawn;this.sessions=new Map(); }
  create({owner,cwd,shell,cols=120,rows=30}) {
    if(!owner||typeof owner.send!=='function')throw new Error('PTY owner webContents is required.');
    const terminalId=crypto.randomUUID();
    emitDiagnostic({source:'terminal',category:'terminal',action:'create',phase:'start',correlation:{operationId:`terminal-${terminalId}`},data:{terminalId,cwd,shell,nativePtyAvailable:Boolean(this.pty?.spawn)}});
    if(this.pty?.spawn){try{return this._createNative({terminalId,owner,cwd,shell,cols,rows});}catch(error){emitDiagnostic({source:'terminal',category:'terminal',action:'native_spawn',phase:'failed',severity:'warn',correlation:{operationId:`terminal-${terminalId}`},data:{terminalId},error});return this._createFallback({terminalId,owner,cwd,shell,nativeError:error});}}
    return this._createFallback({terminalId,owner,cwd,shell,nativeError:null});
  }
  _createNative({terminalId,owner,cwd,shell,cols,rows}) {
    const processRef=this.pty.spawn(shell,[],{name:'xterm-256color',cwd,cols:Math.max(20,Number(cols)||120),rows:Math.max(5,Number(rows)||30),env:{...process.env,TERM:'xterm-256color',COLORTERM:'truecolor'}});
    const disposables=[];
    disposables.push(processRef.onData(data=>{emitDiagnostic({source:'terminal',category:'terminal',action:'stdout',phase:'event',correlation:{operationId:`terminal-${terminalId}`},data:{terminalId,data:String(data)}});this._send(owner,'ide:terminal-data',{terminalId,data});}));
    disposables.push(processRef.onExit(event=>{emitDiagnostic({source:'terminal',category:'terminal',action:'exit',phase:'event',correlation:{operationId:`terminal-${terminalId}`},data:{terminalId,exitCode:event.exitCode,signal:event.signal,fallback:false}});this._send(owner,'ide:terminal-exit',{terminalId,exitCode:event.exitCode,signal:event.signal,fallback:false});this.sessions.delete(terminalId);}));
    this.sessions.set(terminalId,{processRef,owner,disposables,fallback:false,child:null});
    emitDiagnostic({source:'terminal',category:'terminal',action:'create',phase:'success',correlation:{operationId:`terminal-${terminalId}`},data:{terminalId,pid:processRef.pid,cwd,shell,fallback:false,mode:'pty'}});
    return{ok:true,terminalId,pid:processRef.pid,cwd,shell,fallback:false,mode:'pty'};
  }
  _createFallback({terminalId,owner,cwd,shell,nativeError}) {
    let child=null,spawnError=null;
    try{child=this.spawn(shell,[],{cwd,env:{...process.env,TERM:'xterm-256color',COLORTERM:'truecolor'},windowsHide:true,stdio:['pipe','pipe','pipe']});}catch(error){spawnError=error;}
    const session={processRef:null,child,owner,disposables:[],fallback:true};this.sessions.set(terminalId,session);
    if(child){
      child.stdout?.on?.('data',chunk=>{emitDiagnostic({source:'terminal',category:'terminal',action:'stdout',phase:'event',correlation:{operationId:`terminal-${terminalId}`},data:{terminalId,data:String(chunk)}});this._send(owner,'ide:terminal-data',{terminalId,data:String(chunk)});});
      child.stderr?.on?.('data',chunk=>{emitDiagnostic({source:'terminal',category:'terminal',action:'stderr',phase:'event',severity:'warn',correlation:{operationId:`terminal-${terminalId}`},data:{terminalId,data:String(chunk)}});this._send(owner,'ide:terminal-data',{terminalId,data:String(chunk)});});
      child.on?.('exit',(exitCode,signal)=>{emitDiagnostic({source:'terminal',category:'terminal',action:'exit',phase:'event',correlation:{operationId:`terminal-${terminalId}`},data:{terminalId,exitCode,signal,fallback:true}});this._send(owner,'ide:terminal-exit',{terminalId,exitCode,signal,fallback:true});this.sessions.delete(terminalId);});
      child.on?.('error',error=>{emitDiagnostic({source:'terminal',category:'terminal',action:'process_error',phase:'failed',severity:'error',correlation:{operationId:`terminal-${terminalId}`},data:{terminalId},error});this._send(owner,'ide:terminal-data',{terminalId,data:`\r\n[terminal fallback error] ${error.message}\r\n`});});
    }
    const reason=spawnError?.message||nativeError?.message||(this.pty?'Native PTY spawn failed.':'Native PTY module unavailable.');
    this._send(owner,'ide:terminal-data',{terminalId,data:`\r\n[degraded terminal: process fallback] ${reason}\r\n`});
    const result={ok:Boolean(child),terminalId,pid:child?.pid||null,cwd,shell,fallback:true,mode:child?'process':'unavailable',degraded:true,error:child?null:reason};
    emitDiagnostic({source:'terminal',category:'terminal',action:'create',phase:child?'degraded':'failed',severity:child?'warn':'error',correlation:{operationId:`terminal-${terminalId}`},data:result,error:child?null:new Error(reason)});
    return result;
  }
  _send(owner,channel,payload){try{if(!owner?.isDestroyed?.())owner?.send?.(channel,payload);}catch{}}
  session(id){const session=this.sessions.get(String(id||''));if(!session)throw new Error('PTY terminal session is unavailable.');return session;}
  write(id,data){const session=this.session(id);const value=String(data??'');emitDiagnostic({source:'terminal',category:'terminal',action:'write',phase:'event',correlation:{operationId:`terminal-${id}`},data:{terminalId:String(id),length:value.length}});if(session.processRef?.write){session.processRef.write(value);return true;}if(session.child?.stdin?.writable){session.child.stdin.write(value);return true;}return false;}
  resize(id,cols,rows){const session=this.session(id);emitDiagnostic({source:'terminal',category:'terminal',action:'resize',phase:'event',correlation:{operationId:`terminal-${id}`},data:{terminalId:String(id),cols,rows,fallback:session.fallback===true}});if(!session.processRef?.resize)return false;session.processRef.resize(Math.max(20,Number(cols)||80),Math.max(5,Number(rows)||24));return true;}
  kill(id){const key=String(id||'');const session=this.sessions.get(key);if(!session)return false;try{session.processRef?.kill?.();if(!session.processRef)session.child?.kill?.();}finally{for(const disposable of session.disposables||[])disposable?.dispose?.();this.sessions.delete(key);}emitDiagnostic({source:'terminal',category:'terminal',action:'kill',phase:'success',correlation:{operationId:`terminal-${key}`},data:{terminalId:key}});return true;}
  status(id){const session=this.session(id);return{terminalId:String(id),fallback:session.fallback===true,mode:session.processRef?'pty':session.child?'process':'unavailable'};}
  dispose(){for(const id of[...this.sessions.keys()])this.kill(id);}
}
module.exports={PtyTerminalManager,loadNativePty};
