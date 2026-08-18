'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const SECRET_KEY=/(password|passwd|secret|token|api.?key|authorization|cookie|credential|access.?token|refresh.?token|oauth|clineauthurl)/iu;
const MAX_STRING=12000;
const MAX_ARRAY=100;
const MAX_DEPTH=8;
const DEFAULT_DUPLICATE_WINDOW_MS=15000;
const MAX_SIGNATURES=2000;
const SUPPRESSED_DIAGNOSTIC=Object.freeze({suppressed:true});

function nowIso(){return new Date().toISOString();}
function id(){return crypto.randomUUID();}

function redactText(value){
  return String(value??'')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu,'Bearer [REDACTED]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/gu,'[REDACTED_API_KEY]')
    .replace(/([?&](?:token|access_token|refresh_token|code|secret|api_key|apikey|key)=)[^&#\s]+/giu,'$1[REDACTED]')
    .replace(/((?:token|access_token|refresh_token|secret|api[_-]?key|password)\s*[:=]\s*)[^\s,;]+/giu,'$1[REDACTED]');
}

function safeString(value){const redacted=redactText(value);return redacted.length>MAX_STRING?`${redacted.slice(0,MAX_STRING)}…[truncated ${redacted.length-MAX_STRING} chars]`:redacted;}

function sanitize(value,key='',depth=0,seen=new WeakSet()){
  if(SECRET_KEY.test(String(key||'')))return'[REDACTED]';
  if(value==null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return safeString(value);
  if(typeof value==='bigint')return String(value);
  if(typeof value==='function')return`[Function ${value.name||'anonymous'}]`;
  if(depth>=MAX_DEPTH)return'[MAX_DEPTH]';
  if(typeof value!=='object')return safeString(value);
  if(seen.has(value))return'[CIRCULAR]';
  seen.add(value);
  if(value instanceof Error)return{name:safeString(value.name),message:safeString(value.message),code:value.code==null?null:safeString(value.code),classification:value.classification==null?null:safeString(value.classification),stack:safeString(value.stack||''),cause:value.cause?sanitize(value.cause,'cause',depth+1,seen):null};
  if(Array.isArray(value)){const items=value.slice(0,MAX_ARRAY).map((item,index)=>sanitize(item,String(index),depth+1,seen));if(value.length>MAX_ARRAY)items.push(`[TRUNCATED ${value.length-MAX_ARRAY} items]`);return items;}
  const out={};for(const [entryKey,entryValue] of Object.entries(value))out[entryKey]=sanitize(entryValue,entryKey,depth+1,seen);return out;
}

function classify(input={}){
  const explicit=String(input.classification||input.error?.classification||input.data?.classification||'').trim().toUpperCase();
  const allowed=new Set(['USER_SETUP','ENVIRONMENT','PROVIDER','BROWSER','TARGET','TRANSPORT','AGENT','TOOL','WORKSPACE','UI','INTERNAL','UNKNOWN']);
  if(allowed.has(explicit))return explicit;
  const code=String(input.error?.code||input.data?.code||'').toUpperCase();
  const haystack=`${input.source||''} ${input.category||''} ${input.action||''} ${code}`.toLowerCase();
  if(/PROFILE_MISSING|URL_INVALID|URL_MISSING|LOGIN_REQUIRED|AUTH_REQUIRED|UNSUPPORTED_CHAT_PROVIDER/u.test(code))return'USER_SETUP';
  if(haystack.includes('provider')||haystack.includes('lm-studio')||haystack.includes('cline'))return'PROVIDER';
  if(haystack.includes('relay')||haystack.includes('delivery')||haystack.includes('transport'))return'TRANSPORT';
  if(haystack.includes('browser')||haystack.includes('chrome')||haystack.includes('cdp'))return code.includes('TARGET')||code.includes('CHAT_IDENTITY')?'TARGET':'BROWSER';
  if(haystack.includes('agent'))return'AGENT';
  if(haystack.includes('tool')||haystack.includes('terminal'))return'TOOL';
  if(haystack.includes('workspace')||haystack.includes('git'))return'WORKSPACE';
  if(haystack.includes('renderer')||haystack.includes('ui'))return'UI';
  if(haystack.includes('main-process')||haystack.includes('process'))return'INTERNAL';
  return'UNKNOWN';
}

function lastSequence(file){
  try{
    const lines=fs.readFileSync(file,'utf8').split(/\r?\n/u).filter(Boolean);
    if(!lines.length)return 0;
    const parsed=JSON.parse(lines.at(-1));
    return Number(parsed?.seq||0)||0;
  }catch{return 0;}
}

function diagnosticSignature(record){
  const payload={
    source:record.source,category:record.category,action:record.action,phase:record.phase,
    severity:record.severity,classification:record.classification,correlation:record.correlation,
    data:record.data,error:record.error,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

class RuntimeDiagnosticLog{
  constructor({root,sessionId=id(),clock=nowIso,clockMs=Date.now,pid=process.pid,filePath=null,duplicateWindowMs=DEFAULT_DUPLICATE_WINDOW_MS}={}){
    if(!root&&!filePath)throw new Error('Runtime diagnostic log root is required.');
    this.root=path.resolve(root||path.dirname(filePath));
    this.sessionId=String(sessionId);
    this.clock=clock;this.clockMs=clockMs;this.pid=pid;this.startedAt=this.clock();
    this.duplicateWindowMs=Math.max(0,Number(duplicateWindowMs)||0);
    this.recentSignatures=new Map();
    const stamp=this.startedAt.replace(/[:.]/gu,'-');
    this.path=filePath?path.resolve(filePath):path.join(this.root,`access-agent-${stamp}-${this.sessionId.slice(0,8)}.jsonl`);
    fs.mkdirSync(path.dirname(this.path),{recursive:true});
    fs.writeFileSync(this.path,'',{encoding:'utf8',flag:'a'});
    this.seq=lastSequence(this.path);
  }

  write(input={}){
    try{
      const timestamp=this.clock();
      const nowMs=Number(this.clockMs());
      const base={schema:'access-agent.diagnostic.v1',timestamp,sessionId:this.sessionId,pid:this.pid,source:String(input.source||'unknown'),category:String(input.category||'diagnostic'),action:String(input.action||input.phase||'event'),phase:String(input.phase||'event'),severity:String(input.severity||(input.error?'error':'info')),classification:classify(input),durationMs:Number.isFinite(input.durationMs)?Number(input.durationMs):null,correlation:sanitize(input.correlation||{}),data:sanitize(input.data??input.detail??{}),error:input.error?sanitize(input.error,'error'):null};
      const signature=diagnosticSignature(base);
      const previous=this.recentSignatures.get(signature);
      if(previous&&this.duplicateWindowMs>0&&nowMs-previous.lastSeenMs<this.duplicateWindowMs){
        previous.lastSeenMs=nowMs;
        previous.lastSeenAt=timestamp;
        previous.suppressed+=1;
        return SUPPRESSED_DIAGNOSTIC;
      }
      const repeat=previous?.suppressed?{suppressed:previous.suppressed,firstSeenAt:previous.firstSeenAt,lastSeenAt:previous.lastSeenAt}:null;
      const record={...base,seq:++this.seq,...(repeat?{repeat}: {})};
      fs.appendFileSync(this.path,`${JSON.stringify(record)}\n`,'utf8');
      this.recentSignatures.set(signature,{firstSeenAt:timestamp,lastSeenAt:timestamp,lastSeenMs:nowMs,suppressed:0});
      if(this.recentSignatures.size>MAX_SIGNATURES){
        const remove=this.recentSignatures.size-MAX_SIGNATURES;
        let index=0;
        for(const key of this.recentSignatures.keys()){this.recentSignatures.delete(key);if(++index>=remove)break;}
      }
      return record;
    }catch(error){return{schema:'access-agent.diagnostic.v1',seq:this.seq,timestamp:this.clock(),sessionId:this.sessionId,source:'diagnostic-log',category:'diagnostic',action:'write_failed',phase:'failed',severity:'error',classification:'INTERNAL',data:{},error:{message:error?.message||String(error)}};}
  }

  info(){return{schema:'access-agent.diagnostic.v1',sessionId:this.sessionId,startedAt:this.startedAt,path:this.path,root:this.root,seq:this.seq};}
  readRecent(limit=1000){const bounded=Math.max(1,Math.min(10000,Number(limit)||1000));let text='';try{text=fs.readFileSync(this.path,'utf8');}catch{return[];}const lines=text.split(/\r?\n/u).filter(Boolean);return lines.slice(-bounded).map(line=>{try{return JSON.parse(line);}catch{return{schema:'access-agent.diagnostic.v1',source:'diagnostic-log',phase:'parse_failed',classification:'INTERNAL',raw:safeString(line)};}});}
}

module.exports={RuntimeDiagnosticLog,sanitize,safeString,redactText,classify,SECRET_KEY,lastSequence,diagnosticSignature,DEFAULT_DUPLICATE_WINDOW_MS,SUPPRESSED_DIAGNOSTIC};
