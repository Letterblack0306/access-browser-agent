'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  credentialsFromProviderStore,
  resolveClineProvidersPath,
  readClineProviderCredentials,
} = require('../src/llm/ClineProviderStore');
const { ClineAuthSession } = require('../src/llm/ClineAuthSession');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-agent-cline-store-'));
  const storePath = path.join(root, 'providers.json');
  const preferencesPath = path.join(root, 'preferences');
  const source = {
    version: 1,
    providers: {
      cline: {
        settings: {
          auth: {
            accessToken: 'redacted-test-access',
            refreshToken: 'redacted-test-refresh',
            expiresAt: 4102444800000,
            accountId: 'account-test',
            metadata: { email: 'test@example.invalid' },
          },
        },
      },
    },
  };
  await fs.writeFile(storePath, JSON.stringify(source), 'utf8');

  assert.equal(resolveClineProvidersPath(storePath), path.resolve(storePath));
  assert.deepEqual(credentialsFromProviderStore(source), {
    access: 'redacted-test-access',
    refresh: 'redacted-test-refresh',
    expires: 4102444800000,
    accountId: 'account-test',
    email: 'test@example.invalid',
    providerMetadata: { email: 'test@example.invalid' },
  });

  const imported = await readClineProviderCredentials(storePath);
  assert.equal(imported.error, null);
  assert.equal(imported.credentials.access, 'redacted-test-access');
  assert.equal(credentialsFromProviderStore({ providers: { cline: { settings: {} } } }), null);

  const auth = new ClineAuthSession({ preferencesPath, clineProvidersPath: storePath });
  const status = await auth.load();
  assert.equal(status.authenticated, true);
  assert.equal(status.persisted, false);
  assert.equal(status.source, 'cline-provider-store');
  assert.equal((await auth.getApiKey()).endsWith('redacted-test-access'), true);
  await auth.logout();
  const unchanged = JSON.parse(await fs.readFile(storePath, 'utf8'));
  assert.equal(unchanged.providers.cline.settings.auth.accessToken, 'redacted-test-access');

  await fs.writeFile(storePath, '{invalid', 'utf8');
  const malformed = await readClineProviderCredentials(storePath);
  assert.equal(malformed.credentials, null);
  assert.equal(typeof malformed.error, 'string');

  console.log('cline-provider-store-smoke: PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
