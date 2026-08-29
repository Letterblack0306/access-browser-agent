'use strict';

const { UnifiedAgentService } = require('../src/agent/executive/UnifiedAgentService');
const { ClineAuthSession } = require('../src/llm/ClineAuthSession');
const { createProvider, normalizeProviderKind } = require('../src/llm/ProviderFactory');
const { ModelReadinessRegistry, normalizeReadiness } = require('../src/llm/ModelReadinessRegistry');
const { emitDiagnostic } = require('../src/system/runtime-diagnostic-bus');
const { createCorrelation } = require('../src/system/runtime-correlation');
const { runWithCorrelation } = require('../src/system/runtime-correlation-context');
const { DEFAULTS: PREFERENCE_DEFAULTS } = require('../src/system/ide-preferences');

class AgentRuntimeAdapter {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.getWindow = options.getWindow || (() => null);
    this.getSettings = options.getSettings || (() => ({}));
    this.providerCapabilities = new ModelReadinessRegistry();
    this.toolCallCache = new Map();
    this.providerSelection = null;
    this.clineAuth = options.clineAuth || global.__accessAgentAuthSession || new ClineAuthSession({
      preferencesPath:options.preferencesPath || '',
      onAuth:info => this._emitClineAuthEvent('cline.auth.required', { url:String(info?.url || ''), instructions:String(info?.instructions || '') }),
      onProgress:message => this._emitClineAuthEvent('cline.auth.progress', { message:String(message || '') }),
    });
    const settings = this.getSettings() || {};
    this.service = new UnifiedAgentService({
      workspaceRoot:options.workspaceRoot || process.cwd(),
      stateRoot:options.stateRoot,
      skills:options.skills || null,
      pinnedSkills:options.pinnedSkills,
      mcp:options.mcp || null,
      providerOptions:{ lmStudioBaseUrl:settings.lmStudioBaseUrl, lmStudioModel:settings.lmStudioModel, apiKey:settings.lmStudioApiKey, lmStudioImageInput:settings.lmStudioImageInput === true },
      systemPrompt:settings.systemPrompt || PREFERENCE_DEFAULTS.systemPrompt,
      onEvent:event => {
        emitDiagnostic({ source:'agent-runtime', category:'agent', action:event?.type || event?.phase || 'event', phase:event?.status || 'event', correlation:correlationFrom(event), data:event });
        const window=this.getWindow();
        if (window && !window.isDestroyed()) window.webContents.send('ide:agent-event', event);
      },
      onState:state => {
        emitDiagnostic({ source:'agent-runtime', category:'agent', action:'state', phase:state?.status || 'event', correlation:correlationFrom(state), data:state });
        const window=this.getWindow();
        if (window && !window.isDestroyed()) window.webContents.send('ide:agent-state', state);
      },
    });
    this._installProvider(settings);
    global.__accessAgentRuntimeAdapter=this;
  }

  _emitClineAuthEvent(phase, data = {}) {
    const event={ phase, status:'running', timestamp:new Date().toISOString(), detail:data.message || data.instructions || phase, ...data };
    emitDiagnostic({ source:'cline-auth', category:'provider', action:phase, phase:'event', data:event });
    const window=this.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('ide:agent-event', event);
  }

  _createProvider(input = {}) { return createProvider(input, { clineAuth:this.clineAuth, previous:this.service.provider || null }); }

  _installProvider(input = {}) {
    const provider=this._createProvider(input);
    this.service.provider=provider;
    if (this.service.agent) this.service.agent.provider=provider;
    this.providerSelection=providerPreferences(input);
    return provider;
  }

  async run(input = {}) {
    const correlation=createCorrelation(input.correlation || { instructionId:input.instructionId, operationId:input.operationId, url:input.browser?.url, targetId:input.browser?.targetId });
    return runWithCorrelation(correlation, async () => {
      // Bypass strict readiness probe for small/free models (Gemma, Qwen, Llama)
      const modelId = this.service?.provider?.model || input.model || '';
      const isSmallModel = modelId.includes('gemma') || modelId.includes('qwen') || modelId.includes('llama');

      let readiness=this.providerStatus().agentReadiness;
      let readinessAttempt=null;
      if (!isSmallModel && readiness?.agentReady !== true) {
        readinessAttempt=await this.providerReadiness();
        readiness=this.providerStatus().agentReadiness;
      }
      if (!isSmallModel && readiness?.agentReady !== true) {
        const error={
          code:'PROVIDER_CAPABILITY_UNVERIFIED',
          message:'The active provider/model could not prove agent tool capability for this operation. No background retry will run; retry by starting another provider-dependent action after the provider is available.',
          provider:this.service?.provider?.constructor?.name || null,
          model:this.service?.provider?.model || null,
          readiness,
          readinessAttempt,
        };
        emitDiagnostic({ source:'agent-runtime', category:'provider', action:'run_precondition', phase:'blocked', severity:'warn', correlation, data:error });
        return { ok:false, terminalState:'blocked', error:error.message, summary:error.message, evidence:[{ type:'provider_precondition', ...error }] };
      }

      emitDiagnostic({ source:'agent-runtime', category:'agent', action:'run', phase:'start', correlation, data:{ source:input.source, newSession:input.newSession === true } });
      try {
        const result=await this.service.run(input);
        const normalized=result?.state?.completion?.outcome==='objective_completed'
          ? { ...result, ok:true, text:result.state.completion.summary || result.text || null, summary:result.state.completion.summary || result.summary || null, evidence:result.state.completion.evidence || result.evidence || [], error:null }
          : result;
        emitDiagnostic({ source:'agent-runtime', category:'agent', action:'run', phase:'success', correlation:{ ...correlation, sessionId:normalized?.sessionId, turnId:normalized?.turnId }, data:{ ok:normalized?.ok, status:normalized?.status, terminalState:normalized?.terminalState } });
        return normalized;
      } catch (error) {
        emitDiagnostic({ source:'agent-runtime', category:'agent', action:'run', phase:'failed', severity:'error', correlation, error });
        throw error;
      }
    });
  }

  async stop(turnId) {
    const state=await this.service.status(turnId || null);
    if (!state?.running) {
      return { ok:true, skipped:true, status:state?.status || 'idle', sessionId:state?.sessionId || turnId || null };
    }
    return this.service.stop(turnId);
  }
  status() { return this.service.status(); }

  providerStatus() {
    const health=this.service.providerStatus();
    const cached=this.providerCapabilities.get(this.providerSelection || {});
    const readiness=cached || unverifiedReadiness(this.service?.provider?.model || null);
    return { ...health, agentReady:readiness.agentReady, agentReadiness:readiness };
  }

  resetForFreshRuntime() {
    this.providerCapabilities.clear();
    return this.service.resetForFreshRuntime();
  }

  async updateProviderSettings(input = {}) {
    const providerKind=normalizeProviderKind(input.providerKind);
    if (providerKind === 'cline' && typeof this.clineAuth.load === 'function') await this.clineAuth.load();
    if (providerKind === 'cline' && input.clineLogout === true) await this.clineAuth.logout();
    if (providerKind === 'cline' && input.clineLogin === true) await this.clineAuth.login();
    const provider=input.discoverOnly === true ? this._createProvider(input) : this._installProvider(input);
    const auth=providerKind === 'cline' ? this.clineAuth.status() : null;

    if (input.discoverOnly === true) {
      if (input.probeReadiness === true) {
        const selection=providerPreferences(input);
        const readinessProbe=await probeProviderReadiness({ provider, selection, registry:this.providerCapabilities });
        const health=provider.getHealth();
        return {
          provider:{ ...health, configured:providerKind === 'cline' ? Boolean(input.clineModel && (auth?.authenticated || process.env.CLINE_API_KEY)) : Boolean(provider.baseUrl), reachable:readinessProbe.ok, healthy:readinessProbe.ok, modelCount:0, failureReason:readinessProbe.agentReady ? null : readinessProbe.evidence?.failureReasons?.toolCalling || readinessProbe.evidence?.failureReasons?.completion || null, contactState:'checked', agentReady:readinessProbe.agentReady, agentReadiness:readinessProbe.readiness },
          models:[], modelCatalog:[], auth, preferences:selection, error:null, readinessProbe,
        };
      }

      let models=[];let modelCatalog=[];let listError=null;
      try {
        if (typeof provider.listModelCatalog === 'function') {
          modelCatalog=await provider.listModelCatalog();
          modelCatalog=this.providerCapabilities.projectCatalog(modelCatalog, providerPreferences(input));
          models=modelCatalog.map(item => item.id);
        } else models=await provider.listModels();
      } catch (error) { listError=error?.message || String(error); }
      const health=provider.getHealth();
      return {
        provider:{ ...health, configured:providerKind === 'cline' ? Boolean(input.clineModel && (auth?.authenticated || process.env.CLINE_API_KEY)) : Boolean(provider.baseUrl), reachable:!listError, healthy:!listError, modelCount:models.length, failureReason:listError || health.failureReason || null, contactState:listError ? 'failed' : 'checked' },
        models, modelCatalog, auth, preferences:providerPreferences(input), error:listError,
      };
    }

    const health=provider.getHealth();
    const readiness=this.providerCapabilities.get(this.providerSelection || {}) || unverifiedReadiness(provider.model);

    let models=[];let modelCatalog=[];let listError=null;
    try {
      if (typeof provider.listModelCatalog === 'function') {
        modelCatalog=await provider.listModelCatalog();
        modelCatalog=this.providerCapabilities.projectCatalog(modelCatalog, providerPreferences(input));
        models=modelCatalog.map(item => item.id);
      } else models=await provider.listModels();
    } catch (error) { listError=error?.message || String(error); }

    return {
      provider:{
        ...health,
        configured:providerKind === 'cline' ? Boolean(input.clineModel && (auth?.authenticated || process.env.CLINE_API_KEY)) : Boolean(provider.baseUrl),
        reachable:!listError,
        healthy:!listError,
        failureReason:listError || health.failureReason || null,
        contactState:listError ? 'failed' : 'checked',
        agentReady:readiness.agentReady,
        agentReadiness:readiness,
      },
      models,
      modelCatalog,
      auth,
      preferences:providerPreferences(input),
      error:listError,
    };
  }

  async providerReadiness() {
    const provider=this.service?.provider;
    if (!provider) throw new Error('Provider runtime is unavailable.');
    return probeProviderReadiness({ provider, selection:this.providerSelection || {}, registry:this.providerCapabilities });
  }

  intervene(text) { return this.run({ instruction:text }); }
  receipts() { return this.service.receipts(); }
  executionTrace(sessionId) { return this.service.executionTrace(sessionId); }
}

