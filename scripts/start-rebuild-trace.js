'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const electron=require('electron');

const root=path.resolve(__dirname,'..');
const sessionId=crypto.randomUUID();
const stamp=new Date().toISOString().replace(/[:.]/gu,'-');
const diagnosticDir=path.join(os.homedir(),'.access-agent','diagnostics');
fs.mkdirSync(diagnosticDir,{recursive:true});
const diagnosticFile=path.join(diagnosticDir,`access-agent-${stamp}-${sessionId.slice(0,8)}.jsonl`);
const spoolFile=path.join(diagnosticDir,`foreground-${stamp}-${sessionId.slice(0,8)}.jsonl`);
fs.writeFileSync(diagnosticFile,'',{flag:'a'});
fs.writeFileSync(spoolFile,'',{flag:'a'});

function appendSpool(stream,text){
  const value=String(text??'');
  if(!value)return;
  fs.appendFileSync(spoolFile,`${JSON.stringify({timestamp:new Date().toISOString(),stream,text:value})}\n`,'utf8');
}

const env={
  ...process.env,
  ACCESS_AGENT_DIAGNOSTIC_FILE:diagnosticFile,
  ACCESS_AGENT_DIAGNOSTIC_SESSION:sessionId,
  ACCESS_AGENT_FOREGROUND_TRACE_FILE:spoolFile,
};

const child=spawn(electron,['.'],{cwd:root,env,stdio:['inherit','pipe','pipe'],windowsHide:false});
child.stdout.on('data',chunk=>{appendSpool('stdout',chunk.toString());process.stdout.write(chunk);});
child.stderr.on('data',chunk=>{appendSpool('stderr',chunk.toString());process.stderr.write(chunk);});
child.on('error',error=>{appendSpool('launcher-error',error.stack||error.message||String(error));});
child.on('close',(code,signal)=>{
  const lines=fs.readFileSync(diagnosticFile,'utf8').split(/\r?\n/u).filter(Boolean);
  let seq=0;
  if(lines.length){try{seq=Number(JSON.parse(lines.at(-1))?.seq||0)||0;}catch{}}
  const record={
    schema:'access-agent.diagnostic.v1',
    seq:seq+1,
    timestamp:new Date().toISOString(),
    sessionId,
    pid:process.pid,
    source:'foreground-launcher',
    category:'process',
    action:'electron_exit',
    phase:code===0?'success':'failed',
    severity:code===0?'info':'error',
    classification:code===0?'UNKNOWN':'ENVIRONMENT',
    durationMs:null,
    correlation:{},
    data:{exitCode:code,signal:signal||null,spoolFile},
    error:null,
  };
  fs.appendFileSync(diagnosticFile,`${JSON.stringify(record)}\n`,'utf8');
  console.log(`\n[Access Agent trace] diagnostic=${diagnosticFile}`);
  console.log(`[Access Agent trace] foreground-spool=${spoolFile}`);
  process.exitCode=Number.isInteger(code)?code:1;
});
