'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');
const AgentSessionRuntime = require('./AgentSessionRuntime');
const { LiveAgentCore } = require('./LiveAgentCore');
const { buildLiveToolContext } = require('./LiveToolContext');
const OpenAICompatibleProvider = require('../../llm/OpenAICompatibleProvider');

class UnifiedAgentService {
  constructor({
    workspaceRoot,
    stateRoot,
    providerOptions = {},
    toolOptions = {},
    skills,
    pinnedSkills,
    mcp,
    onEvent,
    onState,
    maxRetries,
    retryDelayMs,
    maxToolCalls,
    providerReconnectAttempts = 2,
    providerReconnectDelayMs = 500,
  } = {}) {
    if (!workspaceRoot) throw new Error('workspaceRoot is required');
    this.root = path.resolve(workspaceRoot);
    this.stateRoot = stateRoot ? path.resolve(stateRoot) : this.root;
    this.provider = new OpenAICompatibleProvider({
      baseUrl:providerOptions.lmStudioBaseUrl,
      model:providerOptions.lmStudioModel,
      apiKey:providerOptions.apiKey,
      imageInput:providerOptions.lmStudioImageInput === true,
    });
    this.skills = skills || null;
    this.pinnedSkills = Array.isArray(pinnedSkills) ? pinnedSkills.map(name => String(name)) : [];
    this.mcp = mcp || null;
    this.providerReconnectAttempts = Math.max(0, Number(providerReconnectAttempts) || 0);
    this.providerReconnectDelayMs = Math.max(0, Number(providerReconnectDelayMs) || 0);
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.onState = typeof onState === 'function' ? onState : () => {};

    const { registry, resources } = toolOptions.registry
      ? { registry:toolOptions.registry, resources:{} }
      : buildLiveToolContext({
          workspaceRoot:this.root,
          stateRoot:this.stateRoot,
          reader:toolOptions.reader,
          terminal:toolOptions.terminal,
          onAskUser:toolOptions.onAskUser,
        });

    this.registry = registry;
    this.resources = resources;
    this._mcpToolNames = new Set();
    this.agent = new LiveAgentCore({
      registry,
      provider:this.provider,
      ctx:resources,
      maxToolCalls,
    });

    this.runtime = new AgentSessionRuntime({
      workspaceRoot:this.root,
      stateRoot:this.stateRoot,
      stepRunnerFactory:({ sessionId }) => stepContext => this.agent.step({ ...stepContext, sessionId }),
      onEvent:event => this.onEvent(this._mapEvent(event)),
      onState:state => this.onState(state),
      maxRetries,
      retryDelayMs,
    });

    this._initMcp();
  }

  async run(input = {}) {
    const text = String(input.instruction || input.message || input.text || '').trim();
    if (!text) return { ok:false, terminalState:'blocked', error:'Instruction is required.' };
    const providerResult = await this._ensureProvider();
    if (!providerResult.ok) {
      return { ok:false, terminalState:'blocked', error:providerResult.error, provider:providerResult.provider };
    }
    const skills = await this._resolveSkills();
    const accepted = await this.runtime.submitInstruction({
      sessionId:input.sessionId || null,
      newSession:input.newSession === true,
      objective:String(input.objective || '').trim(),
      instruction:text,
      source:String(input.source || 'ide'),
      skills,
      operationId:input.operationId || input.correlation?.operationId || null,
      instructionId:input.instructionId || input.correlation?.instructionId || null,
    });
    if (skills) {
      this.onEvent({
        phase:'skills.activated', status:'running', timestamp:new Date().toISOString(),
        detail:`Activated ${skills.ids.length} skill(s).`, skillIds:skills.ids, hashes:skills.hashes,
      });
    }
    const state = accepted.runPromise
      ? await accepted.runPromise
      : await this.runtime.status(accepted.sessionId);
    return this._projectResult(state, accepted);
  }

