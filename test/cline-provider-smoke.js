'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ClineAuthSession } = require('../src/llm/ClineAuthSession');
const {
  ClineLlmsProvider,
  toClineConversation,
  toClineTools,
} = require('../src/llm/ClineLlmsProvider');
const { createProvider, normalizeProviderKind } = require('../src/llm/ProviderFactory');
const OpenAICompatibleProvider = require('../src/llm/OpenAICompatibleProvider');

async function testAuthSession() {
  let loginCalls = 0;
  let authEvent = null;
  const credentials = {
    access: 'access-token',
    refresh: 'refresh-token',
    expires: Date.now() + 60 * 60 * 1000,
    accountId: 'acct-1',
    email: 'artist@example.test',
  };
  const handler = {
    async login({ callbacks }) {
      loginCalls += 1;
      callbacks.onAuth({ url: 'https://example.test/auth', instructions: 'Open browser' });
      return credentials;
    },
    async refresh() { return credentials; },
  };
  const auth = new ClineAuthSession({
    loadCore: async () => ({
      getProviderAuthHandler: id => id === 'cline' ? handler : null,
      formatProviderOAuthApiKey: (_id, value) => `workos:${value.access}`,
    }),
    onAuth: info => { authEvent = info; },
  });
  const status = await auth.login();
  assert.equal(loginCalls, 1);
  assert.equal(status.authenticated, true);
  assert.equal(status.persisted, false);
  assert.equal(status.email, 'artist@example.test');
  assert.equal(authEvent.url, 'https://example.test/auth');
  assert.equal(await auth.getApiKey(), 'workos:access-token');
  assert.equal((await auth.logout()).authenticated, false);
}

async function testAuthPersistence() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'access-cline-auth-'));
  const credentials = {
    access: 'persist-access',
    refresh: 'persist-refresh',
    expires: Date.now() + 60 * 60 * 1000,
    accountId: 'acct-persist',
    email: 'persist@example.test',
  };
  const core = {
    getProviderAuthHandler: id => id === 'cline'
      ? { login: async () => credentials, refresh: async () => credentials }
      : null,
    formatProviderOAuthApiKey: (_id, value) => `workos:${value.access}`,
  };

  try {
    const first = new ClineAuthSession({
      preferencesPath: directory,
      loadCore: async () => core,
    });
    const login = await first.login();
    assert.equal(login.authenticated, true);
    assert.equal(login.persisted, true);

    const second = new ClineAuthSession({
      preferencesPath: directory,
      loadCore: async () => core,
    });
    const restored = await second.load();
    assert.equal(restored.authenticated, true);
    assert.equal(restored.persisted, true);
    assert.equal(restored.email, 'persist@example.test');
    assert.equal(await second.getApiKey(), 'workos:persist-access');

    const logout = await second.logout();
    assert.equal(logout.authenticated, false);
    assert.equal(logout.persisted, false);

    const third = new ClineAuthSession({
      preferencesPath: directory,
      loadCore: async () => core,
    });
    const afterRestart = await third.load();
    assert.equal(afterRestart.authenticated, false);
    assert.equal(afterRestart.persisted, false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function testClineProvider() {
  const created = [];
  const requests = [];
  const llms = {
    async getModelsForProvider(providerId) {
      assert.equal(providerId, 'cline');
      return {
        'free-model': { pricing: { input: 0, output: 0 } },
        'paid-model': { pricing: { input: 1, output: 2 } },
      };
    },
    createHandler(config) {
      created.push(config);
      return {
        setAbortSignal(signal) { this.signal = signal; },
        async *createMessage(systemPrompt, messages, tools) {
          requests.push({ systemPrompt, messages, tools });
          yield { type: 'text', text: 'Using tool.' };
          yield {
            type: 'tool_calls',
            tool_call: {
              call_id: 'call-1',
              function: { id: 'fn-1', name: 'readFile', arguments: '{"path":"README.md"}' },
            },
          };
          yield { type: 'usage', inputTokens: 12, outputTokens: 4, totalCost: 0 };
          yield { type: 'done', success: true };
        },
      };
    },
  };
  const provider = new ClineLlmsProvider({
    providerId: 'cline',
    model: 'free-model',
    apiKeyProvider: async () => 'workos:test',
    loadLlms: async () => llms,
  });
  const catalog = await provider.listModelCatalog();
  assert.deepEqual(catalog.map(item => [item.id, item.free]), [
    ['free-model', true],
    ['paid-model', false],
  ]);
  const health = await provider.checkHealth();
  assert.equal(health.healthy, true);
  assert.equal(health.modelAvailable, true);

  const result = await provider.complete({
    messages: [
      { role: 'system', content: 'System rule' },
      { role: 'user', content: 'Read README.' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'old-call', type: 'function', function: { name: 'searchFiles', arguments: '{"query":"x"}' } }],
      },
      { role: 'tool', tool_call_id: 'old-call', content: '{"ok":true}' },
    ],
    tools: [{ type: 'function', function: { name: 'readFile', description: 'Read file', parameters: { type: 'object' } } }],
  });
  assert.deepEqual(created[0], { providerId: 'cline', apiKey: 'workos:test', modelId: 'free-model' });
  assert.equal(requests[0].systemPrompt, 'System rule');
  assert.equal(requests[0].messages[1].content[0].type, 'tool_use');
  assert.equal(requests[0].messages[2].content[0].type, 'tool_result');
  assert.equal(requests[0].tools[0].name, 'readFile');
  assert.equal(result.content, 'Using tool.');
  assert.deepEqual(result.toolCalls, [{ id: 'call-1', name: 'readFile', arguments: { path: 'README.md' } }]);
  assert.equal(result.usage.totalCost, 0);
  assert.equal(provider.getHealth().reachable, true);
}

function testConversionsAndFactory() {
  const converted = toClineConversation([
    { role: 'system', content: 'A' },
    { role: 'system', content: 'B' },
    { role: 'user', content: 'Hello' },
  ]);
  assert.equal(converted.systemPrompt, 'A\n\nB');
  assert.deepEqual(toClineTools([{ type: 'function', function: { name: 'x', parameters: { type: 'object' } } }]), [
    { name: 'x', description: '', inputSchema: { type: 'object' } },
  ]);
  assert.equal(normalizeProviderKind('local'), 'lm-studio');
  assert.equal(normalizeProviderKind('cline'), 'cline');
  assert.ok(createProvider({ providerKind: 'lm-studio', lmStudioBaseUrl: 'http://127.0.0.1:1234/v1', lmStudioModel: 'x' }) instanceof OpenAICompatibleProvider);
  assert.ok(createProvider({ providerKind: 'cline', clineModel: 'x', clineApiKey: 'test' }) instanceof ClineLlmsProvider);
}

(async () => {
  await testAuthSession();
  await testAuthPersistence();
  await testClineProvider();
  testConversionsAndFactory();
  console.log('Cline provider smoke PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
