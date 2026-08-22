'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseWorkbenchLayout } = require('../src/system/workbench-layout');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const html = read('electron/index.html');
const css = read('electron/rebuild-shell.css');
const stabilityCss = read('electron/rebuild-ui-stability.css');
const renderer = read('electron/rebuild-renderer.js');
const shell = read('electron/rebuild-shell.js');
const resetActions = read('electron/rebuild-reset-actions.js');
const projection = read('electron/rebuild-runtime-state.js');
const settings = read('electron/rebuild-settings.js');
const preload = read('electron/preload.js');
const main = read('electron/rebuild-main.js');
const authorityMain = read('electron/main.js');
const diagnosticEnhancer = read('electron/rebuild-diagnostic-enhancer.js');
const layout = parseWorkbenchLayout(read('electron/workbench.layout.json'));
const bootSource = renderer.slice(renderer.indexOf('async function boot()'));

for (const active of [
  'rebuild-runtime-state.js','rebuild-shell.js','rebuild-renderer.js','rebuild-reset-actions.js','rebuild-settings.js','rebuild-diagnostic-enhancer.js',
  'rebuild-shell.css','rebuild-settings.css',
]) assert.ok(html.includes(active), `fresh entrypoint missing ${active}`);

for (const historical of [
  './renderer.js','shell-module-manager.js','agent-workflow-view','task-state-panel.js',
  'settings-module.js','lm-studio-settings-bridge.js','runtime-view-state.js',
]) assert.ok(!html.includes(historical), `historical UI must not be active: ${historical}`);

for (const requiredId of [
  'workspacePath','conversation','chatUrl','loopStart','recoverLoop','checkTarget','deliveryState','terminalHost',
  'diagnosticList','diagnosticFilter','openDiagnosticFolder','eventList','problemList','validationOutput',
  'clineLogin','clineModel','lmBaseUrl','browserProfilePath','toggleMcp','runtimeRestart','stopAll','resetLayout','resetActions',
]) assert.match(html, new RegExp(`id="${requiredId}"`, 'u'), `missing fresh workbench control ${requiredId}`);
assert.doesNotMatch(html,/id="runtimeToggle"|id="runtimeStart"|id="runtimeStop"|id="loopStop"/u,'duplicate lifecycle controls must not be visible');
assert.match(html,/id="resetActions"[\s\S]*?<option value="browser-session">Reset browser session<\/option>[\s\S]*?<option value="runtime">Reset runtime<\/option>[\s\S]*?<option value="layout">Reset layout<\/option>[\s\S]*?<option value="stop-all">Stop All Access resources<\/option>/u,'top-bar Reset dropdown must centralize recovery choices');
assert.match(html,/id="resetLayout"[^>]*hidden/u,'layout reset implementation control must stay hidden behind the Reset dropdown');
assert.match(html,/id="recoverLoop"[^>]*hidden[^>]*>Reset browser session</u,'browser-session recovery must be delegated through the Reset dropdown');
assert.match(html,/id="runtimeRestart"[^>]*>Reset runtime</u,'runtime reset owner must remain available behind the Reset dropdown');
assert.match(html,/id="stopAll"[^>]*>Stop All</u,'Stop All owner must remain available behind the Reset dropdown');
assert.match(html,/Recovery actions are available from the top-bar Reset menu/u);
assert.match(html,/Browser-owned agent session/u);
assert.match(html,/Waiting for browser work/u);
assert.match(html,/No port or tab selection is required/u);
assert.match(html,/class="composer" hidden aria-hidden="true"/u,'legacy composer shell must remain hidden and disabled while layout compatibility is retained');
assert.match(html,/id="runTask"[^>]*disabled/u);
assert.match(html,/id="taskInput"[^>]*disabled/u);
assert.match(html,/aria-label="Manual target selection disabled"/u,'manual target compatibility shell must be hidden/disabled');
assert.doesNotMatch(html,/authorization required|awaiting authorization|>approve<|>deny</iu,'active UI must not contain approval/authorization workflow');