async function probeProviderReadiness({ provider, selection = {}, registry }) {
  if (!provider) throw new Error('Provider runtime is unavailable.');
  const checkedAt=new Date().toISOString();
  const capabilities={ completion:'unknown', toolCalling:'unknown', structuredOutput:'unknown', imageInput:provider?.imageInput===true?'configured':'unknown' };
  const evidence={ checkedAt, model:null, providerRequestIds:[], failureReasons:{} };
  let text='';

  try {
    const completion=await provider.complete({ messages:[{ role:'user', content:'Provider readiness check. Reply with exactly READY. Do not call tools.' }], tools:[], max_tokens:512 });
    text=String(completion?.content || '').trim();evidence.model=completion?.model || null;
    if (completion?.providerRequestId) evidence.providerRequestIds.push(completion.providerRequestId);
    capabilities.completion=text === 'READY' ? 'verified' : 'failed';
    if (text !== 'READY') evidence.failureReasons.completion=`Expected READY; observed ${text || '(empty)'}.`;
  } catch (error) { capabilities.completion='failed';evidence.failureReasons.completion=error?.message || String(error); }

  if (capabilities.completion === 'verified') {
    try {
      const probeTool={ type:'function', function:{ name:'diagnostic_probe', description:'Non-mutating readiness probe. Call this tool exactly once with value PING.', parameters:{ type:'object', properties:{ value:{ type:'string', const:'PING' } }, required:['value'], additionalProperties:false } } };
      const toolResult=await provider.complete({ messages:[{ role:'user', content:'Agent capability probe. You MUST call diagnostic_probe exactly once with value PING. Do not answer with prose instead.' }], tools:[probeTool], max_tokens:512 });
      if (toolResult?.providerRequestId) evidence.providerRequestIds.push(toolResult.providerRequestId);
      const call=Array.isArray(toolResult?.toolCalls) ? toolResult.toolCalls.find(item => item.name === 'diagnostic_probe') : null;
      capabilities.toolCalling=call?.arguments?.value === 'PING' ? 'verified' : 'unsupported';
      if (capabilities.toolCalling !== 'verified') evidence.failureReasons.toolCalling='Selected model did not emit the required diagnostic tool call.';
    } catch (error) { capabilities.toolCalling='unsupported';evidence.failureReasons.toolCalling=error?.message || String(error); }

    try {
      const responseFormat={ type:'json_schema', json_schema:{ name:'readiness', strict:true, schema:{ type:'object', properties:{ ready:{type:'boolean'} }, required:['ready'], additionalProperties:false } } };
      const structured=await provider.complete({ messages:[{ role:'user', content:'Return JSON with ready=true.' }], tools:[], max_tokens:512, responseFormat });
      if (structured?.providerRequestId) evidence.providerRequestIds.push(structured.providerRequestId);
      let parsed=null;try { parsed=JSON.parse(String(structured?.content || '')); } catch {}
      capabilities.structuredOutput=parsed?.ready === true ? 'verified' : 'unsupported';
      if (capabilities.structuredOutput !== 'verified') evidence.failureReasons.structuredOutput='Structured JSON schema output was not verified.';
    } catch (error) { capabilities.structuredOutput='unsupported';evidence.failureReasons.structuredOutput=error?.message || String(error); }
  }

  const agentReady=capabilities.completion === 'verified' && capabilities.toolCalling === 'verified';
  const readiness=normalizeReadiness({ checkedAt, model:evidence.model || provider.model || null, agentReady, capabilities, failureReasons:evidence.failureReasons }, provider.model || null);
  registry?.set(selection, readiness);
  emitDiagnostic({ source:'provider-readiness', category:'provider', action:'capability_probe', phase:agentReady ? 'success' : 'unverified', severity:agentReady ? 'info' : 'warn', data:{ capabilities, evidence, agentReady, selection:providerPreferences(selection) } });
  return { ok:capabilities.completion === 'verified', agentReady, text, summary:text, model:evidence.model, capabilities, evidence, readiness };
}

