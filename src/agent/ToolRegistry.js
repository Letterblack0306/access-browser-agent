'use strict';

const { ACTION_KINDS } = require('./ActionProtocol');
const { emitDiagnostic } = require('../system/runtime-diagnostic-bus');
const { ChangeGovernanceGuard } = require('./guards/ChangeGovernanceGuard');

const GOVERNED_MUTATIONS = new Set([
  ACTION_KINDS.FILE_WRITE,
  ACTION_KINDS.FILE_PATCH,
  ACTION_KINDS.FILE_DELETE,
  ACTION_KINDS.DIRECTORY_ENSURE,
  ACTION_KINDS.COMMAND_EXECUTE,
]);

class ToolRegistry {
  constructor(tools = [], options = {}) {
    this.checkpointAuthority = options && options.checkpointAuthority ? options.checkpointAuthority : null;
    this.tools = new Map();
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        if (!tool?.name) continue;
        this.register(tool.name, tool.description, tool.schema, tool.execute, {
          actionKind:tool.actionKind || null,
          evidence:tool.evidence,
          category:tool.category || null,
          readOnly:tool.readOnly === true,
          operatingGuidance:tool.operatingGuidance || '',
          failureModes:Array.isArray(tool.failureModes) ? tool.failureModes : [],
        });
      }
    }
    // Plan/Act ownership inversion: the agent declares its own execution mode.
    // Machine enforces: in 'plan' mode every governed mutation is blocked.
    this.mode = 'act';
    if (!this.tools.has('declareMode')) this._installModeTool();
  }

  _installModeTool() {
    this.tools.set('declareMode', {
      name:'declareMode',
      description:'Declare the current execution mode. status "plan" enables read-only exploration: every governed workspace mutation (write/patch/delete/command) is blocked and returns PLAN_MODE_BLOCKED. status "act" re-enables governed mutations. Read-only inspection tools work in both modes. The agent owns this switch; the machine enforces it. Use it after finishing planning and before mutating.',
      schema:{ type:'object', properties:{ status:{ type:'string', enum:['plan','act'] } }, required:['status'], additionalProperties:false },
      execute:async (_ctx, args) => {
        const status = String(args?.status || 'act').toLowerCase();
        if (status !== 'plan' && status !== 'act') return { ok:false, error:`status must be "plan" or "act", got "${status}".` };
        this.mode = status;
        return { ok:true, mode:status, observation:`MODE:${status.toUpperCase()}`, message:`Execution mode is now ${status}.` };
      },
      evidence:(_result, args) => ({ verified:true, mode:String(args?.status || '').toLowerCase() }),
      actionKind:null,
      category:'mode',
      readOnly:false,
      operatingGuidance:'Prefer plan mode while reading/deciding, then switch to act before any governed mutation.',
      failureModes:['invalid status value'],
    });
  }

  /**
   * Agent-declared execution mode gate. Returns true when a governed mutation
   * is attempted while in plan mode, short-circuiting the call.
   */
  _blockedByPlanMode(name, actionKind, correlation) {
    if (!GOVERNED_MUTATIONS.has(actionKind) || this.mode !== 'plan') return false;
    const error = {
      code:'PLAN_MODE_BLOCKED',
      message:`Tool "${name}" is a workspace mutation and is blocked while the agent is in plan mode. Declare mode 'act' before mutating.`,
      terminal:false,
      retryable:false,
    };
    emitDiagnostic({ source:'tool-registry', category:'mode', action:'plan_mode_blocked', phase:'blocked', severity:'warn', correlation, data:{ toolName:name, actionKind, mode:this.mode, observation:'BLOCKED' }, error });
    return true;
  }

  register(name, description, schema, executeFn, extras = {}) {
    if (this.tools.has(name)) throw new Error(`Tool "${name}" is already registered.`);
    const actionKind = extras.actionKind || null;
    if (actionKind && !Object.values(ACTION_KINDS).includes(actionKind)) {
      throw new Error(`Invalid action kind for ${name}: ${actionKind}`);
    }
    this.tools.set(name, {
      name,
      description,
      schema,
      execute:executeFn,
      actionKind,
      evidence:typeof extras.evidence === 'function' ? extras.evidence : null,
      category:String(extras.category || inferCategory(name)),
      readOnly:extras.readOnly === true,
      operatingGuidance:String(extras.operatingGuidance || ''),
      failureModes:Array.isArray(extras.failureModes) ? extras.failureModes.map(String) : [],
    });
  }

  get(name) { return this.tools.get(name) || null; }
  list() { return Array.from(this.tools.values()); }
  unregister(name) { return this.tools.delete(String(name || '')); }

  capabilityManifest() {
    return this.list().map(tool => ({
      name:tool.name,
      category:tool.category,
      readOnly:tool.readOnly,
      operatingGuidance:tool.operatingGuidance,
      failureModes:tool.failureModes,
    }));
  }

  openAiTools() {
    return this.list().map(tool => ({
      type:'function',
      function:{
        name:tool.name,
        description:describeTool(tool),
        parameters:tool.schema && typeof tool.schema === 'object'
          ? tool.schema
          : { type:'object', properties:{} },
      },
    }));
  }

  requiresApproval() { return false; }

  async execute(name, args, ctx = {}) {
    const tool = this.get(name);
    const correlation = {
      sessionId:ctx.sessionId,
      turnId:ctx.turnId,
      toolCallId:ctx.toolCallId,
      operationId:ctx.operationId,
      instructionId:ctx.instructionId,
    };

    if (!tool) {
      const error = { code:'TOOL_NOT_REGISTERED', message:`Tool "${name}" is not registered.`, terminal:false, retryable:false };
      emitDiagnostic({ source:'tool-registry', category:'tool', action:'tool_unavailable', phase:'observed', severity:'warn', correlation, data:{ toolName:name, observation:'UNAVAILABLE' }, error });
      return { ok:false, output:{ ok:false, observation:'UNAVAILABLE', error }, evidence:{ verified:false } };
    }

    if (GOVERNED_MUTATIONS.has(tool.actionKind)) {
      try {
        const workspaceRoot = ctx.workspaceRoot || ctx.workspace?.workspaceRoot || ctx.reader?.workspaceRoot || null;
        if (!workspaceRoot) {
          const error = new Error('Workspace identity is required for governed mutation.');
          error.code = 'GOVERNANCE_WORKSPACE_UNKNOWN';
          error.classification = 'GOVERNANCE';
          throw error;
        }
        new ChangeGovernanceGuard({ workspaceRoot }).assertMutation({ toolName:name, args:args || {} });
      } catch (error) {
        const normalized = { code:String(error?.code || 'CHANGE_GOVERNANCE_BLOCKED'), message:String(error?.message || error), terminal:true, retryable:false };
        emitDiagnostic({ source:'tool-registry', category:'governance', action:'mutation_blocked', phase:'blocked', severity:'warn', correlation, data:{ toolName:name, actionKind:tool.actionKind, observation:'BLOCKED' }, error:normalized });
        return { ok:false, output:{ ok:false, observation:'BLOCKED', code:normalized.code, error:normalized }, evidence:{ verified:false, governance:true } };
      }
    }

    const started = Date.now();
    emitDiagnostic({ source:'tool-registry', category:'tool', action:'execute', phase:'start', correlation, data:{ toolName:name, category:tool.category, argumentKeys:Object.keys(args || {}) } });

    try {
      const output = await tool.execute(ctx, args || {});
      const evidence = tool.evidence ? tool.evidence(output, args || {}) : { verified:output?.ok === true };
      const result = { ok:output?.ok === true, output, evidence };
      if (result.ok && GOVERNED_MUTATIONS.has(tool.actionKind) && this.checkpointAuthority) {
        this.checkpointAuthority.create({ stepId:correlation?.turnId || null, toolName:name, reason:'post-mutation' })
          .catch(() => {});
      }
      emitDiagnostic({ source:'tool-registry', category:'tool', action:'execute', phase:result.ok ? 'success' : 'observed', severity:result.ok ? 'info' : 'warn', durationMs:Date.now()-started, correlation, data:{ toolName:name, observation:result.ok ? 'SUCCESS' : observationKind(output), output } });
      return result;
    } catch (error) {
      const normalized = { code:String(error?.code || 'TOOL_EXECUTION_FAILED'), message:String(error?.message || error || 'Tool execution failed.'), terminal:false, retryable:error?.retryable === true };
      emitDiagnostic({ source:'tool-registry', category:'tool', action:'execute', phase:'observed', severity:'warn', durationMs:Date.now()-started, correlation, data:{ toolName:name, observation:observationKind({ ok:false, error:normalized }) }, error:normalized });
      return { ok:false, output:{ ok:false, observation:observationKind({ ok:false, error:normalized }), error:normalized }, evidence:{ verified:false } };
    }
  }
}

