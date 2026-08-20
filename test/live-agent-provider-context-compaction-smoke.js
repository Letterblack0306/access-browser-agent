'use strict';

const assert = require('node:assert/strict');
const ToolRegistry = require('../src/agent/ToolRegistry');
const { LiveAgentCore } = require('../src/agent/executive/LiveAgentCore');

class StubProvider {
  async complete() { return { content:'done', toolCalls:[] }; }
}

const registry = new ToolRegistry();
const agent = new LiveAgentCore({ registry, provider:new StubProvider() });
const largeHistoricalToolPayload = JSON.stringify({
  ok:true,
  path:'src/agent/executive/LiveToolContext.js',
  content:'x'.repeat(6000),
});

const durableConversation = {
  messages:[
    { role:'user', instructionId:'old-1', content:'Inspect the previous evidence.' },
    {
      role:'assistant',
      content:'',
      tool_calls:[{
        id:'call-large',
        type:'function',
        function:{ name:'readFile', arguments:'{}' },
      }],
    },
    { role:'tool', tool_call_id:'call-large', content:largeHistoricalToolPayload },
  ],
};

const projected = agent.messagesFor('provider-context-compaction', durableConversation);
const toolMessage = projected.find(message => message.role === 'tool' && message.tool_call_id === 'call-large');

assert.ok(toolMessage, 'provider projection must retain the historical tool-call/result pairing');
assert.ok(toolMessage.content.length < largeHistoricalToolPayload.length, 'provider projection must bound oversized historical tool content');
const bounded = JSON.parse(toolMessage.content);
assert.equal(bounded.truncatedHistoricalToolResult, true);
assert.equal(bounded.originalChars, largeHistoricalToolPayload.length);
assert.equal(typeof bounded.sha256, 'string');
assert.equal(bounded.sha256.length, 64);
assert.equal(typeof bounded.preview, 'string');
assert.ok(bounded.preview.length <= 350);
assert.equal(durableConversation.messages[2].content, largeHistoricalToolPayload, 'durable source evidence must remain unchanged');

console.log('live-agent-provider-context-compaction-smoke: PASS');
