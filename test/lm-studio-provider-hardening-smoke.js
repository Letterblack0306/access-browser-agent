'use strict';

const assert = require('node:assert/strict');
const OpenAICompatibleProvider = require('../src/llm/OpenAICompatibleProvider');
const {
  normalizeBaseUrl,
  parseToolArguments,
} = OpenAICompatibleProvider;

assert.equal(normalizeBaseUrl('http://127.0.0.1:1234/v1', 'loopback').hostname, '127.0.0.1');
assert.equal(normalizeBaseUrl('http://192.168.1.173:1233/v1', 'private-network').hostname, '192.168.1.173');
assert.throws(
  () => normalizeBaseUrl('http://192.168.1.173:1233/v1', 'loopback'),
  /loopback hosts only/u,
);
assert.throws(
  () => normalizeBaseUrl('https://example.com/v1', 'private-network'),
  /private-network hosts only/u,
);
assert.equal(normalizeBaseUrl('https://example.com/v1', 'any-http').hostname, 'example.com');
assert.deepEqual(parseToolArguments('{"targetId":"p1"}', 'browser.observe'), { targetId: 'p1' });
assert.throws(
  () => parseToolArguments('{invalid', 'browser.observe'),
  error => error?.code === 'PROVIDER_TOOL_ARGUMENTS_INVALID',
);

const requests = [];
const provider = new OpenAICompatibleProvider({
  baseUrl: 'http://192.168.1.173:1233/v1',
  model: 'qwen/qwen3.5-9b',
  apiKey: 'token-value',
  endpointPolicy: 'private-network',
  contextLength: 8192,
  ttlSeconds: 300,
  fetch: async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/models')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: 'qwen/qwen3.5-9b' }, { id: ' qwen/qwen3.5-9b ' }] }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        model: 'qwen/qwen3.5-9b',
        choices: [{ message: { content: 'READY' } }],
      }),
    };
  },
});

(async () => {
  const health = await provider.checkHealth();
  assert.equal(health.healthy, true);
  assert.equal(health.modelAvailable, true);
  assert.equal(health.modelCount, 1);
  assert.deepEqual(await provider.listModels(), ['qwen/qwen3.5-9b']);

  const completion = await provider.complete({ messages: [{ role: 'user', content: 'READY' }] });
  assert.equal(completion.content, 'READY');

  const modelRequest = requests.find(item => item.url.endsWith('/models'));
  assert.equal(modelRequest.options.headers.Authorization, 'Bearer token-value');
  const completionRequest = requests.find(item => item.url.endsWith('/chat/completions'));
  const body = JSON.parse(completionRequest.options.body);
  assert.equal(body.context_length, 8192);
  assert.equal(body.ttl, 300);

  const { AgentRuntimeAdapter } = require('../electron/agent-runtime-adapter');
  const adapter = new AgentRuntimeAdapter({
    workspaceRoot: process.cwd(),
    getSettings: () => ({}),
  });
  adapter.service.provider.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: 'An LM Studio API token is required to make requests to this server' } }),
  });

  const resDiscover = await adapter.updateProviderSettings({ discoverOnly: true, lmStudioBaseUrl: 'http://127.0.0.1:1234' });
  assert.equal(resDiscover.provider.healthy, false);
  assert.match(resDiscover.error, /LM Studio API token is required/u);

  const resFull = await adapter.updateProviderSettings({ lmStudioBaseUrl: 'http://127.0.0.1:1234', lmStudioModel: 'test-model' });
  assert.equal(resFull.provider.healthy, false);
  assert.match(resFull.provider.failureReason, /LM Studio API token is required/u);

  console.log('lm-studio-provider-hardening-smoke: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
