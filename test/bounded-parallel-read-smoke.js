'use strict';

const assert = require('node:assert/strict');
const { LiveAgentCore, partitionToolCalls } = require('../src/agent/executive/LiveAgentCore');
const ToolRegistry = require('../src/agent/ToolRegistry');

async function testPartitionToolCalls() {
  const isReadOnly = name => name.startsWith('read');
  const calls = [
    { name: 'readA', id: '1' },
    { name: 'readB', id: '2' },
    { name: 'writeA', id: '3' },
    { name: 'readC', id: '4' },
  ];
  const batches = partitionToolCalls(calls, isReadOnly);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].isReadOnly, true);
  assert.equal(batches[0].calls.length, 2);
  assert.equal(batches[1].isReadOnly, false);
  assert.equal(batches[1].calls.length, 1);
  assert.equal(batches[2].isReadOnly, true);
  assert.equal(batches[2].calls.length, 1);
  console.log('PASS: partitionToolCalls smoke');
}

async function testParallelReadExecution() {
  const registry = new ToolRegistry();
  const executionOrder = [];

  registry.register('readA', 'read file A', {}, async () => {
    executionOrder.push('start:readA');
    await new Promise(r => setTimeout(r, 20));
    executionOrder.push('end:readA');
    return { ok: true, file: 'A' };
  }, { readOnly: true });

  registry.register('readB', 'read file B', {}, async () => {
    executionOrder.push('start:readB');
    await new Promise(r => setTimeout(r, 10));
    executionOrder.push('end:readB');
    return { ok: true, file: 'B' };
  }, { readOnly: true });

  registry.register('writeC', 'write file C', {}, async () => {
    executionOrder.push('start:writeC');
    executionOrder.push('end:writeC');
    return { ok: true, file: 'C' };
  }, { readOnly: false });

  let turnCount = 0;
  const mockProvider = {
    complete: async () => {
      turnCount += 1;
      if (turnCount === 1) {
        return {
          content: '',
          toolCalls: [
            { id: 'call-1', name: 'readA', arguments: {} },
            { id: 'call-2', name: 'readB', arguments: {} },
            { id: 'call-3', name: 'writeC', arguments: {} },
          ],
        };
      }
      return { content: 'Done.' };
    },
  };

  const core = new LiveAgentCore({ registry, provider: mockProvider, maxToolCalls: 10 });
  const stepContext = { sessionId: 'test-session', stepId: 'step-1', turnId: 'turn-1' };

  await core.step(stepContext, {
    emitExecutionEvent: async () => {},
    emitAgentEvent: async () => {},
  });

  const startA = executionOrder.indexOf('start:readA');
  const startB = executionOrder.indexOf('start:readB');
  const endA = executionOrder.indexOf('end:readA');
  const endB = executionOrder.indexOf('end:readB');
  const startC = executionOrder.indexOf('start:writeC');

  assert.ok(startA !== -1 && startB !== -1);
  assert.ok(startB < endA, 'readB should start before readA finishes (parallel execution)');
  assert.ok(startC > endA && startC > endB, 'writeC mutation must run strictly after read batch finishes');

  const messages = core.messagesFor('test-session');
  const toolMessages = messages.filter(m => m.role === 'tool');
  assert.equal(toolMessages.length, 3);
  assert.equal(toolMessages[0].tool_call_id, 'call-1');
  assert.equal(toolMessages[1].tool_call_id, 'call-2');
  assert.equal(toolMessages[2].tool_call_id, 'call-3');

  console.log('PASS: parallel read execution & mutation ordering smoke');
}

(async () => {
  await testPartitionToolCalls();
  await testParallelReadExecution();
})();