  // Approval methods remain only as compatibility responses for old callers.
  // No active tool or agent path can enter an approval wait.
  async approve(approvalId) {
    return { ok:false, approvalId:String(approvalId || ''), code:'APPROVAL_WORKFLOW_REMOVED', error:'Ordinary agent-control approvals are not part of the active runtime.' };
  }
  async reject(approvalId) {
    return { ok:false, approvalId:String(approvalId || ''), code:'APPROVAL_WORKFLOW_REMOVED', error:'Ordinary agent-control approvals are not part of the active runtime.' };
  }

  async stop(sessionId, reason) {
    const id = sessionId || await this.currentSessionId();
    if (!id) return { ok:false, status:'idle' };
    this.agent.stop(id);
    return this.runtime.stop(id, reason || 'Stopped by user.');
  }

  resetForFreshRuntime() { return this.runtime.resetForFreshRuntime(); }

  async status(sessionId) {
    const state = await this.runtime.status(sessionId || null);
    return { ...this._mapStatus(state), provider:this.provider.getHealth() };
  }

  providerStatus() { return this.provider.getHealth(); }

  async configureProvider(input = {}) {
    const apiKey = this.provider?.apiKey || '';
    this.provider = new OpenAICompatibleProvider({
      baseUrl:input.lmStudioBaseUrl,
      model:input.lmStudioModel,
      apiKey:input.apiKey || apiKey,
      endpointPolicy:input.lmStudioEndpointPolicy,
      contextLength:input.lmStudioContextLength,
      ttlSeconds:input.lmStudioTtlSeconds,
    });
    this.agent.provider = this.provider;
    const provider = await this.provider.checkHealth();
    return {
      provider,
      preferences:{
        lmStudioBaseUrl:String(input.lmStudioBaseUrl || '').trim(),
        lmStudioModel:String(input.lmStudioModel || '').trim(),
        lmStudioApiKey:String(input.apiKey || '').trim(),
        lmStudioEndpointPolicy:String(input.lmStudioEndpointPolicy || 'private-network').trim(),
        lmStudioContextLength:positiveInteger(input.lmStudioContextLength),
        lmStudioTtlSeconds:positiveInteger(input.lmStudioTtlSeconds),
        lmStudioConversationMode:'application',
        mcpServerCommand:String(input.mcpServerCommand || '').trim(),
      },
    };
  }

  async receipts() {
    let executive;
    try { executive = await this.runtime.getCurrentSession(); }
    catch { return { ok:true, sessionId:null, receipts:[] }; }
    if (!executive) return { ok:true, sessionId:null, receipts:[] };
    const events = (typeof executive.getEvents === 'function' ? executive.getEvents() : []) || [];
    let checkpoints = [];
    try {
      if (executive.store && typeof executive.store.listCheckpoints === 'function') checkpoints = await executive.store.listCheckpoints();
    } catch {}
    return {
      ok:true,
      sessionId:executive.sessionId || null,
      receipts:events.filter(event => event && event.eventId).map(event => ({
        receiptId:event.eventId,
        sessionId:event.sessionId || null,
        kind:event.type,
        timestamp:event.createdAt,
        detail:summarizeReceipt(event),
        data:event.data || null,
      })),
      checkpoints,
    };
  }

  async executionTrace(sessionId = null) {
    let executive;
    try { executive = await this.runtime.getSession(sessionId || await this.currentSessionId()); }
    catch { return { ok:true, sessionId:null, events:[] }; }
    if (!executive) return { ok:true, sessionId:null, events:[] };
    const events = typeof executive.store?.loadExecutionEvents === 'function'
      ? await executive.store.loadExecutionEvents()
      : [];
    return { ok:true, sessionId:executive.sessionId || null, events };
  }

  async reset(sessionId) {
    const id = sessionId || await this.currentSessionId();
    if (!id) return { ok:false };
    this.agent.reset(id);
    return { ok:true, sessionId:id };
  }

  async currentSessionId() {
    const current = await this.runtime.getCurrentSession();
    return current ? current.sessionId : null;
  }