function unverifiedReadiness(model = null) {
  return normalizeReadiness({ model:model || null }, model || '');
}

function providerIdentity(provider = {}) {
  return JSON.stringify({ type:provider?.constructor?.name || 'provider', providerId:String(provider?.providerId || ''), model:String(provider?.model || ''), baseUrl:String(provider?.baseUrl || '') });
}

function correlationFrom(value = {}) {
  return { sessionId:value.sessionId || value?.state?.sessionId || null, turnId:value.turnId || null, instructionId:value.instructionId || null, operationId:value.operationId || null, toolCallId:value.toolCallId || null, providerRequestId:value.providerRequestId || null };
}

function providerPreferences(input = {}) {
  return {
    providerKind:normalizeProviderKind(input.providerKind),
    clineProviderId:String(input.clineProviderId || 'cline').trim() || 'cline',
    clineModel:String(input.clineModel || '').trim(),
    lmStudioBaseUrl:String(input.lmStudioBaseUrl || '').trim(),
    lmStudioModel:String(input.lmStudioModel || '').trim(),
    lmStudioApiKey:String(input.lmStudioApiKey || '').trim(),
    lmStudioEndpointPolicy:String(input.lmStudioEndpointPolicy || 'private-network').trim(),
    lmStudioContextLength:positiveInteger(input.lmStudioContextLength),
    lmStudioTtlSeconds:positiveInteger(input.lmStudioTtlSeconds),
    lmStudioImageInput:input.lmStudioImageInput === true,
    clineImageInput:input.clineImageInput === true,
    lmStudioConversationMode:'application',
    mcpServerCommand:String(input.mcpServerCommand || '').trim(),
  };
}
function positiveInteger(value) { const number=Number(value);return Number.isInteger(number) && number > 0 ? number : null; }


AgentRuntimeAdapter.prototype._checkCache = function(name, args) {
    const key = name + ':' + JSON.stringify(args);
    return this.toolCallCache.get(key) || null;
};
AgentRuntimeAdapter.prototype._setCache = function(name, args, res) {
    const key = name + ':' + JSON.stringify(args);
    this.toolCallCache.set(key, res);
};
module.exports={ AgentRuntimeAdapter, providerPreferences, providerIdentity, unverifiedReadiness, probeProviderReadiness };

