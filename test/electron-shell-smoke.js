'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'electron');

for (const name of ['main.js','preload.js','index.html','shell-module-manager.js','settings-module.js','renderer.js','styles.css','editor-enhancements.css','editor-find-replace.js','pty-terminal-manager.js']) {
  if (!fs.existsSync(path.join(root, name))) throw new Error(`Electron shell file is missing: ${name}`);
}

const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const shellManager = fs.readFileSync(path.join(root, 'shell-module-manager.js'), 'utf8');
const settingsModule = fs.readFileSync(path.join(root, 'settings-module.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

for (const required of ['contextIsolation: true','nodeIntegration: false','requestSingleInstanceLock','setWindowOpenHandler',"'ide:write'","'ide:terminal-create'","'ide:context-menu'","'ide:agent-run'"]) {
  if (!main.includes(required)) throw new Error(`Electron main is missing: ${required}`);
}
for (const required of ["'ide:workbench-layout'","'ide:write'","'ide:search'","'ide:models'","'ide:git-status'","'ide:terminal-create'","'ide:terminal-write'","'ide:agent-run'","'ide:agent-event'"]) {
  if (!preload.includes(required)) throw new Error(`Preload route is missing: ${required}`);
}
for (const forbidden of ['browserPages','captureBrowserPage','browserLoop','checkBrowser','listPages','capturePage']) {
  if (main.includes(forbidden) || preload.includes(forbidden) || renderer.includes(forbidden) || settingsModule.includes(forbidden)) {
    throw new Error(`Browser-specific shell ownership remains: ${forbidden}`);
  }
}
for (const required of ["'ide:select-chrome-profile'", "'ide:browser-start'", "'ide:browser-stop'", "'ide:browser-open'", "'ide:skill-read'"]) {
  if (!main.includes(required) || !preload.includes(required)) throw new Error(`Managed Chrome route is missing: ${required}`);
}
for (const required of ['appendDirectory','openFiles = new Map()','saveCurrentFile','expectedSha256','editorTabs','renderDiff','initTerminal','onAgentEvent','showContextMenu']) {
  if (!renderer.includes(required)) throw new Error(`Renderer feature is missing: ${required}`);
}
for (const required of ['RAIL_ICON_PATHS','railIcon(module)','railGroup(module)','rail-divider','class ShellModuleManager','select(id)','reset()','renderRail()','wireResizers()']) {
  if (!shellManager.includes(required)) throw new Error(`Shell UX contract is missing: ${required}`);
}
for (const iconId of ['agent','live-agent','review','editor','skills','settings','git','logs']) {
  if (!shellManager.includes(`${iconId}:`) && !shellManager.includes(`'${iconId}':`)) throw new Error(`Rail icon is missing: ${iconId}`);
}
if (!html.includes('data-shell-slot="left"') || !html.includes('data-shell-slot="right"') || !html.includes('data-shell-slot="right-agent"') || !html.includes('data-shell-slot="bottom"') || !html.includes('data-shell-slot="stash"') || !html.includes('@xterm/xterm')) {
  throw new Error('Modular PTY shell contract is missing.');
}
if (html.includes('id="agentControl"')) throw new Error('Header must not duplicate the Live Agent Start/Stop control.');
for (const moduleName of ['explorer','editor','terminal','agent','liveAgent','git','review']) {
  if (!renderer.includes(`${moduleName}: () =>`)) throw new Error(`Renderer is missing the ${moduleName} module factory.`);
}
if (!renderer.includes('review-grid') || !renderer.includes('Changes') || !renderer.includes('Evidence') || !renderer.includes('Activity')) throw new Error('Review must consolidate changes, evidence, and activity.');
if (!settingsModule.includes('function template') || !settingsModule.includes('settings-hero') || !settingsModule.includes('Use LM Studio') || !settingsModule.includes('Use Cline provider')) throw new Error('Settings module is missing its setup-first provider template.');
if (!settingsModule.includes('settings-grid') || !settingsModule.includes('lmStudioSecurityFields') || !settingsModule.includes('lmStudioRuntimeFields')) throw new Error('LM Studio settings must be grouped into compact sections.');
for (const required of ['Checking Managed Chrome and detecting browser tabs…', 'Opening browser, checking tabs, and starting relay…', 'persistedBrowserTarget', 'findBrowserProviderTabs', 'startBrowserRelay', 'openManagedProvider', 'agentTimeline', 'agentTimelineRow']) {
  if (!renderer.includes(required)) throw new Error(`Task relay control is missing: ${required}`);
}
if (!renderer.includes('Watched tab') || !renderer.includes('showWatchedProviderTab') || !renderer.includes('Relay watching ${describeProviderTab(tab)}')) throw new Error('Selected provider tab must be visible after relay start.');
if (!renderer.includes('browser-control-grid') || !styles.includes('.browser-control-grid')) throw new Error('Managed browser and relay controls must be adjacent.');
if (renderer.includes('id="startManagedChrome"') || renderer.includes('id="stopManagedChrome"')) throw new Error('Managed browser lifecycle must not expose duplicate launch or stop buttons.');
if (!renderer.includes('Copy provider prompt') || !renderer.includes('browserInstructionPrompt') || renderer.includes('Describe the task for the selected workspace')) throw new Error('Browser instruction template surface is missing or direct-task UI remains.');
if (settingsModule.includes('03 · BROWSER RELAY') || settingsModule.includes('browserProviderTab') || settingsModule.includes('startManagedChrome')) throw new Error('Browser runtime controls must not be duplicated in Settings.');
if (!styles.includes('.shell-agent') || !shellManager.includes('right-agent') || styles.includes('.agent-conversation { position:sticky;') || !styles.includes('.agent-timeline { max-height:132px; overflow:auto;')) throw new Error('Live Agent must be a permanent right-side panel without sticky overlap.');
if (!renderer.includes('liveAgentControl')) throw new Error('Live Agent must own its Start/Stop control.');
if (!renderer.includes('inspectSkill') || !renderer.includes('api().skillRead') || !renderer.includes('skillDetails') || !renderer.includes('openSkillsFolder')) throw new Error('Skills must expose live instruction inspection and folder access.');
if (!renderer.includes('agentTimelineToggle') || !renderer.includes('updateAgentStatusCard') || !renderer.includes('agentHistory') || !renderer.includes('agentTimelineExpanded')) throw new Error('Agent progress must use one live status card with expandable history.');
if (!styles.includes('.turn-step') || !renderer.includes('agentConversationRows') || !renderer.includes('revealAgentProgress') || renderer.includes('activityEvents.push(event);')) throw new Error('Agent events must update as an inline, correlated conversation without duplicating Activity.');
for (const required of ["last.status === 'waiting_for_browser'", "input\\.waiting", "agentRuntimeState", "dependency.waiting", "approval.pending", "step.failed"]) {
  if (!renderer.includes(required)) throw new Error(`Live agent state rendering is missing: ${required}`);
}
console.log('Electron shell smoke PASS');
