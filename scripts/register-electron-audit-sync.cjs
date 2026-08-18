const fs = require('node:fs');

const layoutPath = 'electron/workbench.layout.json';
const rendererPath = 'electron/renderer.js';

const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));

const additions = [
  {
    id: 'workspace-sync',
    content: 'workspaceSync',
    placement: 'drawer',
    order: 65,
    visible: true,
    title: 'W_sync',
    icon: '⇄'
  },
  {
    id: 'project-audit',
    content: 'projectAudit',
    placement: 'drawer',
    order: 66,
    visible: true,
    title: 'Audit',
    icon: '✓'
  }
];

for (const item of additions) {
  const existing = layout.modules.find(module => module.id === item.id);
  if (existing) Object.assign(existing, item);
  else layout.modules.push(item);
}

layout.modules.sort((a, b) => a.order - b.order);
fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2) + '\n', 'utf8');

let renderer = fs.readFileSync(rendererPath, 'utf8');

if (!renderer.includes('workspaceSync: () => `')) {
  const anchor = '\n  editor: () => `';

  const templates = `
  workspaceSync: () => \`
    <div class="module-heading">
      <h2>W_sync</h2>
      <span id="workspaceSyncStatus" class="status-pill">STOPPED</span>
    </div>

    <label>
      Destination folder
      <input id="workspaceSyncDestination" type="text"
             placeholder="Choose destination folder">
    </label>

    <label>
      Excluded files / folders
      <textarea id="workspaceSyncExcludes"
                rows="8"
                placeholder=".git/**
node_modules/**
dist/**"></textarea>
    </label>

    <label class="checkbox-row">
      <input id="workspaceSyncDeleteRemoved" type="checkbox">
      Mirror source deletions
    </label>

    <div class="button-row">
      <button id="workspaceSyncSave" type="button">Save</button>
      <button id="workspaceSyncStart" type="button">Start</button>
      <button id="workspaceSyncStop" type="button">Stop</button>
      <button id="workspaceSyncNow" type="button">Sync now</button>
    </div>

    <pre id="workspaceSyncLog" class="output-panel"></pre>
  \`,

  projectAudit: () => \`
    <div class="module-heading">
      <h2>Project Audit</h2>
      <span id="projectAuditStatus" class="status-pill">IDLE</span>
    </div>

    <label>
      Additional excluded paths
      <textarea id="projectAuditExcludes"
                rows="8"
                placeholder="vendor/**
generated/**
large-assets/**"></textarea>
    </label>

    <div class="button-row">
      <button id="projectAuditRun" type="button">Run audit</button>
      <button id="projectAuditRefresh" type="button">Refresh</button>
    </div>

    <div id="projectAuditSummary" class="audit-summary"></div>
    <div id="projectAuditFindings" class="audit-findings"></div>
    <pre id="projectAuditLog" class="output-panel"></pre>
  \`,
`;

  if (!renderer.includes(anchor)) {
    throw new Error('PATCH_PRECONDITION_FAILED: editor module anchor not found');
  }

  renderer = renderer.replace(anchor, '\n' + templates + anchor);
  fs.writeFileSync(rendererPath, renderer, 'utf8');
}

console.log('ELECTRON_AUDIT_SYNC_MODULES=REGISTERED');