function observationKind(output) {
  if (!output || typeof output !== 'object') return 'EMPTY';
  if (output.observation) return String(output.observation).toUpperCase();
  const code = String(output.code || output.error?.code || '').toUpperCase();
  if (code === 'ENOENT' || code === 'NOT_FOUND' || code === 'FILE_NOT_FOUND') return 'NOT_FOUND';
  if (code === 'TIMEOUT' || code.endsWith('_TIMEOUT')) return 'TIMEOUT';
  if (code === 'UNAVAILABLE' || code === 'TOOL_NOT_REGISTERED') return 'UNAVAILABLE';
  const entries = output.entries || output.items || output.matches || output.results;
  if (Array.isArray(entries) && entries.length === 0) return 'EMPTY';
  if (output.ok === false) return 'FAILED';
  return 'SUCCESS';
}

function describeTool(tool) {
  const parts=[String(tool.description || '').trim()];
  if (tool.category) parts.push(`Category: ${tool.category}.`);
  parts.push('Executes directly within the active workspace and governed tool contract.');
  if (GOVERNED_MUTATIONS.has(tool.actionKind)) parts.push('Workspace mutation requires an active documented change intent.');
  if (tool.operatingGuidance) parts.push(`Operating guidance: ${tool.operatingGuidance}`);
  if (tool.failureModes.length) parts.push(`Common failure modes: ${tool.failureModes.join('; ')}.`);
  return parts.filter(Boolean).join(' ');
}

function inferCategory(name) {
  const value=String(name || '').toLowerCase();
  if (value.startsWith('browser.')) return 'browser';
  if (value.startsWith('git') || value.includes('github')) return 'git';
  if (value === 'runcommand') return 'validate';
  if (value === 'writefile' || value === 'applypatch') return 'edit';
  if (value === 'askuser') return 'plan';
  return 'investigate';
}

module.exports = ToolRegistry;
module.exports.observationKind = observationKind;
module.exports.GOVERNED_MUTATIONS = GOVERNED_MUTATIONS;
