// CRITICAL_TRIAGE: see docs/change-intents/2026-08-23-orphan-triage.md
// This file is flagged for behavior verification before any keep/wire/delete decision.
// Do not delete or change behavior without first recording a check result in the triage doc.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const main = read('electron/main.js');
const preload = read('electron/preload.js');
const adapter = read('electron/agent-runtime-adapter.js');
const bridge = read('electron/lm-studio-settings-bridge.js');
const settingsModule = read('electron/settings-module.js');
const preferences = read('src/system/ide-preferences.js');
const provider = read('src/llm/OpenAICompatibleProvider.js');
const index = read('electron/index.html');

assert.match(index, /lm-studio-settings-bridge\.js/u);
assert.match(index, /settings-module\.js/u);
assert.ok(index.indexOf('lm-studio-settings-bridge.js') < index.indexOf('settings-module.js'));
assert.ok(index.indexOf('settings-module.js') < index.indexOf('renderer.js'));
assert.match(preload, /providerConfigure\s*:/u);
assert.match(preload, /providerReadiness\s*:/u);
assert.match(preload, /agentRun\s*:/u);
assert.match(preload, /preferences\s*:/u);
assert.match(preload, /savePreferences\s*:/u);
assert.match(main, /ide:provider-configure/u);
assert.match(main, /ide:provider-readiness/u);
assert.match(adapter, /updateProviderSettings/u);
assert.match(adapter, /providerReadiness/u);
assert.match(adapter, /discoverOnly/u);
assert.match(adapter, /lmStudioEndpointPolicy/u);
assert.match(adapter, /lmStudioApiKey/u);
assert.match(bridge, /lmStudioApiKey/u);
assert.match(bridge, /lmStudioEndpointPolicy/u);
assert.match(bridge, /lmStudioContextLength/u);
assert.match(bridge, /lmStudioTtlSeconds/u);
assert.match(bridge, /discoverModels/u);
assert.match(bridge, /stopImmediatePropagation/u);
assert.match(bridge, /Readiness response mismatch/u);
assert.match(bridge, /observed !== 'READY'/u);
assert.match(bridge, /await api\.providerReadiness\(\)/u);
assert.doesNotMatch(bridge, /api\.agentRun\(/u);
assert.match(bridge, /await api\.savePreferences\(requested\)/u);
assert.match(bridge, /const previousPreferences = await api\.preferences\(\)/u);
assert.match(bridge, /previousPreferences\?\.useClineStyle === true/u);
assert.ok(bridge.indexOf('const previousPreferences = await api.preferences();') < bridge.indexOf('await api.savePreferences(requested)'), 'engine selection must be read before saving preferences');
assert.match(bridge, /persistenceVerified:\s*true/u);
assert.match(preferences, /private-network/u);
assert.match(preferences, /lmStudioConversationMode:\s*'application'/u);
assert.match(provider, /PROVIDER_TOOL_ARGUMENTS_INVALID/u);
assert.match(provider, /modelAvailable/u);
assert.match(provider, /context_length/u);
assert.match(provider, /body\.ttl/u);
assert.match(settingsModule, /LM Studio settings bridge is not loaded/u);

console.log('lm-studio-settings-smoke: PASS');
