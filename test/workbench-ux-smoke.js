'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'electron', 'workbench-ux.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'electron', 'workbench-ux.css'), 'utf8');
const editorStyles = fs.readFileSync(path.join(root, 'electron', 'editor-enhancements.css'), 'utf8');
const agentProgressStyles = fs.readFileSync(path.join(root, 'electron', 'agent-progress.css'), 'utf8');
const agentProgressView = fs.readFileSync(path.join(root, 'electron', 'agent-progress-view.js'), 'utf8');

for (const label of [
  "explorer: 'Explorer'", "agent: 'Browser / Agent'", "git: 'Git'",
  "'workspace-sync': 'Workspace Tools'", "settings: 'Settings'", "logs: 'Diagnostics'"
]) assert.match(script, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));

assert.match(script, /button\.setAttribute\('aria-current'/u);
assert.match(script, /button\.setAttribute\('aria-controls'/u);
assert.match(script, /pane\.setAttribute\('aria-labelledby'/u);
assert.match(script, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/u);
assert.match(script, /observer\.observe\(rail/u);
assert.doesNotMatch(script, /observer\.observe\(document\.(body|documentElement)/u);

// Operational truth must keep provider/model, transport, action, lifecycle, waiting, active, and settings state separate.
assert.match(script, /Provider \/ model/u);
assert.match(script, /Browser transport/u);
assert.match(script, /Browser action/u);
assert.match(script, /Agent lifecycle/u);
assert.match(script, /agentBrowserTransportSummary/u);
assert.match(script, /agentBrowserSummary/u);
assert.match(script, /providerSummaryText/u);
assert.match(script, /provider inactive/u);
assert.match(script, /inferState/u);
assert.match(script, /queued\|pending\|waiting/u);
assert.match(script, /return 'waiting'/u);
assert.match(script, /return 'active'/u);
assert.match(script, /installTruthObservers/u);
assert.match(script, /function improveSettings/u);
assert.match(script, /settingsStatus/u);
assert.match(script, /Provider: \$\{text\}/u);
assert.match(script, /Capture is unavailable until a live browser page is selected/u);
assert.doesNotMatch(script, /setText\(actionSummary, browserResult\?\.textContent/u);
assert.match(script, /legacyBrowserHeading\.hidden = true/u);
assert.match(script, /Browser details/u);

// Agent process begins idle; waiting is reserved for an actual runtime waiting event.
assert.match(agentProgressView, /processState\.textContent = 'IDLE'/u);
assert.match(agentProgressView, /processState\.dataset\.state = 'idle'/u);
assert.match(agentProgressView, /No agent runtime activity yet\./u);
assert.match(agentProgressView, /type === 'browser_loop\.waiting'/u);
assert.match(agentProgressView, /setState\('WAITING', 'waiting'\)/u);

// Unhandled UI failures must remain visible instead of living only in DevTools/terminal.
assert.match(script, /function installGlobalErrorSurface/u);
assert.match(script, /uiErrorStatus/u);
assert.match(script, /unhandledrejection/u);
assert.match(script, /window\.addEventListener\('error'/u);
assert.match(script, /role', 'alert'/u);
assert.match(styles, /#uiErrorStatus/u);

// Registered but unavailable capabilities must be explicit, not silently clickable.
assert.match(script, /function markUnavailableSurface/u);
assert.match(script, /workspaceSyncStatus/u);
assert.match(script, /projectAuditStatus/u);
assert.match(script, /workspaceSyncStatus !== 'function'/u);
assert.match(script, /projectAuditRun !== 'function'/u);
assert.match(script, /control\.disabled = true/u);
assert.match(script, /capabilityUnavailable/u);

// Navigation must use semantic SVG icons rather than text/emoji glyphs.
assert.match(script, /const railIcons = Object\.freeze/u);
for (const iconKey of ['explorer:', 'agent:', 'git:', "'workspace-sync':", 'settings:', 'logs:']) {
  assert.ok(script.includes(iconKey), `Missing semantic rail icon: ${iconKey}`);
}
assert.match(script, /icon\.innerHTML = railIcons\[id\]/u);
assert.match(script, /aria-hidden="true"/u);

// Industrial Dark tokens and semantic status palette are canonical at the UX layer.
for (const token of ['#0b0b0c', '#141416', '#1c1c1f', '#2a2a2d', '#e1e1e6', '#8e8e93', '#ff3b3b', '#4ade80']) {
  assert.ok(styles.toLowerCase().includes(token), `Missing Industrial Dark token: ${token}`);
}
assert.match(styles, /\.activity-bar\s*\{\s*width:\s*48px/u);
assert.match(styles, /\.rail-icon svg/u);
assert.match(styles, /stroke:\s*currentColor/u);
assert.match(styles, /\.statusbar[\s\S]*background:\s*#111113/u);
assert.doesNotMatch(styles, /background:\s*#007acc/u);
assert.match(styles, /#agentControl/u);
assert.match(styles, /button:focus-visible/u);
assert.match(styles, /\[role="separator"\]:focus-visible/u);
assert.match(styles, /\.diagnostics-shell-pane\[hidden\]/u);
assert.match(styles, /\[data-ui-state="error"\]/u);
assert.match(styles, /\[data-ui-state="warning"\], \[data-ui-state="waiting"\]/u);
assert.match(styles, /\[data-ui-state="active"\]/u);
assert.match(styles, /\[data-ui-state="ready"\]/u);
assert.match(styles, /#settingsStatus/u);

// Browser / Agent must remain navigable when its controls/page list exceed the viewport.
assert.match(agentProgressStyles, /\.module-agent\s*\{[\s\S]*?overflow-y:\s*auto/u);
assert.match(agentProgressStyles, /\.module-agent\s*\{[\s\S]*?overflow-x:\s*hidden/u);
assert.doesNotMatch(agentProgressStyles, /\.module-agent\s*\{[^}]*overflow:\s*hidden/u);
assert.match(agentProgressStyles, /#browserPages\s*\{[\s\S]*?overflow-y:\s*auto/u);
assert.match(agentProgressStyles, /#browserPages\s*\{[\s\S]*?max-height:\s*38vh/u);
assert.match(agentProgressStyles, /overscroll-behavior:\s*contain/u);

// Editor must preserve keyboard focus visibility and the same state semantics.
assert.match(editorStyles, /#editorInput:focus-visible/u);
assert.match(editorStyles, /rgba\(255, 59, 59, \.55\)/u);
assert.match(editorStyles, /agent-event\[data-status="waiting"\]/u);
assert.match(editorStyles, /agent-event\[data-status="failed"\]/u);
assert.match(editorStyles, /top:\s*40px/u);

console.log('Workbench UX smoke PASS');