  async _resolveSkills() {
    if (!this.skills) return null;
    let names = this.pinnedSkills.filter(Boolean);
    if (!names.length) {
      let listed = [];
      try { listed = await this.skills.list(); } catch { return null; }
      names = (Array.isArray(listed) ? listed : []).map(skill => skill?.name).filter(Boolean);
    }
    const selected = [];
    for (const name of names) {
      try {
        const doc = await this.skills.readSkill(name);
        if (doc) selected.push(doc);
      } catch {}
    }
    selected.sort((left,right) => left.name.localeCompare(right.name));
    if (!selected.length) return null;
    const hashes = {};
    for (const entry of selected) hashes[entry.name] = createHash('sha256').update(entry.content || entry.description || '').digest('hex');
    const ids = selected.map(entry => entry.name);
    const hash = createHash('sha256').update(JSON.stringify({ workspace:this.root, skills:selected.map(entry => [entry.name, hashes[entry.name]]) })).digest('hex');
    const text = selected.map(entry => `# ${entry.name}\n${entry.description}\n${entry.content || ''}`.trim()).join('\n\n---\n\n');
    return { ids, hashes, hash, text, skills:selected };
  }

  async _ensureProvider() {
    const health = this.provider.getHealth();
    if (!health.configured) return { ok:false, error:health.failureReason || 'Provider is not configured.', provider:health };
    this._emitProvider('provider_connecting', 'Checking provider connectivity.');
    let checked = await this.provider.checkHealth();
    if (checked.reachable && checked.healthy) {
      this._emitProvider('provider_reachable', 'Provider is reachable.');
      return { ok:true, provider:checked };
    }
    for (let attempt=1; attempt<=this.providerReconnectAttempts; attempt+=1) {
      this._emitProvider('provider_reconnecting', `Provider unreachable; reconnect attempt ${attempt}/${this.providerReconnectAttempts}.`);
      await delay(this.providerReconnectDelayMs * attempt);
      checked = await this.provider.checkHealth();
      if (checked.reachable && checked.healthy) {
        this._emitProvider('provider_reachable', 'Provider recovered.');
        return { ok:true, provider:checked };
      }
    }
    this._emitProvider('provider_unavailable', checked.failureReason || 'Provider is unreachable.');
    return { ok:false, error:checked.failureReason || 'Provider is unreachable.', provider:checked };
  }

  _emitProvider(phase, detail) {
    this.onEvent({ phase, status:'running', timestamp:new Date().toISOString(), detail, provider:this.provider.getHealth() });
  }

  _initMcp() {
    if (!this.mcp) return;
    this.mcp.on('tools', tools => this._syncMcpTools(tools));
    this.mcp.on('disconnected', () => this._removeMcpTools());
    this._syncMcpTools(this.mcp.connected ? this.mcp.tools : []);
  }

  _normalizeMcpTools(rawTools) {
    return (Array.isArray(rawTools) ? rawTools : []).map(tool => {
      const name = String(tool?.name || '').trim();
      if (!name) return null;
      return { name, description:String(tool?.description || ''), inputSchema:tool?.inputSchema || { type:'object', properties:{} } };
    }).filter(Boolean);
  }

  _syncMcpTools(tools) {
    const normalized = this._normalizeMcpTools(tools);
    for (const name of Array.from(this._mcpToolNames)) this.registry.unregister(name);
    this._mcpToolNames.clear();
    let added = 0;
    for (const item of normalized) {
      const registeredName = `mcp.${item.name}`;
      this.registry.register(
        registeredName,
        `[MCP:${item.name}] ${item.description}`,
        item.inputSchema,
        async (_ctx,args) => {
          if (!this.mcp || !this.mcp.connected) return { ok:false, observation:'UNAVAILABLE', code:'MCP_DISCONNECTED', error:'MCP tool unavailable (server not connected).', verified:false };
          try {
            const result = await this.mcp.callTool(item.name, args || {});
            return { ok:result.ok === true, ...result.output, verified:result.ok === true };
          } catch (error) {
            return { ok:false, observation:'FAILED', code:String(error?.code || 'MCP_TOOL_FAILED'), error:error.message || String(error), verified:false };
          }
        },
        { category:'mcp' },
      );
      this._mcpToolNames.add(registeredName);
      added += 1;
    }
    if (added) {
      this.onEvent({ phase:'mcp_tools_updated', status:'running', timestamp:new Date().toISOString(), detail:`Registered ${added} MCP tool(s).`, tools:Array.from(this._mcpToolNames) });
    }
  }

