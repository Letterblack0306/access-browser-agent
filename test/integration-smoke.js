'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

const AgentSessionRuntime = require('../src/agent/executive/AgentSessionRuntime');
const { LiveAgentCore } = require('../src/agent/executive/LiveAgentCore');
const { UnifiedAgentService } = require('../src/agent/executive/UnifiedAgentService');
const ToolRegistry = require('../src/agent/ToolRegistry');
const { McpClient } = require('../src/system/mcp-client');
const OpenAICompatibleProvider = require('../src/llm/OpenAICompatibleProvider');

class StubProvider {
  async complete() { return { content: 'DONE', toolCalls: [] }; }
}

class FakeMcp extends McpClient {
  constructor() {
    super({ serverCommand: 'fake' });
    this.connected = true;
    this.tools = [{ name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } }];
  }
  async _request(method, params = {}) {
    if (method === 'tools/call' && params.name === 'add') {
      const args = params.arguments || {};
      return { content: [{ type: 'text', text: String((Number(args.a) || 0) + (Number(args.b) || 0)) }], isError: false };
    }
    return {};
  }
}

let failed = 0;
function check(name, condition, detail) {
  try { assert.ok(condition, detail); console.log(`  PASS ${name}`); }
  catch { console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); failed += 1; }
}

function skillSnapshot(name = 'workspace-tools', hash = 'h1') {
  return { ids: [name], hashes: { [name]: 'abc' }, hash, text: `# ${name}\nOperational guidance.` };
}

(async () => {
  const wsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'integ-ws-'));
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'integ-state-'));

  console.log('state-root relocation');
  {
    const reg = new ToolRegistry();
    reg.register('echo', 'e', { type: 'object', properties: {} }, async () => ({ ok: true }));
    const agent = new LiveAgentCore({ registry: reg, provider: new StubProvider(), ctx: {} });
    const runtime = new AgentSessionRuntime({
      workspaceRoot: wsRoot, stateRoot,
      stepRunnerFactory: ({ sessionId }) => stepContext => agent.step({ ...stepContext, sessionId }),
    });
    const accepted = await runtime.submitInstruction({ instruction: 'hi' });
    await accepted.runPromise;
    const underState = await fs.readdir(path.join(stateRoot, '.gpt-sync', 'agent-sessions')).catch(() => []);
    const underWs = await fs.readdir(path.join(wsRoot, '.gpt-sync', 'agent-sessions')).catch(() => []);
    check('session state written outside workspace', underState.length > 0);
    check('no session state written inside workspace', underWs.length === 0);
  }

  console.log('skill hash re-seeding');
  {
    const reg = new ToolRegistry();
    reg.register('echo', 'e', { type: 'object', properties: {} }, async () => ({ ok: true }));
    const agent = new LiveAgentCore({ registry: reg, provider: new StubProvider(), ctx: {} });
    await agent.step({ sessionId: 's', pendingInstructions: [], skills: skillSnapshot('workspace-tools', 'h1') });
    check('skill content injected into system prompt', agent.messagesFor('s')[0].content.includes('ACTIVE SKILLS') && agent.messagesFor('s')[0].content.includes('workspace-tools'));
    await agent.step({ sessionId: 's', pendingInstructions: [], skills: skillSnapshot('workspace-tools', 'h2') });
    check('skill seed refreshes on hash change', agent.messagesFor('s')[0].content.includes('ACTIVE SKILLS'));
    await agent.step({ sessionId: 's', pendingInstructions: [], skills: null });
    check('skill seed reverts when removed', !agent.messagesFor('s')[0].content.includes('ACTIVE SKILLS'));
  }

  console.log('agent receipt projection');
  {
    const reg = new ToolRegistry();
    reg.register('echo', 'e', { type: 'object', properties: {} }, async () => ({ ok: true }));
    const agent = new LiveAgentCore({ registry: reg, provider: new StubProvider(), ctx: {} });
    const runtime = new AgentSessionRuntime({
      workspaceRoot: wsRoot, stateRoot,
      stepRunnerFactory: ({ sessionId }) => stepContext => agent.step({ ...stepContext, sessionId }),
    });
    const accepted = await runtime.submitInstruction({ instruction: 'do it', skills: skillSnapshot('workspace-tools', 'h3') });
    await accepted.runPromise;
    const exec = await runtime.getSession(accepted.sessionId);
    const events = exec.getEvents();
    check('receipts include user.message', events.some(e => e.type === 'user.message'));
    const activated = events.find(e => e.type === 'skills.activated');
    check('receipts include skills.activated', Boolean(activated));
    check('skills.activated records ids + hash', Boolean(activated && Array.isArray(activated.data.skillIds) && activated.data.skillIds.includes('workspace-tools') && activated.data.hash));
  }

  console.log('MCP register / call / unregister');
  {
    const mcp = new FakeMcp();
    const service = new UnifiedAgentService({
      workspaceRoot: wsRoot, mcp,
      toolOptions: { registry: new ToolRegistry() },
      onEvent: () => {}, onState: () => {},
    });
    const tool = service.registry.get('mcp.add');
    check('MCP tool auto-register on connect', Boolean(tool));
    check('MCP tool executes without approval gate', Boolean(tool) && service.registry.requiresApproval('mcp.add') === false);
    const result = await service.registry.execute('mcp.add', { a: 2, b: 3 }, service.resources);
    check('MCP call executed via tools/call', result.ok === true && /5/.test(JSON.stringify(result)));
    service._removeMcpTools();
    check('MCP tool unregister on disconnect', !service.registry.get('mcp.add'));
  }

  console.log('provider health transitions + bounded reconnect');
  {
    const down = new OpenAICompatibleProvider({ baseUrl: 'http://invalid.invalid', model: 'm', fetch: async () => { throw new Error('down'); } });
    await down.checkHealth();
    check('provider records unreachable + reason', down.getHealth().reachable === false && Boolean(down.getHealth().failureReason));

    const up = new OpenAICompatibleProvider({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'm', fetch: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ data: [{ id: 'm' }] }); } }) });
    await up.checkHealth();
    check('provider records healthy + lastSuccessAt', up.getHealth().reachable === true && up.getHealth().healthy === true && Boolean(up.getHealth().lastSuccessAt));

    const unconfigured = new OpenAICompatibleProvider({});
    await unconfigured.checkHealth();
    check('unconfigured provider recorded', unconfigured.getHealth().configured === false && Boolean(unconfigured.getHealth().failureReason));

    const svc = new UnifiedAgentService({ workspaceRoot: wsRoot, toolOptions: { registry: new ToolRegistry() }, onEvent: () => {}, onState: () => {} });
    svc.provider = {
      getHealth() { return { configured: true, reachable: false, healthy: false, failureReason: 'down' }; },
      async checkHealth() { return { configured: true, reachable: false, healthy: false, failureReason: 'down' }; },
    };
    svc.providerReconnectAttempts = 2;
    svc.providerReconnectDelayMs = 1;
    const phases = [];
    svc.onEvent = e => phases.push(e.phase);
    const outcome = await svc._ensureProvider();
    check('bounded reconnect fails after N attempts', outcome.ok === false);
    check('reconnect emits connecting + unavailable', phases.includes('provider_connecting') && phases.includes('provider_unavailable'));
    check('reconnect is bounded (no endless retry)', phases.filter(p => p === 'provider_reconnecting').length === 2);
  }

  console.log(failed === 0 ? 'Integration smoke PASS' : `Integration smoke FAIL (${failed} failed)`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error('Integration smoke ERROR:', error); process.exitCode = 1; });
