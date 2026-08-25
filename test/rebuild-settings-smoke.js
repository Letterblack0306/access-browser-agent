'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron', 'index.html'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'electron', 'rebuild-settings.js'), 'utf8');

assert.match(html, /rebuild-settings\.css/u);
assert.match(html, /rebuild-settings\.js/u);
for (const id of [
  'clineLogin', 'clineLogout', 'clineModel', 'clineRefreshModels', 'clineTest', 'clineUse',
  'lmBaseUrl', 'lmModel', 'lmDiscover', 'lmUse',
  'browserProfilePath', 'browserExecutable', 'chooseChromeProfile', 'saveBrowserDefaults', 'chatUrl',
  'toggleMcp',
]) {
  assert.match(html, new RegExp(`id="${id}"`, 'u'), `fresh settings surface missing ${id}`);
}

for (const required of [
  "providerKind:'cline'", 'clineLogin:true', 'clineLogout:true', 'providerReadiness()', "observed!=='READY'",
  'requireAgentReady', 'ready?.agentReady!==true', 'toolCalling', 'active agent provider',
  "providerKind:'lm-studio'", 'lmStudioApiKey', 'lmStudioEndpointPolicy', 'lmStudioContextLength', 'lmStudioTtlSeconds',
  'mcpServerCommand', 'savePreferences', 'selectChromeProfile', 'browserChatUrl', 'saved_chat_loaded',
  'catalogIdentity', 'pricingClass', 'catalogGroup', 'modelOptionLabel', "['free','Free']", "['local','Local']",
  "['other','Other available']", 'PRICE UNKNOWN', 'Unverified', 'result.modelCatalog||[]',
  'catalogState', 'rememberCatalog', 'projectReadiness', 'readinessState', 'readinessTimestamp',
  'Agent Ready', 'Completion Failed', 'Tool Calling Unsupported', 'Structured Unsupported',
]) {
  assert.ok(settings.includes(required), `fresh settings contract missing: ${required}`);
}
assert.match(settings, /document\.createElement\('optgroup'\)/u, 'model selector should project normalized catalog groups with optgroup');
assert.match(settings, /pricing\?\.classification/u, 'model selector should use normalized pricing classification');
assert.match(settings, /item\.free===true/u, 'model selector should preserve compatibility with legacy free flag');
assert.match(settings, /readiness shown per tested model/u, 'discovery must expose per-model readiness without claiming untested compatibility');
assert.match(settings, /if\(!state\.values\.includes\(model\)\)state\.values\.push\(model\)/u, 'tested saved/off-catalog models must enter the rendered value set so readiness is not reset to Unverified');
assert.match(settings, /item\?`\$\{modelOptionLabel\(item,selected\)\} · Saved`/u, 'saved options with catalog evidence must render their actual readiness state');
assert.match(settings, /const observed=await api\.providerReadiness\(\);projectReadiness\('cline',model,observed\);const ready=requireAgentReady\(observed\)/u, 'Cline Test/Use must project readiness before success validation can throw');
assert.match(settings, /const observed=await api\.providerReadiness\(\);projectReadiness\('lm',requested\.lmStudioModel,observed\);const ready=requireAgentReady\(observed\)/u, 'LM Studio Use must project readiness before success validation can throw');
assert.doesNotMatch(settings, /useClineStyle/u, 'provider choice must not expose a second semantic agent engine');
assert.doesNotMatch(settings.slice(0, settings.indexOf("$('saveSystemPrompt')")), /runtimeRestart/u, 'provider settings must not restart the runtime to switch semantic agent engines');
assert.doesNotMatch(settings, /clineDiscover\(\)\.catch/u, 'settings boot must not silently discover provider models');
assert.match(settings, /click Discover\/Test to verify/u, 'saved provider state must remain explicitly unverified until the user requests discovery or testing');
assert.doesNotMatch(settings, /SettingsModule/u, 'fresh settings must not mount the historical SettingsModule');
assert.doesNotMatch(settings, /LmStudioSettingsBridge/u, 'fresh settings must not depend on the historical LM settings UI bridge');
assert.doesNotMatch(settings, /restoreBrowserTarget/u, 'saved target recovery must not start Chrome or attach during boot');
assert.doesNotMatch(settings, /browserProviderTabs\(\).*browserRelaySelect/su, 'settings boot must not enumerate tabs and attach a saved target');

console.log('rebuild-settings-smoke: PASS');
