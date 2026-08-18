'use strict';

const { emitDiagnostic } = require('../system/runtime-diagnostic-bus');
const { normalizeModelCatalogEntry } = require('./ModelCatalog');

class ClineLlmsProvider {
  constructor({ providerId = 'cline', model = '', apiKeyProvider, loadLlms, timeoutMs = 180000 } = {}) {
    this.providerId = String(providerId || 'cline').trim() || 'cline';
    this.model = String(model || '').trim();
    this.apiKeyProvider = typeof apiKeyProvider === 'function' ? apiKeyProvider : async () => '';
    this.loadLlms = loadLlms || (() => import('@cline/llms'));
    this.timeoutMs = Number(timeoutMs) || 180000;
    this.health = {
      providerId:this.providerId, configured:false, reachable:false, healthy:false, modelAvailable:false,
      modelCount:0, healthMode:'lazy', lastCheckedAt:null, lastSuccessAt:null, failureReason:null,
      capabilities:{ completion:'unknown', toolCalling:'unknown', structuredOutput:'unknown' },
    };
  }

  getHealth() { return JSON.parse(JSON.stringify(this.health)); }

  async listModelCatalog() {
    const started=Date.now();
    emitDiagnostic({source:'cline-provider',category:'provider',action:'list_models',phase:'start',data:{providerId:this.providerId}});
    try {
      const llms = await this.loadLlms();
      if (typeof llms.getModelsForProvider !== 'function') throw providerError('CLINE_MODELS_UNAVAILABLE', 'Installed @cline/llms does not expose getModelsForProvider().');
      const models = await llms.getModelsForProvider(this.providerId);
      const catalog=Object.entries(models || {})
        .map(([id,info])=>normalizeModelCatalogEntry({providerId:this.providerId,providerKind:'cline',modelId:id,info:info||{}}))
        .sort((left,right)=>left.id.localeCompare(right.id));
      emitDiagnostic({source:'cline-provider',category:'provider',action:'list_models',phase:'success',durationMs:Date.now()-started,data:{providerId:this.providerId,modelCount:catalog.length}});
      return catalog;
    } catch(error) {
      emitDiagnostic({source:'cline-provider',category:'provider',action:'list_models',phase:'failed',severity:'error',durationMs:Date.now()-started,data:{providerId:this.providerId},error});
      throw error;
    }
  }

  async listModels() { return (await this.listModelCatalog()).map(item => item.id); }

  async checkHealth() {
    this.health.lastCheckedAt = new Date().toISOString();
    let apiKey = '';
    try { apiKey=String(await this.apiKeyProvider() || '').trim(); }
    catch(error){Object.assign(this.health,{configured:false,reachable:false,healthy:false,modelAvailable:false,failureReason:error?.message||String(error)});return this.getHealth();}
    if(!apiKey||!this.model){Object.assign(this.health,{configured:false,reachable:false,healthy:false,modelAvailable:false,failureReason:!apiKey?'Cline account is not authenticated.':'Cline model is not selected.'});return this.getHealth();}
    try {
      const models=await this.listModels();
      Object.assign(this.health,{configured:true,modelCount:models.length,modelAvailable:models.includes(this.model)});
      this.health.healthy=this.health.modelAvailable;this.health.reachable=this.health.healthy;
      this.health.failureReason=this.health.modelAvailable?null:`Selected Cline model is not present in the installed catalog: ${this.model}`;
      return this.getHealth();
    } catch(error){Object.assign(this.health,{configured:true,reachable:false,healthy:false,modelAvailable:false,failureReason:error?.message||String(error)});return this.getHealth();}
  }

