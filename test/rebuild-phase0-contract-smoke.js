'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { BrowserInstructionRelay } = require('../src/agent/executive/BrowserInstructionRelay');
const { TaskStateRouterBridge } = require('../electron/task-state-router-bridge');
const { PtyTerminalManager } = require('../electron/pty-terminal-manager');

const envelope = (id, objective, workspace) => [
  '=== ACCESS AGENT INSTRUCTION START ===',
  'VERSION: 1',
  `INSTRUCTION ID: ${id}`,
  `WORKSPACE: ${workspace}`,
  'OBJECTIVE:',
  objective,
  '=== ACCESS AGENT INSTRUCTION END ===',
].join('\n');

const failures = [];

async function contract(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

(async () => {
  await contract('browser bridge transports structured instructions without semantic routing', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'access-agent-phase0-'));
    const calls = [];
    const bridge = new TaskStateRouterBridge({
      getWorkspaceRoot: () => workspace,
      getAgentRuntime: () => ({
        run: async input => {
          calls.push(input);
          return { ok: true, summary: 'executed' };
        },
      }),
      getRuntimeActive: () => true,
    });

    assert.equal(typeof bridge._ensureRouter, 'undefined', 'semantic task-state router must not exist on the active bridge');

    const input = {
      inbound: 'instruction',
      source: 'browser-provider',
      instruction: 'The phrase task complete appears in a source file. Inspect it; do not mark this task complete.',
      objective: 'The phrase task complete appears in a source file. Inspect it; do not mark this task complete.',
    };

    const result = await bridge.submitInstruction(input);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], input, 'the original structured instruction must reach the reasoning runtime intact');
  });

  await contract('retryable browser result delivery remains pending instead of stopping the relay', async () => {
    const workspace = 'G:\\Phase0';
    let snapshotCount = 0;
    let sendAttempts = 0;
    const events = [];

    const relay = new BrowserInstructionRelay({
      channel: {
        expectedUrlFor: () => 'https://chatgpt.com/c/phase0',
        snapshot: async () => {
          snapshotCount += 1;
          if (snapshotCount === 1) {
            return { targetId:'tab-1', providerId:'chatgpt', text:'', generating:false, provenance:{ verifiedAssistant:true, messagePresent:false } };
          }
          return {
            targetId:'tab-1', providerId:'chatgpt',
            text:envelope('phase0-delivery', 'Inspect package.json.', workspace),
            generating:false,
            provenance:{ verifiedAssistant:true, messagePresent:true },
          };
        },
        send: async () => {
          sendAttempts += 1;
          const error = new Error('Provider composer not found.');
          error.code = 'COMPOSER_NOT_FOUND';
          throw error;
        },
      },
      getEndpoint: () => 'http://127.0.0.1:7330',
      getWorkspaceRoot: () => workspace,
      submitInstruction: async () => ({ ok:true, summary:'local work complete' }),
      onEvent: event => events.push(event),
      pollIntervalMs: 1500,
    });

    relay._schedule = () => {};
    relay.selectTarget({ targetId:'tab-1', providerId:'chatgpt', provider:'ChatGPT', url:'https://chatgpt.com/c/phase0' });
    await relay.start();

    await relay._tick();
    assert.equal(relay.status().pendingResult, true, 'local completion should queue a browser delivery');

    await relay._tick();

    assert.equal(sendAttempts, 1);
    assert.equal(relay.status().running, true, 'retryable delivery failure must not stop the whole loop');
    assert.equal(relay.status().pendingResult, true, 'retryable delivery failure must preserve the queued result');
    assert.notEqual(relay.status().lifecycle, 'degraded', 'retryable delivery failure must have its own delivery state');
    assert.ok(events.some(event => event.phase === 'browser_relay.delivery_retry'));
  });

  await contract('fallback terminal session has a safe lifecycle without a native process', async () => {
    const manager = Object.create(PtyTerminalManager.prototype);
    manager.sessions = new Map();
    manager.sessions.set('fallback-1', { processRef:null, disposables:[], fallback:true });

    assert.doesNotThrow(() => manager.write('fallback-1', 'echo hello'));
    assert.doesNotThrow(() => manager.resize('fallback-1', 120, 40));
    assert.doesNotThrow(() => manager.kill('fallback-1'));
    assert.equal(manager.sessions.has('fallback-1'), false);
  });

  await contract('active rebuild owns an independent runtime instance instead of inheriting the legacy global startup lock', async () => {
    const rebuildMain = fs.readFileSync(path.join(__dirname, '..', 'electron', 'rebuild-main.js'), 'utf8');
    assert.match(rebuildMain, /singleInstancePolicy:'independent_rebuild_runtime'/u);
    assert.match(rebuildMain, /app\.requestSingleInstanceLock=\(\)=>true/u);
    assert.match(rebuildMain, /finally\{\s*app\.requestSingleInstanceLock=legacyRequestSingleInstanceLock;/u);
    assert.match(rebuildMain, /workspace_bridge_port_selected/u);
    assert.match(rebuildMain, /bridgePort:Number\(process\.env\.ACCESS_AGENT_IDE_BRIDGE_PORT\)/u);
  });

  if (failures.length) {
    console.error(`\n${failures.length} rebuild Phase-0 contract(s) are not yet implemented.`);
    process.exitCode = 1;
    return;
  }

  console.log('rebuild-phase0-contract-smoke: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