  _removeMcpTools() {
    if (!this._mcpToolNames.size) return;
    for (const name of Array.from(this._mcpToolNames)) this.registry.unregister(name);
    this._mcpToolNames.clear();
    this.onEvent({ phase:'mcp_disconnected', status:'running', timestamp:new Date().toISOString(), detail:'MCP tools removed (server disconnected).' });
  }

  _mapEvent(event) {
    return {
      eventId:event.eventId || `${event.type}-${Date.now()}`,
      phase:event.type,
      timestamp:event.createdAt || new Date().toISOString(),
      status:lifecycleEventStatus(event),
      detail:event.data?.reason || event.data?.observation?.summary || '',
      ...(event.data || {}),
    };
  }

  _mapStatus(state) {
    if (!state) return { running:false, status:'idle', turnId:null, pendingApproval:null };
    return {
      running:['running','retrying'].includes(String(state.status)),
      status:state.status,
      turnId:state.sessionId,
      sessionId:state.sessionId,
      objective:state.objective,
      waiting:state.waiting,
      pendingApproval:null,
    };
  }

  _projectResult(state, accepted) {
    const terminal = String(state?.status || '');
    const failure = state?.waiting?.reason || state?.retry?.lastError?.message || null;
    const failureEvidence = failure ? [{ type:'runtime_failure', code:state?.retry?.lastError?.code || null, httpStatus:state?.retry?.lastError?.httpStatus || null, message:String(failure) }] : [];
    return {
      ok:terminal === 'completed',
      terminalState:terminal,
      sessionId:state?.sessionId || accepted?.sessionId || null,
      instructionId:accepted?.instructionId || null,
      text:state?.completion?.summary || failure,
      summary:state?.completion?.summary || failure,
      evidence:state?.completion?.evidence || failureEvidence,
      error:state?.completion?.reason || failure,
      state,
    };
  }
}

function summarizeReceipt(event) {
  const data = event.data || {};
  switch (event.type) {
    case 'user.message': return String(data.text || '');
    case 'objective.completed': return String(data.summary || 'completed');
    case 'objective.failed': return String(data.summary || data.reason || 'failed');
    case 'objective.blocked': return String(data.summary || data.reason || 'blocked');
    case 'objective.timed_out': return String(data.summary || data.reason || 'timed out');
    case 'step.failed': return String(data.error?.message || 'step failed');
    case 'step.observed': return String(data.observation?.summary || 'observed');
    case 'decision.recorded': return String(data.reason || data.kind || 'decision');
    case 'objective.revised': return String(data.objective || 'objective revised');
    case 'skills.activated': return `Skills activated: ${(Array.isArray(data.skillIds) ? data.skillIds : []).join(', ')}`;
    case 'provider_unavailable': return String(data.reason || 'provider unavailable');
    case 'provider_reachable': return String(data.reason || 'provider reachable');
    default: return String(event.type || 'event');
  }
}

function lifecycleEventStatus(event = {}) {
  if (event?.data?.status) return String(event.data.status);
  switch (String(event.type || '')) {
    case 'objective.completed': return 'completed';
    case 'objective.failed': return 'failed';
    case 'objective.blocked': return 'blocked';
    case 'objective.timed_out': return 'timed_out';
    case 'step.failed': return 'failed';
    case 'session.stopped': return 'stopped';
    case 'session.cancelled': return 'cancelled';
    case 'dependency.waiting':
    case 'input.waiting': return 'waiting';
    default: return 'running';
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0,ms))); }

module.exports = { UnifiedAgentService, lifecycleEventStatus };