  async complete({ messages, tools, signal } = {}) {
    const started=Date.now();
    const apiKey=String(await this.apiKeyProvider() || '').trim();
    if(!apiKey)throw providerError('CLINE_AUTH_REQUIRED','Cline account is not authenticated.');
    if(!this.model)throw providerError('CLINE_MODEL_REQUIRED','Cline model is not selected.');
    emitDiagnostic({source:'cline-provider',category:'provider',action:'completion',phase:'start',data:{providerId:this.providerId,modelId:this.model,toolCount:Array.isArray(tools)?tools.length:0}});

    try {
      const llms=await this.loadLlms();
      if(typeof llms.createHandler!=='function')throw providerError('CLINE_HANDLER_UNAVAILABLE','Installed @cline/llms does not expose createHandler().');
      const handler=llms.createHandler({providerId:this.providerId,apiKey,modelId:this.model});
      handler.setAbortSignal?.(signal);
      const {systemPrompt,conversation}=toClineConversation(messages);
      const clineTools=toClineTools(tools);
      let content='',usage=null,terminalError=null,providerStopReason=null,providerRequestId=null;
      const toolCalls=[]; const providerEventTypes=[];

      for await (const chunk of handler.createMessage(systemPrompt,conversation,clineTools)) {
        if(!chunk||typeof chunk!=='object')continue;
        const eventType=String(chunk.type||'unknown');providerEventTypes.push(eventType);
        providerRequestId ||= firstString(chunk.requestId,chunk.request_id,chunk.responseId,chunk.response_id,chunk.id);
        emitDiagnostic({source:'cline-provider',category:'provider',action:'native_event',phase:'event',data:{providerId:this.providerId,modelId:this.model,providerEventType:eventType,providerRequestId,success:chunk.success??null}});
        if(chunk.type==='text') content+=String(chunk.text||'');
        else if(chunk.type==='tool_calls') {
          const fn=chunk.tool_call?.function||{};const name=String(fn.name||'').trim();if(!name)continue;
          toolCalls.push({id:String(chunk.tool_call?.call_id||fn.id||`tool-call-${toolCalls.length+1}`),name,arguments:parseArguments(fn.arguments,name)});
        } else if(chunk.type==='usage') {
          usage={inputTokens:chunk.inputTokens??null,outputTokens:chunk.outputTokens??null,cacheReadTokens:chunk.cacheReadTokens??null,cacheWriteTokens:chunk.cacheWriteTokens??null,reasoningTokens:chunk.thoughtsTokenCount??null,totalCost:chunk.totalCost??null};
        } else if(chunk.type==='done') {
          providerStopReason=chunk.success===false?'error':'done';
          if(chunk.success===false)terminalError=chunk.error||'Cline provider returned an unsuccessful terminal result.';
        }
      }

      if(terminalError)throw providerError('CLINE_PROVIDER_ERROR',String(terminalError));
      Object.assign(this.health,{configured:true,reachable:true,healthy:true,modelAvailable:true,lastCheckedAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),failureReason:null});
      const native={providerId:this.providerId,providerRequestId,providerEventTypes:[...new Set(providerEventTypes)],providerStopReason,modelId:this.model};
      emitDiagnostic({source:'cline-provider',category:'provider',action:'completion',phase:'success',durationMs:Date.now()-started,correlation:{providerRequestId},data:{...native,toolCalls:toolCalls.map(item=>item.name),usage}});
      return {content:content.trim()||null,toolCalls,model:this.model,usage,...native};
    } catch(error) {
      emitDiagnostic({source:'cline-provider',category:'provider',action:'completion',phase:'failed',severity:'error',durationMs:Date.now()-started,data:{providerId:this.providerId,modelId:this.model},error});
      throw error;
    }
  }
}

function toClineConversation(messages = []) {
  const system=[],conversation=[],toolNames=new Map();
  for(const message of Array.isArray(messages)?messages:[]) {
    if(!message||typeof message!=='object')continue;
    if(message.role==='system'){const text=String(message.content||'').trim();if(text)system.push(text);continue;}
    if(message.role==='user'){const text=String(message.content||'').trim();if(text)conversation.push({role:'user',content:[{type:'text',text}]});continue;}
    if(message.role==='assistant'){
      const blocks=[];const text=String(message.content||'').trim();if(text)blocks.push({type:'text',text});
      for(const call of Array.isArray(message.tool_calls)?message.tool_calls:[]){const id=String(call?.id||'').trim();const name=String(call?.function?.name||'').trim();if(!id||!name)continue;toolNames.set(id,name);blocks.push({type:'tool_use',id,name,input:parseArguments(call?.function?.arguments,name)});}
      if(blocks.length)conversation.push({role:'assistant',content:blocks});continue;
    }
    if(message.role==='tool'){const id=String(message.tool_call_id||'').trim();if(!id)continue;conversation.push({role:'user',content:[{type:'tool_result',tool_use_id:id,name:toolNames.get(id)||'tool',content:String(message.content||'')}]});}
  }
  return {systemPrompt:system.join('\n\n'),conversation};
}
function toClineTools(tools=[]){return(Array.isArray(tools)?tools:[]).map(tool=>{const fn=tool?.function||tool||{};const name=String(fn.name||'').trim();if(!name)return null;return{name,description:String(fn.description||''),inputSchema:fn.parameters||fn.inputSchema||{type:'object',properties:{}}};}).filter(Boolean);}
function parseArguments(value,toolName=''){if(value&&typeof value==='object'&&!Array.isArray(value))return value;const source=String(value??'').trim();if(!source)return{};try{const parsed=JSON.parse(source);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('not an object');return parsed;}catch{throw providerError('CLINE_TOOL_ARGUMENTS_INVALID',`Cline returned invalid JSON arguments for tool ${toolName||'(unknown)'}.`);}}
function isZeroCostModel(info={}){if(info?.metadata?.free===true||info?.free===true)return true;const pricing=info?.pricing||{};const values=Object.values(pricing).filter(value=>typeof value==='number'&&Number.isFinite(value));return values.length>0&&values.every(value=>value===0);}
function firstString(...values){for(const value of values){const text=String(value??'').trim();if(text)return text;}return null;}
function providerError(code,message){const error=new Error(message);error.code=code;return error;}
module.exports={ClineLlmsProvider,isZeroCostModel,parseArguments,toClineConversation,toClineTools};