for (const token of ['#0b0b0c','#141416','#1c1c1f','#2a2a2d','#e1e1e6','#8e8e93','#ff3b3b']) assert.ok(css.includes(token), `Industrial Dark token ${token} must remain explicit`);
assert.match(css,/--top-h:\s*40px/u);
assert.match(css,/--status-h:\s*22px/u);
assert.match(css,/--left-w:\s*248px/u);
assert.match(css,/--right-w:\s*332px/u);
assert.match(css,/--bottom-h:\s*230px/u);
assert.match(stabilityCss,/\.live-session-stream/u);
assert.match(stabilityCss,/\.live-tool-cell/u);
assert.match(stabilityCss,/\.live-tool-state/u);
assert.match(stabilityCss,/There is deliberately no approval\/authorization UI/u);

assert.match(shell,/access-agent\.rebuild-layout\.v1/u);
assert.match(shell,/viewportLimits\(\)/u);
assert.match(shell,/window\.visualViewport\?\.addEventListener\('resize'/u);
assert.match(shell,/resolution: 1dppx/u);
assert.match(shell,/applyDimensions\(true\)/u);
assert.match(shell,/showCenter\(view\)/u);
assert.match(shell,/showRight\(view\)/u);
assert.match(shell,/showBottom\(view\)/u);
assert.match(shell,/findRootRule\(\)/u);
assert.match(shell,/setLayoutVariable\(name, value\)/u);
assert.doesNotMatch(shell,/this\.root\.style|documentElement\.style/u,'layout sizing must not write element-inline styles under strict CSP');
assert.match(shell,/localStorage\.setItem\(STORAGE_KEY/u,'layout reset must remain scoped to the layout storage owner');
assert.doesNotMatch(shell,/savePreferences|providerConfigure|browserProfilePath|browserChatUrl/u,'layout reset must not mutate persisted runtime/provider/browser settings');

assert.match(resetActions,/['"]browser-session['"]\s*:\s*['"]recoverLoop['"]/u);
assert.match(resetActions,/runtime\s*:\s*['"]runtimeRestart['"]/u);
assert.match(resetActions,/layout\s*:\s*['"]resetLayout['"]/u);
assert.match(resetActions,/['"]stop-all['"]\s*:\s*['"]stopAll['"]/u);
assert.match(resetActions,/target\.click\(\)/u,'Reset dropdown must delegate to existing lifecycle owners');
assert.doesNotMatch(resetActions,/runtimeStop|browserStop|browserRelayStop|savePreferences/u,'Reset dropdown dispatcher must not duplicate lifecycle or settings logic');

assert.match(renderer,/Projection\.fromSnapshot/u);
assert.match(renderer,/ensureRuntimeActive/u);
assert.match(renderer,/trigger:'browser_loop_start'/u);
assert.match(renderer,/toggleLoop/u);
assert.match(renderer,/\$\('loopStart'\)\.textContent = state\.loop\.running \? 'Stop' : 'Start'/u);
assert.match(renderer,/startExactLoop/u);
assert.match(renderer,/api\.browserStart\(\)/u);
assert.match(renderer,/api\.browserOpenExactChat/u);
assert.match(renderer,/api\.browserRelaySelect/u);
assert.match(renderer,/api\.browserRelayStart/u);
assert.match(renderer,/api\.browserRelayStop/u);
assert.match(renderer,/api\.browserRelayCheck/u);
assert.doesNotMatch(renderer,/function runTask\(|api\.agentRun|\$\('runTask'\)\.addEventListener|taskInput.*keydown/su,'local renderer must not own a competing manual instruction path');
assert.doesNotMatch(renderer,/function refreshTargets\(|function selectTarget\(|browserStart.*refreshTargets|selectTarget.*addEventListener/su,'normal renderer must not expose manual browser target setup');
assert.match(renderer,/function liveStreamRecord\(/u);
assert.match(renderer,/function renderLiveSessionStream\(/u);
assert.match(renderer,/class="live-tool-cell"/u);
assert.match(renderer,/evidence in Complete Log/u);
assert.match(renderer,/renderLiveSessionStream\(\)/u);
assert.doesNotMatch(renderer,/approval|approve|deny|awaiting authorization/iu,'live runtime stream must not implement approval semantics');
assert.match(renderer,/api\.terminalCreate/u);
assert.match(renderer,/api\.onAgentEvent/u);
assert.match(renderer,/stopAllOwned/u);
assert.match(renderer,/All Access-owned runtime, loop, browser, and terminal resources stopped/u);
assert.match(renderer,/\$\('recoverLoop'\)\.disabled = !\$\('chatUrl'\)\?\.value\.trim\(\)/u);
assert.doesNotMatch(renderer,/Start the runtime before starting the browser loop|Runtime is stopped\. Start it before running a task/u,'Browser Start must demand-start runtime instead of instructing a preparatory click');
assert.match(bootSource,/Promise\.allSettled\(\[refreshFiles\(\),refreshGit\(\),refreshDiagnostics\(\)\]\)/u);
assert.ok(!bootSource.includes('browserProviderTabs('),'renderer boot must not enumerate browser targets');
assert.ok(!bootSource.includes('browserStart('),'renderer boot must not start managed Chrome');
assert.match(preload,/browserRelayStart:\s*\(\)\s*=>\s*invoke\('ide:browser-relay-start'\)/u,'preload must transport relay start to the authority owner');
assert.doesNotMatch(preload,/startBrowserRelayWhenAgentReady|PROVIDER_CAPABILITY_UNVERIFIED/u,'preload must not duplicate the authority readiness/recovery ordering gate');
assert.match(authorityMain,/new BrowserSessionAuthority/u,'production main process must retain the relay readiness authority owner');
assert.match(authorityMain,/ipcMain\.handle\('ide:browser-relay-start',\s*\(\)\s*=>\s*browserAuthority\.startRelay\(\)\)/u,'production relay-start IPC must delegate to BrowserSessionAuthority');
assert.doesNotMatch(preload,/agentRun:\s*input\s*=>\s*invoke\('ide:agent-run'/u,'renderer preload must not expose manual agent-run capability');
assert.match(preload,/moduleRegistryStatus:\s*\(\)\s*=>\s*invoke\('ide:module-registry-status'\)/u);
assert.match(main,/ipcMain\.handle\('ide:module-registry-status'/u);
assert.match(main,/state:cautions\.length\?'caution':'ok'/u);
assert.match(diagnosticEnhancer,/moduleRegistryBadge/u);
assert.match(diagnosticEnhancer,/Module maintenance/u);
assert.match(diagnosticEnhancer,/caution\?'Caution':'Maintained'/u);
assert.match(diagnosticEnhancer,/data-maintenance-only|maintenanceOnly/u);
assert.doesNotMatch(diagnosticEnhancer,/runTask.*disabled|loopStart.*disabled|runtimeToggle.*disabled/su,'module maintenance caution must never gate runtime/agent controls');
assert.match(projection,/browserDelivery/u);
assert.match(projection,/delivery_failed/u);
assert.match(projection,/delivery_unverified/u);
assert.match(projection,/problems/u);
assert.match(projection,/instruction_recovery_required/u);
assert.match(renderer,/data-recovery-action/u);
assert.match(renderer,/browserRecoveryReconcile/u);
assert.match(settings,/saved_chat_loaded/u);
assert.doesNotMatch(settings,/restoreBrowserTarget/u,'saved target recovery must remain passive at boot');
assert.doesNotMatch(settings,/SettingsModule|LmStudioSettingsBridge/u);
assert.doesNotMatch(settings,/clineDiscover\(\)\.catch/u,'provider discovery must be user-triggered');
assert.match(diagnosticEnhancer,/operationId/u);
assert.match(diagnosticEnhancer,/providerRequestId/u);
assert.match(diagnosticEnhancer,/artifactId/u);

assert.equal(layout.version,2);
assert.ok(layout.modules.some(item=>item.id==='explorer'&&item.placement==='left'&&item.visible));
assert.ok(layout.modules.some(item=>item.id==='task'&&item.placement==='right'&&item.visible));
assert.ok(layout.modules.some(item=>item.id==='browser-loop'&&item.placement==='right-agent'&&item.visible));
assert.equal(layout.modules.filter(item=>item.placement==='bottom'&&item.visible).length,1);

console.log('rebuild-shell-smoke: PASS');
