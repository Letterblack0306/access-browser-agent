'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { IdePreferences } = require('../src/system/ide-preferences');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'access-ide-preferences-'));
  const preferences = new IdePreferences(directory);
  assert.equal((await preferences.load()).lmStudioModel, '');
  assert.deepEqual((await preferences.load()).workspaceSyncExclusions, ['node_modules', '.env', 'desktop.ini']);
  const saved = await preferences.save({
    workspaceRoot: 'G:/workspace',
    lmStudioBaseUrl: 'http://127.0.0.1:1234/v1',
    lmStudioModel: 'model-a',
    mcpServerCommand: 'node server.js',
    workspaceSyncTarget: 'G:/workspace-copy',
    workspaceSyncExclusions: ['node_modules', '.env', 'desktop.ini', 'dist'],
  });
  assert.equal(saved.lmStudioModel, 'model-a');
  assert.deepEqual(saved.workspaceSyncExclusions, ['node_modules', '.env', 'desktop.ini', 'dist']);
  const providerDefault = await preferences.save({ ...saved, lmStudioContextLength: '', lmStudioTtlSeconds: '' });
  assert.equal(providerDefault.lmStudioContextLength, null, 'blank context length must preserve the provider/model default');
  assert.equal(providerDefault.lmStudioTtlSeconds, null, 'blank TTL must preserve the LM Studio default');
  assert.equal(Object.hasOwn(saved, 'cdpUrl'), false);
  assert.equal(Object.hasOwn(saved, 'chromeProfileRoot'), false);
  assert.deepEqual(await preferences.load(), saved);
  console.log('IDE preferences smoke PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
