'use strict';

let ui;
let shellManager;
let terminal;
let fitAddon;
let terminalId = null;
let selectedGitPath = '';
let activeFilePath = '';
let agentRunning = false;
let runtimeStarted = false;
let agentRuntimeState = null;
let activeTurnId = null;
let pendingApprovalId = null;
let providerIdentity = 'PROVIDER UNKNOWN';
let visibleSessionId = null;
let agentTimelineExpanded = false;
let runtimeViewState = window.RuntimeViewState.create();

const openFiles = new Map();
const expandedDirectories = new Set();
const agentEvents = [];
const activityEvents = [];
const traceEvents = [];

const modules = Object.freeze({
  home: () => `
    <div class="home-shell">
      <div class="home-hero"><p class="eyebrow">LOCAL AGENT WORKSPACE</p><h1>Start with the work, not the wiring.</h1><p>Access Agent keeps the provider, workspace, and task in one visible flow.</p><div class="button-row"><button id="homeStartTask" class="primary-button" type="button">Start a task</button><button id="homeOpenWorkspace" class="secondary-button" type="button">Choose workspace</button></div></div>
      <section class="setup-grid" aria-label="Workspace readiness"><article class="setup-card"><span>01 · Workspace</span><strong id="homeWorkspace">Checking workspace…</strong><button id="homeChangeWorkspace" class="text-button" type="button">Change workspace</button></article><article class="setup-card"><span>02 · Provider</span><strong id="homeProvider">Checking provider…</strong><button id="homeConfigureProvider" class="text-button" type="button">Configure provider</button></article><article class="setup-card"><span>03 · Browser</span><strong id="homeBrowser">Checking browser…</strong><button id="homeConfigureBrowser" class="text-button" type="button">Browser setup</button></article><article class="setup-card"><span>04 · Runtime</span><strong id="homeRuntime">Checking runtime…</strong><button id="homeRefreshStatus" class="text-button" type="button">Refresh status</button></article></section>
      <section class="home-section"><div><p class="eyebrow">WORKFLOW</p><h2>Start with a task, then review its outcome.</h2><p class="muted-copy">Task handles browser work and approvals. Review collects changes, evidence, and activity in one place.</p></div><div class="home-actions"><button id="homeGoLibrary" class="action-card" type="button"><strong>Skills</strong><span>Inspect current governed instructions</span></button><button id="homeGoActivity" class="action-card" type="button"><strong>Review</strong><span>See changes, evidence, and activity</span></button></div></section>
    </div>
  `,
  explorer: () => `
    <div class="module-heading"><h2>Explorer</h2><button id="refreshFiles" class="icon-button" type="button" title="Refresh">↻</button></div>
    <label>Search workspace<input id="search" type="search" placeholder="Find text"></label>
    <div id="files" role="tree"></div>
  `,
  workspaceSync: () => `
    <div class="module-heading"><h2>Workspace Sync</h2><button id="workspaceSyncRefresh" class="icon-button" type="button" title="Refresh sync status">↻</button></div>
    <p class="muted">Copies the current workspace once, then watches it. Existing unrelated files in the destination are preserved.</p>
    <label>Copy destination<div class="button-row"><input id="workspaceSyncTarget" type="text" autocomplete="off" placeholder="Choose a folder outside this workspace"><button id="chooseWorkspaceSyncTarget" class="secondary-button" type="button">Choose…</button></div></label>
    <label>Excluded names or relative paths<textarea id="workspaceSyncExclusions" rows="4" spellcheck="false" aria-describedby="workspaceSyncExclusionsHint"></textarea></label>
    <p id="workspaceSyncExclusionsHint" class="muted">One item per line. Default: node_modules, .env, desktop.ini.</p>
    <div class="button-row"><button id="workspaceSyncStart" class="primary-button" type="button">Start sync</button><button id="workspaceSyncStop" class="secondary-button" type="button">Stop sync</button></div>
    <div id="workspaceSyncStatus" class="panel-box" aria-live="polite">Sync is stopped.</div>
  `,
  projectAudit: () => `
    <div class="module-heading"><h2>Project Audit</h2><button id="projectAuditRun" class="primary-button" type="button">Run read-only audit</button></div>
    <p id="projectAuditStatus" class="muted" aria-live="polite">No project audit has run.</p>
    <pre id="projectAuditOutput" class="panel-box audit-result">The audit reports workspace structure and Git state without changing files.</pre>
  `,
  editor: () => `
    <div class="editor-toolbar">
      <div id="editorTabs" class="editor-tabs"></div>
      <div class="editor-actions">
        <button id="toggleDiff" class="secondary-button" type="button" disabled>Diff</button>
        <button id="revertFile" class="secondary-button" type="button" disabled>Revert</button>
        <button id="saveFile" class="primary-button" type="button" disabled>Save</button>
      </div>
    </div>
    <div class="editor-meta"><span id="filePath">No file selected</span><span id="fileState">Workspace ready</span></div>
    <div id="editorEmpty" class="empty-state">Select a workspace file from Explorer to view or edit it.</div>
    <div id="editorSurface" class="editor-surface" hidden>
      <div id="editorGutter" class="editor-gutter"></div>
      <textarea id="editorInput" spellcheck="false" aria-label="File editor"></textarea>
    </div>
    <div id="editorDiff" class="editor-diff" hidden><pre id="diffOriginal"></pre><pre id="diffModified"></pre></div>
  `,
  terminal: () => `
    <div class="terminal-panel">
      <div class="panel-tabs">
        <button class="panel-tab is-active" type="button">Terminal</button>
        <span class="panel-spacer"></span><span id="terminalShellLabel">USER TERMINAL · pwsh</span>
        <button id="restartTerminal" class="icon-button" type="button" title="Restart terminal">↻</button>
        <button id="killTerminal" class="icon-button" type="button" title="Kill terminal">×</button>
      </div>
      <div id="terminalHost" class="terminal-host"></div>
    </div>
  `,
  agent: () => `
    <div class="module-heading"><h2>Agent</h2><span id="agentStatus">Idle</span></div>
    <ol id="browserWorkflow" class="browser-workflow" aria-label="Browser instruction workflow"><li data-step="browser">1. Open browser</li><li data-step="provider">2. Open chat</li><li data-step="tab">3. Detect tab</li><li data-step="relay">4. Start relay</li><li data-step="instruction">5. Send instruction</li><li data-step="execution">6. Observe execution</li><li data-step="result">7. Receive result</li></ol>
    <section class="browser-instruction-card browser-session">
      <p class="eyebrow">01 · MANAGED BROWSER AND RELAY</p><h2>Use one managed browser for this task.</h2><p>Opening the browser starts it. Electron closes it on exit.</p>
      <div class="browser-control-grid">
        <div class="browser-control-group"><span>Managed browser</span><div class="button-row"><button id="openManagedProvider" class="primary-button" type="button">Open browser</button></div></div>
        <div class="browser-control-group"><span>Local relay</span><label>Detected browser tab<select id="browserProviderTab"><option value="">Detect browser tabs after opening Chrome</option></select></label><div class="watched-tab"><span>Watched tab</span><strong id="watchedProviderTab">Not selected</strong></div><div class="button-row"><button id="refreshBrowserProviderTabs" class="secondary-button" type="button">Detect tabs</button><button id="startBrowserRelay" class="primary-button" type="button">Start relay</button><button id="stopBrowserRelay" class="secondary-button" type="button">Stop relay</button></div></div>
      </div>
      <div id="browserSessionStatus" class="notice" hidden aria-live="polite"></div>
      <div id="browserRelayStatus" class="notice" hidden aria-live="polite"></div>
    </section>
    <section class="browser-instruction-card">
      <p class="eyebrow">02 · OPEN PROVIDER AND PREPARE INSTRUCTION</p><h2>Give the browser provider this prompt.</h2><p>It tells the provider how to return a small, detected instruction. Do not paste source files or logs into chat.</p>
      <pre id="browserInstructionTemplate" class="protocol-preview">Preparing the provider prompt…</pre>
      <div class="button-row"><button id="copyBrowserInstructionTemplate" class="primary-button" type="button">Copy provider prompt</button><button id="openBrowserSetup" class="secondary-button" type="button">Browser setup</button></div>
      <p id="browserInstructionCopyStatus" class="muted" aria-live="polite">Paste the prompt into the browser provider, then connect that tab below.</p>
    </section>
    <div id="agentNotice" class="notice" hidden></div>
    <div id="agentApproval" class="approval-bar" hidden>
      <strong id="approvalPrompt"></strong>
      <div class="button-row"><button id="approveAction" class="primary-button" type="button">Approve</button><button id="rejectAction" class="danger-button" type="button">Reject</button></div>
    </div>
  `,
  liveAgent: () => `
    <section class="live-agent-panel" aria-label="Live Agent">
      <div class="live-agent-heading"><div><p class="eyebrow">LIVE AGENT</p><h2 id="agentLiveStatus" aria-live="polite">Waiting for a browser instruction</h2></div><span id="agentElapsed">—</span></div>
      <div class="live-agent-controls"><button id="liveAgentControl" class="primary-button" type="button">Start Runtime</button></div>
      <div id="agentTimeline" class="agent-timeline" aria-live="polite"><div class="empty-state">The next browser instruction starts a new local session here.</div></div>
      <button id="agentTimelineToggle" class="agent-timeline-toggle" type="button" hidden aria-expanded="false">Show all activity</button>
    </section>
  `,
  git: () => `
    <div class="git-layout">
      <div class="git-toolbar"><h2>Git</h2><span id="gitBranch" class="branch">Branch: unknown</span><span id="gitCounts">0 changes</span><button id="refreshGit" class="icon-button" type="button">↻</button></div>
      <div class="git-body"><pre id="gitDiff" class="git-diff">Select a changed file.</pre><aside class="git-tree"><input id="gitFilter" type="search" placeholder="Filter files"><div id="gitChanges"></div></aside></div>
    </div>
  `,
  trace: () => `
    <div class="module-heading"><h2>Execution reasons</h2><button id="refreshTrace" class="icon-button" type="button" title="Refresh execution reasons">↻</button></div>
    <p class="muted">Why an action ran, failed, or was blocked.</p>
    <div class="trace-filters"><label>Status <select id="traceStatusFilter"><option value="">All statuses</option><option value="running">Running</option><option value="failed">Failed</option><option value="completed">Completed</option></select></label><label>Tool <input id="traceToolFilter" type="search"></label><label>Module <input id="traceModuleFilter" type="search"></label><label>Turn <input id="traceTurnFilter" type="search"></label></div>
    <div id="traceList" class="trace-list"><div class="empty-state">No execution trace.</div></div>
  `,
  review: () => `<div class="module-heading"><h2>Review</h2></div><p class="muted">Changes, verified evidence, and activity for the active workspace.</p><div class="review-grid"><section class="review-section"><div class="module-heading"><h3>Changes</h3><button id="refreshChanges" class="icon-button" type="button">↻</button></div><div id="changesList" class="panel-box">No mutations reported.</div></section><section class="review-section"><div class="module-heading"><h3>Evidence</h3><button id="refreshEvidence" class="icon-button" type="button">↻</button></div><label>Filter receipts<input id="evidenceFilter" type="search" placeholder="Filter by session, tool, status, id"></label><div id="evidenceList" class="panel-box">No evidence receipts.</div></section><section class="review-section"><h3>Activity</h3><div id="activityFeed" class="activity-feed"><div class="empty-state">No runtime activity.</div></div></section></div>`,
  skills: () => `<div class="module-heading"><h2>Skills</h2><div class="button-row"><button id="openSkillsFolder" class="secondary-button" type="button">Open skills folder</button><button id="refreshSkills" class="icon-button" type="button">↻</button></div></div><p class="muted">Add a folder containing SKILL.md, then refresh. Inspect current instructions below; the agent uses them through its governed workflow.</p><div id="skillsList" class="skill-list">Loading skills…</div><pre id="skillDetails" class="panel-box audit-result">Choose a skill to inspect its current instructions.</pre>`,
  'task-state': () => '<div id="taskStatePanel"></div>'
});

const rendererById = id => document.getElementById(id);
const api = () => window.accessIde;

function bindUi() {
  ui = Object.fromEntries([
    'workspace','status','footerSession','footerProvider','chooseWorkspace','files','refreshFiles','search','editorTabs','filePath','fileState','editorEmpty','editorSurface','editorGutter','editorInput','editorDiff','diffOriginal','diffModified','toggleDiff','revertFile','saveFile','terminalHost','terminalShellLabel','restartTerminal','killTerminal','workspaceSyncRefresh','workspaceSyncTarget','chooseWorkspaceSyncTarget','workspaceSyncExclusions','workspaceSyncStart','workspaceSyncStop','workspaceSyncStatus','projectAuditRun','projectAuditStatus','projectAuditOutput','agentStatus','agentNotice','approvalPrompt','approveAction','rejectAction','agentApproval','agentLiveStatus','agentElapsed','agentTimeline','agentTimelineToggle','liveAgentControl','gitBranch','gitCounts','gitChanges','gitDiff','gitFilter','refreshGit','activityFeed','refreshTrace','traceStatusFilter','traceToolFilter','traceModuleFilter','traceTurnFilter','traceList','toggleMcp','changesList','refreshChanges','evidenceList','evidenceFilter','refreshEvidence','baseUrl','model','testConnection','refreshModels','saveSettings','skillsList','skillDetails','refreshSkills','mcpServerCommand','browserProfilePath','browserExecutable','chooseChromeProfile','saveBrowserSettings','openManagedProvider','browserSessionStatus','browserProviderTab','watchedProviderTab','refreshBrowserProviderTabs','startBrowserRelay','stopBrowserRelay','browserRelayStatus','browserInstructionTemplate','copyBrowserInstructionTemplate','openBrowserSetup','browserInstructionCopyStatus'
  ].map(id => [id, rendererById(id)]));
  ui.openSkillsFolder = rendererById('openSkillsFolder');
  ['homeStartTask','homeOpenWorkspace','homeChangeWorkspace','homeConfigureProvider','homeConfigureBrowser','homeRefreshStatus','homeGoLibrary','homeGoActivity','homeWorkspace','homeProvider','homeBrowser','homeRuntime'].forEach(id => { ui[id]=rendererById(id); });
}

function fileName(filePath) { return String(filePath || '').split('/').pop() || filePath; }
function currentFile() { return openFiles.get(activeFilePath) || null; }

function languageFor(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  return ({ js:'JavaScript',mjs:'JavaScript',cjs:'JavaScript',ts:'TypeScript',json:'JSON',html:'HTML',css:'CSS',md:'Markdown',ps1:'PowerShell',yml:'YAML',yaml:'YAML' })[ext] || 'Plain text';
}

function renderTabs() {
  const tabs = [...openFiles.values()].map(file => {
    const button = document.createElement('button');
    button.className = `editor-tab${file.path === activeFilePath ? ' is-active' : ''}`;
    button.type = 'button';
    button.title = file.path;
    button.textContent = `${file.dirty ? '● ' : ''}${fileName(file.path)}`;
    const close = document.createElement('span');
    close.className = 'editor-tab-close';
    close.textContent = '×';
    close.addEventListener('click', event => { event.stopPropagation(); closeFile(file.path); });
    button.append(close);
    button.addEventListener('click', () => selectFile(file.path));
    return button;
  });
  ui.editorTabs.replaceChildren(...tabs);
}

function renderGutter() {
  const lines = ui.editorInput.value.split(/\r?\n/);
  const activeLine = ui.editorInput.value.slice(0, ui.editorInput.selectionStart || 0).split(/\r?\n/).length;
  ui.editorGutter.replaceChildren(...lines.map((_line, index) => {
    const row = document.createElement('div');
    row.className = `gutter-line${index + 1 === activeLine ? ' is-active' : ''}`;
    row.textContent = String(index + 1);
    return row;
  }));
  ui.editorGutter.scrollTop = ui.editorInput.scrollTop;
}

function renderDiff(file) {
  const before = String(file.original).split('\n');
  const after = String(file.content).split('\n');
  const count = Math.max(before.length, after.length);
  const left = [];
  const right = [];
  for (let index = 0; index < count; index += 1) {
    const changed = before[index] !== after[index];
    left.push(`${changed ? '−' : ' '} ${String(index + 1).padStart(4)}  ${before[index] ?? ''}`);
    right.push(`${changed ? '+' : ' '} ${String(index + 1).padStart(4)}  ${after[index] ?? ''}`);
  }
  ui.diffOriginal.textContent = left.join('\n');
  ui.diffModified.textContent = right.join('\n');
}

function selectFile(filePath) {
  const file = openFiles.get(filePath);
  if (!file) return;
  activeFilePath = filePath;
  ui.editorEmpty.hidden = true;
  ui.editorSurface.hidden = false;
  ui.editorInput.value = file.content;
  ui.editorInput.readOnly = file.truncated;
  ui.filePath.textContent = file.path;
  ui.fileState.textContent = file.truncated ? 'Large file · read only' : file.dirty ? 'Unsaved changes' : `${languageFor(file.path)} · saved`;
  ui.saveFile.disabled = !file.dirty || file.truncated;
  ui.revertFile.disabled = !file.dirty;
  ui.toggleDiff.disabled = !file.dirty;
  renderTabs();
  renderGutter();
  renderDiff(file);
}

async function openFile(filePath) {
  if (openFiles.has(filePath)) return selectFile(filePath);
  const result = await api().read(filePath);
  openFiles.set(result.path, { path:result.path, original:result.content, content:result.content, sha256:result.sha256, modifiedAt:result.modifiedAt, truncated:result.truncated === true, dirty:false });
  selectFile(result.path);
}

function closeFile(filePath) {
  const file = openFiles.get(filePath);
  if (!file) return;
  if (file.dirty && !confirm(`Discard unsaved changes in ${file.path}?`)) return;
  openFiles.delete(filePath);
  if (activeFilePath === filePath) activeFilePath = [...openFiles.keys()][0] || '';
  if (activeFilePath) return selectFile(activeFilePath);
  ui.editorEmpty.hidden = false;
  ui.editorSurface.hidden = true;
  ui.editorDiff.hidden = true;
  ui.filePath.textContent = 'Choose a file';
  ui.fileState.textContent = 'Read-only';
  renderTabs();
}

async function saveCurrentFile() {
  const file = currentFile();
  if (!file || !file.dirty || file.truncated) return;
  try {
    const result = await api().write({ path:file.path, content:file.content, expectedSha256:file.sha256 });
    file.original = file.content;
    file.sha256 = result.sha256;
    file.modifiedAt = result.modifiedAt;
    file.dirty = false;
    selectFile(file.path);
    recordActivity('file_saved', file.path, 'completed');
    await Promise.allSettled([refreshGit(), refreshChanges()]);
  } catch (error) {
    ui.fileState.textContent = error.code === 'FILE_CHANGED_EXTERNALLY' ? 'Conflict · reload required' : `Save failed · ${error.message}`;
    recordActivity('file_save_failed', `${file.path} · ${error.message}`, 'failed');
  }
}

function revertCurrentFile() {
  const file = currentFile();
  if (!file || !file.dirty) return;
  file.content = file.original;
  file.dirty = false;
  selectFile(file.path);
}

async function appendDirectory(container, relativePath = '.') {
  const listing = await api().list(relativePath);
  for (const item of listing.items || []) {
    const button = document.createElement('button');
    button.className = `file ${item.type === 'directory' ? 'folder' : ''}`;
    button.dataset.path = item.path;
    button.textContent = item.type === 'directory' ? `${expandedDirectories.has(item.path) ? '▾' : '▸'} ${item.name}` : item.name;
    button.addEventListener('contextmenu', event => { event.preventDefault(); api().showContextMenu({ type:'explorer', path:item.path, kind:item.type }); });
    if (item.type === 'directory') {
      button.addEventListener('click', async () => {
        const next = button.nextElementSibling;
        const child = next?.classList.contains('tree-children') ? next : null;
        if (child) { child.remove(); expandedDirectories.delete(item.path); button.textContent = `▸ ${item.name}`; return; }
        expandedDirectories.add(item.path);
        button.textContent = `▾ ${item.name}`;
        const children = document.createElement('div');
        children.className = 'tree-children';
        button.after(children);
        await appendDirectory(children, item.path);
      });
    } else button.addEventListener('click', () => openFile(item.path));
    container.append(button);
  }
}

async function refreshFiles() { ui.files.replaceChildren(); await appendDirectory(ui.files); }

async function initTerminal() {
  terminal = new Terminal({ cursorBlink:true, convertEol:true, fontFamily:'"Cascadia Code", "Cascadia Mono", Consolas, monospace', fontSize:13, lineHeight:1.25, theme:{ background:'#181818', foreground:'#d4d4d4', cursor:'#ffffff', selectionBackground:'#264f78' } });
  fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(ui.terminalHost);
  fitAddon.fit();
  const created = await api().terminalCreate();
  terminalId = created.terminalId;
  ui.terminalShellLabel.textContent = `USER TERMINAL · ${fileName(created.shell.replaceAll('\\','/'))}`;
  terminal.onData(data => { if (terminalId) api().terminalWrite(terminalId, data); });
  terminal.onResize(({ cols, rows }) => { if (terminalId) api().terminalResize(terminalId, cols, rows); });
  ui.terminalHost.addEventListener('contextmenu', event => { event.preventDefault(); api().showContextMenu({ type:'terminal', hasSelection:terminal.hasSelection() }); });
  window.addEventListener('workbench-resized', () => requestAnimationFrame(() => { fitAddon.fit(); if (terminalId) api().terminalResize(terminalId, terminal.cols, terminal.rows); }));
}

function recordActivity(phase, detail = '', status = 'running') {
  activityEvents.push({ eventId:`ui-${Date.now()}-${Math.random()}`, timestamp:new Date().toISOString(), phase, detail, status });
  if (activityEvents.length > 300) activityEvents.shift();
  renderActivity();
}

function pushAgentEvent(raw = {}) {
  const event = { eventId:raw.eventId || `agent-${Date.now()}`, timestamp:raw.timestamp || new Date().toISOString(), phase:raw.phase || raw.type || 'activity', detail:raw.detail || raw.message || '', tool:raw.tool || raw.toolName || '', toolCallId:raw.toolCallId || '', target:raw.target || '', receiptId:raw.receiptId || '', status:raw.status || 'running', approvalId:raw.approvalId || '', operation:raw.operation || '', inputSummary:raw.inputSummary || '', outputSummary:raw.outputSummary || '', error:raw.error || '', durationMs:raw.durationMs || null };
  if (event.phase === 'session.created' && raw.sessionId && raw.sessionId !== visibleSessionId) {
    visibleSessionId = raw.sessionId;
    agentEvents.splice(0, agentEvents.length);
    activityEvents.splice(0, activityEvents.length);
    traceEvents.splice(0, traceEvents.length);
    agentTimelineExpanded = false;
    pendingApprovalId = null;
    ui.agentApproval.hidden = true;
  }
  agentEvents.push(event);
  if (agentEvents.length > 300) agentEvents.shift();
  if (String(event.phase).startsWith('execution.')) {
    traceEvents.push(raw);
    if (traceEvents.length > 500) traceEvents.shift();
    renderTrace();
  }
  if (event.phase === 'approval_requested' && event.approvalId) {
    pendingApprovalId = event.approvalId;
    ui.agentApproval.hidden = false;
    ui.approvalPrompt.textContent = `Approve ${event.operation || event.tool || 'requested action'}?`;
  }
  if (['session.completed','turn_completed','turn_failed','session.stopped'].includes(event.phase)) {
    agentRunning = false;
    ui.agentApproval.hidden = true;
    pendingApprovalId = null;
  }
  renderAgent();
  if (agentRunning || event.phase === 'session.created' || event.phase === 'agent.intent') revealAgentProgress();
}

function eventRow(event) {
  const row = document.createElement('article');
  row.className = 'agent-event';
  row.dataset.status = event.status;
  const time = document.createElement('time');
  time.textContent = new Date(event.timestamp).toLocaleTimeString();
  const body = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = String(event.phase || 'activity').replace(/[._-]+/gu, ' ');
  const detail = document.createElement('span');
  detail.textContent = [event.tool,event.target,event.detail].filter(Boolean).join(' · ');
  body.append(title,detail); row.append(time,body);
  return row;
}

function renderAgent() {
  ui.agentStatus.textContent = agentRunning ? 'Running' : 'Idle';
  ui.footerSession.textContent = agentRunning ? 'ACTIVE TURN' : 'NO ACTIVE TURN';
  if (ui.agentLiveStatus) ui.agentLiveStatus.textContent = describeAgentProgress();
  if (ui.agentElapsed) ui.agentElapsed.textContent = agentElapsedLabel();
  if (!ui.agentTimeline) return;
  const rows = agentConversationRows(agentEvents);
  ui.agentTimeline.classList.toggle('is-expanded', agentTimelineExpanded);
  if (!rows.length) {
    ui.agentTimeline.replaceChildren(Object.assign(document.createElement('div'), { className:'empty-state', textContent:'The next browser instruction starts a new local session here.' }));
  } else {
    const statusCard = updateAgentStatusCard(rows.at(-1));
    const content = [statusCard];
    if (agentTimelineExpanded && rows.length > 1) content.push(agentHistory(rows.slice(0, -1)));
    ui.agentTimeline.replaceChildren(...content);
  }
  const toggle = rendererById('agentTimelineToggle');
  if (toggle) {
    toggle.hidden = rows.length <= 1;
    toggle.setAttribute('aria-expanded', String(agentTimelineExpanded));
    toggle.textContent = agentTimelineExpanded ? 'Show current activity' : `Show history (${rows.length - 1})`;
  }
}

function describeAgentProgress() {
  const runtimeStatus = String(agentRuntimeState?.status || '').toLowerCase();
  if (runtimeStatus === 'completed') return 'Objective completed';
  if (runtimeStatus === 'waiting_for_input') return 'Waiting for the next browser instruction';
  if (runtimeStatus === 'waiting_for_dependency') return agentRuntimeState?.waiting?.reason || 'Waiting on a dependency';
  if (runtimeStatus === 'stopped' || runtimeStatus === 'cancelled') return 'Agent stopped';
  const last = agentEvents.at(-1);
  if (!last) return 'Waiting for a browser instruction';
  if (last.phase === 'approval_requested') return 'Waiting for your approval';
  if (last.status === 'failed' || /failed|blocked|error/i.test(last.phase)) return 'Agent needs attention';
  if (last.status === 'waiting_for_browser' || /input\.waiting|objective\.completed|session\.completed|turn_completed/i.test(last.phase)) return 'Waiting for the next browser instruction';
  if (last.status === 'waiting_for_approval' || last.phase === 'approval.pending') return 'Waiting for your approval';
  if (last.status === 'waiting' || last.phase === 'dependency.waiting') return last.detail || 'Waiting on a dependency';
  if (last.phase === 'agent.intent' && last.detail) return last.detail;
  if (last.tool) return `${last.status === 'completed' ? 'Completed' : 'Running'} ${last.tool}`;
  if (/step\.started|provider\.connecting|session\.running/i.test(last.phase)) return 'Preparing the next action';
  return agentRunning ? 'Working locally' : 'Waiting for the next browser instruction';
}

function agentElapsedLabel() {
  const first = agentEvents.find(event => event.phase === 'session.created' || event.phase === 'step.started');
  if (!agentRunning || !first?.timestamp) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(first.timestamp).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s · Stop` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s · Stop`;
}

function agentConversationRows(events) {
  const rows = [];
  const toolRows = new Map();
  for (const event of events) {
    if (event.phase === 'agent.intent') { rows.push({ kind:'intent', id:event.eventId, status:'running', title:'Agent intent', detail:event.detail, timestamp:event.timestamp }); continue; }
    if (event.phase === 'execution.tool.started') {
      const row = { kind:'tool', id:event.toolCallId || event.eventId, status:'running', title:event.tool || 'Tool', detail:'Running…', timestamp:event.timestamp, inputSummary:event.inputSummary, receiptId:event.receiptId };
      rows.push(row); toolRows.set(row.id, row); continue;
    }
    if (event.phase === 'execution.tool.approval_requested') {
      const row = toolRows.get(event.toolCallId);
      if (row) { row.status='waiting_for_approval'; row.detail='Waiting for your approval'; }
      else rows.push({ kind:'tool', id:event.toolCallId || event.eventId, status:'waiting_for_approval', title:event.tool || 'Tool', detail:'Waiting for your approval', timestamp:event.timestamp });
      continue;
    }
    if (['execution.tool.completed','execution.tool.failed'].includes(event.phase)) {
      const row = toolRows.get(event.toolCallId);
      const status = event.status === 'completed' ? 'completed' : 'failed';
      if (row) Object.assign(row, { status, detail:eventDetailText(event.error) || (status === 'completed' ? 'Completed' : 'Failed'), outputSummary:event.outputSummary, receiptId:event.receiptId || row.receiptId, durationMs:event.durationMs || null });
      else rows.push({ kind:'tool', id:event.toolCallId || event.eventId, status, title:event.tool || 'Tool', detail:eventDetailText(event.error) || (status === 'completed' ? 'Completed' : 'Failed'), timestamp:event.timestamp, outputSummary:event.outputSummary, receiptId:event.receiptId });
      continue;
    }
    if (event.phase === 'objective.completed') { rows.push({ kind:'final', id:event.eventId, status:'completed', title:'Result', detail:event.detail || 'Objective completed', timestamp:event.timestamp }); continue; }
    if (event.phase === 'input.waiting') { rows.push({ kind:'state', id:event.eventId, status:'waiting', title:'Ready for the next instruction', detail:event.detail || 'Waiting for the next browser instruction', timestamp:event.timestamp }); continue; }
    if (event.phase === 'dependency.waiting') { rows.push({ kind:'state', id:event.eventId, status:'waiting', title:'Waiting on a dependency', detail:event.detail || 'Dependency needs attention', timestamp:event.timestamp }); continue; }
    if (event.phase === 'approval.pending') { rows.push({ kind:'state', id:event.eventId, status:'waiting_for_approval', title:'Approval needed', detail:event.detail || 'Waiting for your approval', timestamp:event.timestamp }); continue; }
    if (event.phase === 'step.failed') { rows.push({ kind:'state', id:event.eventId, status:'failed', title:'Step failed', detail:eventDetailText(event.error) || event.detail || 'Agent needs attention', timestamp:event.timestamp }); continue; }
    if (['session.stopped','session.cancelled'].includes(event.phase)) rows.push({ kind:'state', id:event.eventId, status:event.status, title:'Agent stopped', detail:event.detail || 'Stopped by user', timestamp:event.timestamp });
  }
  return rows;
}

function eventDetailText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function agentTimelineRow(event) {
  const row = document.createElement('article');
  row.className = `turn-step ${event.status || 'running'}`;
  const summary = document.createElement('div');
  summary.className = 'turn-step-summary';
  const icon = document.createElement('span');
  icon.className = 'turn-step-icon';
  icon.textContent = event.status === 'failed' ? '!' : event.status === 'completed' ? '✓' : event.status === 'waiting_for_approval' ? '?' : event.kind === 'intent' ? '·' : '›';
  const body = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = event.title || event.tool || String(event.phase || 'activity').replace(/[._-]+/gu, ' ');
  const detail = document.createElement('span');
  detail.textContent = [event.target, event.detail, eventDetailText(event.error), event.durationMs ? `${event.durationMs}ms` : ''].filter(Boolean).join(' · ') || (event.status === 'running' ? 'In progress…' : 'Completed');
  body.append(title, detail); summary.append(icon, body); row.append(summary);
  const extra = [event.inputSummary && `Input\n${eventDetailText(event.inputSummary)}`, event.outputSummary && `Result\n${eventDetailText(event.outputSummary)}`, event.receiptId && `Receipt\n${event.receiptId}`].filter(Boolean).join('\n\n');
  if (extra) { const disclosure = document.createElement('details'); const toggle = document.createElement('summary'); toggle.textContent = 'Show details'; const pre = document.createElement('pre'); pre.textContent = extra; disclosure.append(toggle, pre); row.append(disclosure); }
  return row;
}

function updateAgentStatusCard(event) {
  let card = rendererById('agentStatusCard');
  if (!card) {
    card = document.createElement('article');
    card.id = 'agentStatusCard';
  }
  const rendered = agentTimelineRow(event);
  card.className = rendered.className;
  card.replaceChildren(...rendered.childNodes);
  return card;
}

function agentHistory(rows) {
  const history = document.createElement('div');
  history.id = 'agentHistory';
  history.className = 'agent-history';
  for (const event of [...rows].reverse()) {
    const item = document.createElement('div');
    item.className = `agent-history-item ${event.status || 'running'}`;
    const time = document.createElement('time');
    time.textContent = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '—';
    const detail = document.createElement('span');
    detail.textContent = [event.title || event.tool || 'Activity', event.detail].filter(Boolean).join(' · ');
    item.append(time, detail);
    history.append(item);
  }
  return history;
}

function revealAgentProgress() {
  requestAnimationFrame(() => {
    const module = ui.agentTimeline?.closest('.module-live-agent');
    module?.scrollTo({ top: module.scrollHeight, behavior: 'smooth' });
    ui.agentTimeline?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function browserInstructionPrompt() {
  const workspace = String(ui.workspace?.textContent || '').trim() || 'the selected workspace path';
  return [
    'You are the browser-side planner for a local Access Agent relay.',
    'Understand the task I give you, then respond with exactly one bounded instruction envelope and no code, logs, or explanation outside it.',
    'Use a unique INSTRUCTION ID. Keep OBJECTIVE concise. For repository changes, refer to a commit, branch, or SHA instead of pasting files.',
    '',
    '=== ACCESS AGENT INSTRUCTION START ===',
    'VERSION: 1',
    'INSTRUCTION ID: task-001',
    `WORKSPACE: ${workspace}`,
    'OBJECTIVE:',
    'Describe one bounded task for the local agent. It will inspect, request approval for governed commands, and return a compact result with a SHA-256 record.',
    '=== ACCESS AGENT INSTRUCTION END ===',
  ].join('\n');
}

function renderBrowserInstructionTemplate() {
  if (ui.browserInstructionTemplate) ui.browserInstructionTemplate.textContent = browserInstructionPrompt();
}

function setControlBusy(control, busy) { if (control) control.disabled = busy === true; }
function showBrowserRelayStatus(text, state = 'idle') { runtimeViewState = window.RuntimeViewState.withRelayFeedback(runtimeViewState, state, text); renderBrowserWorkflowState(); }
let providerTabs = [];
let persistedBrowserTarget = null;
function describeProviderTab(tab) { return tab ? `[${tab.provider || tab.providerId || 'Unsupported page'}] ${tab.title || '(untitled)'} — ${tab.url || 'no URL'}` : 'Not selected'; }
function showWatchedProviderTab(tab, state = 'selected') { if (!ui.watchedProviderTab) return; ui.watchedProviderTab.textContent = describeProviderTab(tab); ui.watchedProviderTab.dataset.state = state; }
function showBrowserSessionStatus(text, state = 'ready') { runtimeViewState = window.RuntimeViewState.withBrowserSession(runtimeViewState, state, text); renderBrowserWorkflowState(); }
function renderBrowserWorkflowState() {
  const session = runtimeViewState.browserSession;
  const relay = runtimeViewState.relay;
  const relayFeedback = runtimeViewState.relayFeedback;
  if (ui.browserSessionStatus) { ui.browserSessionStatus.hidden = !session.message; ui.browserSessionStatus.dataset.state = session.status; ui.browserSessionStatus.textContent = session.message; }
  if (ui.browserRelayStatus) { ui.browserRelayStatus.hidden = !relayFeedback.message; ui.browserRelayStatus.dataset.state = relayFeedback.status; ui.browserRelayStatus.textContent = relayFeedback.message; }
  if (ui.startBrowserRelay) ui.startBrowserRelay.disabled = ['connecting', 'ready', 'running'].includes(relay.status);
  const workflow = rendererById('browserWorkflow');
  if (!workflow) return;
  const tabSelected = providerTabs.some(item => item.targetId === ui.browserProviderTab?.value);
  const agentStatus = runtimeViewState.agent.status;
  const states = {
    browser: session.status === 'ready' ? 'completed' : session.status === 'working' ? 'current' : 'pending',
    provider: session.status === 'ready' ? 'completed' : 'pending',
    tab: tabSelected ? 'completed' : 'pending',
    relay: relay.status === 'running' || relay.status === 'ready' ? 'completed' : relay.status === 'working' ? 'current' : 'pending',
    instruction: relay.status === 'running' || relay.status === 'ready' ? 'current' : 'pending',
    execution: runtimeViewState.agent.running ? 'current' : agentStatus === 'completed' ? 'completed' : 'pending',
    result: agentStatus === 'completed' ? 'completed' : 'pending',
  };
  for (const item of workflow.querySelectorAll('[data-step]')) item.dataset.state = states[item.dataset.step] || 'pending';
  window.dispatchEvent(new CustomEvent('access-runtime-view-state', { detail: runtimeViewState }));
}
async function openManagedProvider() {
  setControlBusy(ui.openManagedProvider, true); showBrowserSessionStatus('Opening Managed Chrome…', 'working');
  try { const result = await api().browserOpen(); runtimeViewState = window.RuntimeViewState.fromSnapshot(runtimeViewState, { browser:result.browser, browserRelay:result.relay, agent:{} }); showBrowserSessionStatus('Managed Chrome is ready. Navigate to any chat site, then detect its tab.', 'ready'); showBrowserRelayStatus('Detect tabs to select a relay-compatible chat site.', 'working'); }
  catch (error) { showBrowserSessionStatus(error?.message || 'Could not open Managed Chrome.', 'error'); }
  finally { setControlBusy(ui.openManagedProvider, false); }
}
async function findBrowserProviderTabs() {
  setControlBusy(ui.refreshBrowserProviderTabs, true); showBrowserRelayStatus('Checking Managed Chrome and detecting browser tabs…', 'working');
  try {
    providerTabs = await api().browserProviderTabs();
    ui.browserProviderTab.replaceChildren(new Option(providerTabs.length ? 'Choose detected browser tab' : 'No browser tabs found', ''));
    providerTabs.forEach(tab => ui.browserProviderTab.add(new Option(`[${tab.provider || 'Unsupported page'}] ${tab.title || '(untitled)'} — ${tab.url}`, tab.targetId)));
    const runtime = await api().status();
    const relayTarget = runtime?.browserRelay?.target;
    const remembered = providerTabs.find(tab => tab.targetId === relayTarget?.targetId)
      || providerTabs.find(tab => tab.targetId === persistedBrowserTarget?.targetId)
      || providerTabs.find(tab => tab.url && tab.url === persistedBrowserTarget?.url);
    if (remembered) { ui.browserProviderTab.value = remembered.targetId; showWatchedProviderTab(remembered, runtime.browserRelay.running ? 'watching' : 'selected'); }
    else showWatchedProviderTab(null);
    runtimeViewState = window.RuntimeViewState.withBrowserTargets(runtimeViewState, providerTabs, remembered || null);
    runtimeViewState = window.RuntimeViewState.fromSnapshot(runtimeViewState, runtime || {});
    showBrowserRelayStatus(providerTabs.length ? remembered ? `Selected ${describeProviderTab(remembered)}.` : `${providerTabs.length} browser tab${providerTabs.length === 1 ? '' : 's'} detected. Start Relay to use the only page, or choose one once to remember it.` : 'No browser tabs are available in Managed Chrome.', providerTabs.length ? 'ready' : 'error');
  } catch (error) { showBrowserRelayStatus(error?.message || 'Could not detect browser tabs.', 'error'); }
  finally { setControlBusy(ui.refreshBrowserProviderTabs, false); }
}
async function startBrowserRelay() {
  setControlBusy(ui.startBrowserRelay, true); showBrowserRelayStatus('Opening browser, checking tabs, and starting relay…', 'working');
  try {
    await api().browserOpen();
    await findBrowserProviderTabs();
    const selectedId = ui.browserProviderTab?.value || '';
    const tab = providerTabs.find(item => item.targetId === selectedId && item.providerId)
      || providerTabs.find(item => item.targetId === persistedBrowserTarget?.targetId && item.providerId)
      || providerTabs.find(item => item.url && item.url === persistedBrowserTarget?.url && item.providerId)
      || (providerTabs.filter(item => item.providerId).length === 1 ? providerTabs.find(item => item.providerId) : null);
    if (!tab) throw new Error('Open a chat page in Managed Chrome, then choose it once. The relay will remember that page for future starts.');
    await api().browserRelaySelect(tab); const result = await api().browserRelayStart(); const relay = result.relay || result; const running = relay.running === true; runtimeViewState = { ...runtimeViewState, relay: { status:String(relay.lifecycle || (running ? 'ready' : 'degraded')), message:String(relay.error || result.error || '') } }; showWatchedProviderTab(tab, running ? 'watching' : 'selected'); showBrowserRelayStatus(running ? `Relay watching ${describeProviderTab(tab)}.` : (relay.error || result.error || 'Relay did not start.'), running ? 'ready' : 'error');
  } catch (error) { showBrowserRelayStatus(error?.message || 'Could not start browser relay.', 'error'); }
  finally { setControlBusy(ui.startBrowserRelay, false); }
}
async function stopBrowserRelay() {
  setControlBusy(ui.stopBrowserRelay, true); showBrowserRelayStatus('Stopping relay…', 'working');
  try { const result = await api().browserRelayStop(); const relay = result.relay || result; const running = relay.running === true; runtimeViewState = { ...runtimeViewState, relay: { status:String(relay.lifecycle || (running ? 'stopping' : 'stopped')), message:String(relay.error || result.error || '') } }; if (relay.target) showWatchedProviderTab(relay.target, 'selected'); showBrowserRelayStatus(running ? 'Relay is still stopping.' : relay.alreadyStopped ? 'Relay is already stopped.' : 'Relay stopped.'); }
  catch (error) { showBrowserRelayStatus(error?.message || 'Could not stop browser relay.', 'error'); }
  finally { setControlBusy(ui.stopBrowserRelay, false); }
}

function applyAgentState(state) {
  if (!state) return;
  agentRuntimeState = state;
  const status = String(state.status || state.phase || 'idle');
  const running = state.running === true || ['running', 'retrying'].includes(status);
  runtimeViewState = { ...runtimeViewState, runtime: { status: running ? 'running' : status, active: runtimeViewState.runtime.active === true }, agent: { status, running, waiting: state.waiting || null } };
  agentRunning = runtimeViewState.agent.running;
  if (state.turnId) activeTurnId = state.turnId;
  renderAgent();
}

function renderActivity() { ui.activityFeed.replaceChildren(...(activityEvents.length ? [...activityEvents].reverse().map(eventRow) : [Object.assign(document.createElement('div'), { className:'empty-state', textContent:'No runtime activity.' })])); }

async function refreshTrace() {
  const result = await api().agentExecutionTrace();
  traceEvents.splice(0, traceEvents.length, ...(Array.isArray(result?.events) ? result.events : []));
  renderTrace();
}

function renderTrace() {
  const status = String(ui.traceStatusFilter?.value || '');
  const tool = String(ui.traceToolFilter?.value || '').toLowerCase();
  const moduleName = String(ui.traceModuleFilter?.value || '').toLowerCase();
  const turn = String(ui.traceTurnFilter?.value || '').toLowerCase();
  const filtered = traceEvents.filter(event => (!status || String(event.status) === status) && (!tool || String(event.toolCallId || event.tool || '').toLowerCase().includes(tool)) && (!moduleName || String(event.moduleId || '').toLowerCase().includes(moduleName)) && (!turn || String(event.turnId || '').toLowerCase().includes(turn)));
  ui.traceList.textContent = filtered.length
    ? filtered.map(event => {
      const header = `${event.timestamp || ''} ${event.status || ''} ${event.toolCallId || event.tool || ''} ${event.moduleId || ''}`.trim();
      const blockers = Array.isArray(event.blockerIds) && event.blockerIds.length ? `Blockers: ${event.blockerIds.join(', ')}` : '';
      const error = event.error ? `Error: ${eventDetailText(event.error)}` : '';
      const receipt = event.receiptId ? `Receipt: ${event.receiptId}` : '';
      return [header, blockers, error, receipt].filter(Boolean).join('\n');
    }).join('\n\n')
    : 'No trace events match.';
}

async function refreshGit() {
  const status = await api().gitStatus();
  ui.gitBranch.textContent = status.available ? `Branch: ${status.branch || 'detached'}` : status.reason || 'Git unavailable';
  ui.gitCounts.textContent = `${status.changes?.length || 0} changes`;
  const query = ui.gitFilter.value.trim().toLowerCase();
  const changes = (status.changes || []).filter(change => !query || change.path.toLowerCase().includes(query));
  ui.gitChanges.replaceChildren(...changes.map(change => {
    const button = document.createElement('button'); button.className='git-file'; button.textContent=`${change.status}  ${change.path}`;
    button.addEventListener('click', async () => { selectedGitPath=change.path; const result=await api().gitDiff(change.path); ui.gitDiff.textContent=result.diff || 'No diff.'; });
    return button;
  }));
}

async function refreshChanges() { const status=await api().gitStatus(); ui.changesList.textContent=status.changes?.length ? status.changes.map(change => `${change.status} ${change.path}`).join('\n') : 'No workspace mutations reported.'; }

async function refreshEvidence() {
  const [result, trace] = await Promise.all([api().agentReceipts(), api().agentExecutionTrace()]);
  const filter = String(ui.evidenceFilter?.value || '').toLowerCase();
  const receipts = (Array.isArray(result?.receipts) ? result.receipts : []).filter(receipt => !filter || JSON.stringify(receipt).toLowerCase().includes(filter));
  const verified = (Array.isArray(trace?.events) ? trace.events : [])
    .filter(event => event.type === 'execution.tool.completed' && event.status === 'completed')
    .filter(event => !filter || JSON.stringify(event).toLowerCase().includes(filter));
  const verifiedText = verified.map(event => [
    'VERIFIED EXECUTION',
    `${event.toolName || 'tool'} · ${event.phase || 'completed'}`,
    event.outputSummary ? JSON.stringify(event.outputSummary) : '',
    event.receiptId ? `Receipt: ${event.receiptId}` : '',
    event.timestamp || '',
  ].filter(Boolean).join('\n'));
  const receiptText = receipts.map(receipt => ['SESSION RECEIPT', receipt.kind, receipt.detail, receipt.timestamp, receipt.receiptId].filter(Boolean).join('\n'));
  ui.evidenceList.textContent = [...verifiedText, ...receiptText].join('\n\n') || 'No verified execution evidence or session receipts match.';
}

async function inspectSkill(name) { const skill = await api().skillRead(name); if (ui.skillDetails) ui.skillDetails.textContent = skill ? `${skill.name}\n\n${skill.description}\n\n${skill.content}` : 'The selected skill is no longer available.'; }
async function refreshSkills() { const list=await api().skills(); if (!ui.skillsList) return; ui.skillsList.replaceChildren(...(list?.length ? list.map(skill => { const button=document.createElement('button'); button.className='skill-card'; button.type='button'; button.textContent=`${skill.name}\n${skill.description}`; button.addEventListener('click',() => inspectSkill(skill.name).catch(error => { if (ui.skillDetails) ui.skillDetails.textContent=error.message || 'Could not inspect skill.'; })); return button; }) : [Object.assign(document.createElement('div'), { className:'panel-box', textContent:'No skills available.' })])); }

async function refreshRuntime() {
  const result=await api().status();
  runtimeViewState = window.RuntimeViewState.fromSnapshot(runtimeViewState, result);
  agentRunning = runtimeViewState.agent.running;
  runtimeStarted = runtimeViewState.runtime.active === true;
  ui.workspace.textContent=result.workspaceRoot;
  ui.status.textContent=`Runtime ${runtimeViewState.runtime.status}`; ui.status.dataset.state=runtimeViewState.runtime.status === 'running' ? 'ready' : runtimeViewState.runtime.status;
  const rows=[['Workspace',result.workspaceRoot],['Bridge',result.bridgeUrl],['Authority',result.runtime?.authority || result.runtime?.mode || 'Unknown'],['Capabilities',String(result.capabilities?.length || 0)]];
  ui.runtimeSummary?.replaceChildren(...rows.map(([label,value]) => { const row=document.createElement('div'); const key=document.createElement('span'); const text=document.createElement('strong'); key.textContent=label; text.textContent=value; row.append(key,text); return row; }));
  if (ui.homeWorkspace) ui.homeWorkspace.textContent=runtimeViewState.workspace.status === 'connected' ? 'Workspace selected' : 'Choose a workspace';
  if (ui.homeProvider) ui.homeProvider.textContent=runtimeViewState.provider.status === 'ready' ? 'Provider configured' : runtimeViewState.provider.status === 'unconfigured' ? 'Provider needs setup' : 'Provider unavailable';
  if (ui.homeRuntime) ui.homeRuntime.textContent=runtimeViewState.agent.running ? 'Task is running' : runtimeViewState.runtime.status === 'degraded' ? 'Runtime needs attention' : `Runtime ${runtimeViewState.runtime.status}`;
  if (ui.homeBrowser) ui.homeBrowser.textContent=result.browser?.running ? 'Managed Chrome running' : result.browser?.profilePath ? 'Browser ready to launch' : 'Browser setup needed';
  renderBrowserInstructionTemplate();
  renderAgent();
  renderBrowserWorkflowState();
}

async function loadPreferences() {
  const preferences=await api().preferences();
  ui.baseUrl.value=preferences.lmStudioBaseUrl || '';
  ui.mcpServerCommand.value=preferences.mcpServerCommand || '';
  ui.browserProfilePath.value=preferences.browserProfilePath || ''; ui.browserExecutable.value=preferences.browserExecutable || '';
  if (ui.workspaceSyncTarget) ui.workspaceSyncTarget.value=preferences.workspaceSyncTarget || '';
  if (ui.workspaceSyncExclusions) ui.workspaceSyncExclusions.value=(preferences.workspaceSyncExclusions || []).join('\n');
  persistedBrowserTarget = preferences.browserProviderTarget || null;
  providerIdentity=preferences.lmStudioModel || (preferences.lmStudioBaseUrl ? 'LM Studio' : 'PROVIDER UNKNOWN');
  ui.footerProvider.textContent=providerIdentity;
  if (preferences.lmStudioModel) ui.model.append(new Option(preferences.lmStudioModel,preferences.lmStudioModel,true,true));
  api().mcpStatus().then(status => { ui.toggleMcp.textContent=status.connected ? 'MCP ON' : status.enabled ? 'MCP …' : 'MCP OFF'; ui.toggleMcp.setAttribute('aria-pressed',String(Boolean(status.connected || status.enabled))); }).catch(() => {});
}

function wireContextMenuActions() {
  api().onContextMenuAction(async ({ action, context }) => {
    if (action === 'copy') document.execCommand('copy');
    else if (action === 'paste' && terminalId) api().terminalWrite(terminalId, await navigator.clipboard.readText());
    else if (action === 'paste-editor' && currentFile()) document.execCommand('paste');
    else if (action === 'select-all') { if (context.type === 'terminal') terminal.selectAll(); else ui.editorInput.select(); }
    else if (action === 'clear-terminal') terminal.clear();
    else if (action === 'copy-path') navigator.clipboard.writeText(context.path || '');
    else if (action === 'reveal-file') api().revealPath(context.path);
    else if (action === 'open-file') openFile(context.path);
    else if (action === 'save-file') saveCurrentFile();
    else if (action === 'revert-file') revertCurrentFile();
    else if (action === 'open-diff') { selectedGitPath=context.path; const result=await api().gitDiff(context.path); ui.gitDiff.textContent=result.diff || 'No diff.'; }
    else if (action === 'refresh') { if (context.type === 'git') refreshGit(); else refreshFiles(); }
  });
}

function renderWorkspaceSync(status = {}) {
  if (!ui.workspaceSyncStatus) return;
  if (status.running) ui.workspaceSyncStatus.textContent = `Watching\nSource: ${status.sourceRoot}\nDestination: ${status.targetRoot}\n${status.lastEvent || 'Waiting for changes.'}`;
  else if (status.error) ui.workspaceSyncStatus.textContent = `Sync stopped: ${status.error}`;
  else ui.workspaceSyncStatus.textContent = 'Sync is stopped.';
  if (ui.workspaceSyncStart) ui.workspaceSyncStart.disabled = status.running === true;
  if (ui.workspaceSyncStop) ui.workspaceSyncStop.disabled = status.running !== true;
}
async function refreshWorkspaceSync() { try { renderWorkspaceSync(await api().workspaceSyncStatus()); } catch (error) { if (ui.workspaceSyncStatus) ui.workspaceSyncStatus.textContent = error.message || 'Could not read sync status.'; } }
function syncExclusions() { return String(ui.workspaceSyncExclusions?.value || '').split(/\r?\n/u).map(value => value.trim()).filter(Boolean); }
async function chooseWorkspaceSyncTarget() { const result = await api().selectSyncTarget(ui.workspaceSyncTarget?.value || ''); if (!result?.canceled && ui.workspaceSyncTarget) ui.workspaceSyncTarget.value = result.path || ''; }
async function startWorkspaceSync() { setControlBusy(ui.workspaceSyncStart, true); try { renderWorkspaceSync(await api().workspaceSyncStart({ targetRoot: ui.workspaceSyncTarget?.value || '', exclusions: syncExclusions() })); } catch (error) { if (ui.workspaceSyncStatus) ui.workspaceSyncStatus.textContent = error.message || 'Could not start sync.'; } finally { setControlBusy(ui.workspaceSyncStart, false); } }
async function stopWorkspaceSync() { setControlBusy(ui.workspaceSyncStop, true); try { renderWorkspaceSync(await api().workspaceSyncStop()); } catch (error) { if (ui.workspaceSyncStatus) ui.workspaceSyncStatus.textContent = error.message || 'Could not stop sync.'; } finally { setControlBusy(ui.workspaceSyncStop, false); } }

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderWorkspaceInspection(result, workspaceRoot = '') {
  const rows = [
    ['Path', workspaceRoot || result.path || '.'],
    ['Files', String(result.files || 0)],
    ['Directories', String(result.directories || 0)],
    ['Size', formatBytes(result.bytes)],
  ];
  ui.workspaceToolsSummary?.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement('div');
    const key = document.createElement('span');
    const text = document.createElement('strong');
    key.textContent = label;
    text.textContent = value;
    row.append(key, text);
    return row;
  }));
  if (ui.workspaceToolsExtensions) {
    const extensions = Array.isArray(result.extensions) ? result.extensions : [];
    ui.workspaceToolsExtensions.textContent = extensions.length
      ? extensions.map(item => `${item.extension}: ${item.count}`).join('\n')
      : 'No file extensions found.';
  }
}

async function refreshWorkspaceTools() {
  setControlBusy(ui.workspaceToolsRefresh, true);
  if (ui.workspaceToolsStatus) ui.workspaceToolsStatus.textContent = 'Inspecting workspace structure…';
  try {
    const [result, runtime] = await Promise.all([api().inspectWorkspace('.'), api().status()]);
    if (!result?.ok) throw new Error(result?.error || 'Workspace inspection failed.');
    renderWorkspaceInspection(result, runtime?.workspaceRoot || '');
    await refreshFiles();
    if (ui.workspaceToolsStatus) ui.workspaceToolsStatus.textContent = result.limited ? 'Workspace inspection completed at its configured limit.' : 'Workspace structure refreshed.';
  } catch (error) {
    if (ui.workspaceToolsStatus) ui.workspaceToolsStatus.textContent = error.message || 'Workspace inspection failed.';
  } finally {
    setControlBusy(ui.workspaceToolsRefresh, false);
  }
}

async function runProjectAudit() {
  setControlBusy(ui.projectAuditRun, true);
  if (ui.projectAuditStatus) ui.projectAuditStatus.textContent = 'Running read-only workspace and Git audit…';
  try {
    const [inspection, git, runtime] = await Promise.all([api().inspectWorkspace('.'), api().gitStatus(), api().status()]);
    if (!inspection?.ok) throw new Error(inspection?.error || 'Workspace inspection failed.');
    const gitState = git?.available
      ? `${git.branch || 'detached'} · ${git.changes?.length || 0} change(s)`
      : (git?.reason || 'Git state unavailable.');
    if (ui.projectAuditOutput) {
      ui.projectAuditOutput.textContent = [
        'READ-ONLY PROJECT AUDIT',
        `Workspace: ${runtime?.workspaceRoot || inspection.path || '.'}`,
        `Structure: ${inspection.files || 0} files, ${inspection.directories || 0} directories, ${formatBytes(inspection.bytes)}`,
        `Git: ${gitState}`,
        inspection.limited ? 'Scope: bounded by the configured inspection limit.' : 'Scope: complete within the configured inspection limit.',
      ].join('\n');
    }
    if (ui.projectAuditStatus) ui.projectAuditStatus.textContent = 'Read-only audit completed. No files were changed.';
  } catch (error) {
    if (ui.projectAuditStatus) ui.projectAuditStatus.textContent = error.message || 'Project audit failed.';
  } finally {
    setControlBusy(ui.projectAuditRun, false);
  }
}

function bindInteractions() {
  const chooseWorkspace = async () => { const result=await api().selectWorkspace(); if (result.canceled) return; openFiles.clear(); activeFilePath=''; renderTabs(); await Promise.allSettled([refreshRuntime(),refreshFiles(),refreshGit(),refreshChanges(),refreshWorkspaceTools(),runProjectAudit()]); const created=await api().terminalRestart(terminalId); terminal.clear(); terminalId=created.terminalId; };
  ui.homeStartTask?.addEventListener('click',() => shellManager.select('agent'));
  ui.homeOpenWorkspace?.addEventListener('click',chooseWorkspace); ui.homeChangeWorkspace?.addEventListener('click',chooseWorkspace);
  ui.homeConfigureProvider?.addEventListener('click',() => shellManager.select('settings')); ui.homeConfigureBrowser?.addEventListener('click',() => shellManager.select('agent')); ui.homeRefreshStatus?.addEventListener('click',refreshRuntime); ui.homeGoLibrary?.addEventListener('click',() => shellManager.select('skills')); ui.homeGoActivity?.addEventListener('click',() => shellManager.select('activity'));
  ui.chooseWorkspace.addEventListener('click',chooseWorkspace);
  ui.workspaceSyncRefresh?.addEventListener('click',refreshWorkspaceSync);
  ui.chooseWorkspaceSyncTarget?.addEventListener('click',chooseWorkspaceSyncTarget);
  ui.workspaceSyncStart?.addEventListener('click',startWorkspaceSync);
  ui.workspaceSyncStop?.addEventListener('click',stopWorkspaceSync);
  ui.projectAuditRun?.addEventListener('click',runProjectAudit);
  ui.refreshFiles.addEventListener('click',refreshFiles);
  ui.search.addEventListener('change',async () => { const query=ui.search.value.trim(); if (!query) return refreshFiles(); const result=await api().search(query,'.'); ui.files.replaceChildren(...(result.matches || []).map(match => { const button=document.createElement('button'); button.className='file'; button.textContent=`${match.path}: ${match.preview.replace(/\s+/g,' ')}`; button.addEventListener('click',() => openFile(match.path)); return button; })); });
  ui.editorInput.addEventListener('input',() => { const file=currentFile(); if (!file || file.truncated) return; file.content=ui.editorInput.value; file.dirty=file.content !== file.original; selectFile(file.path); });
  ui.editorInput.addEventListener('scroll',renderGutter); ui.editorInput.addEventListener('click',renderGutter); ui.editorInput.addEventListener('keyup',renderGutter);
  ui.saveFile.addEventListener('click',saveCurrentFile); ui.revertFile.addEventListener('click',revertCurrentFile); ui.toggleDiff.addEventListener('click',() => { ui.editorDiff.hidden=!ui.editorDiff.hidden; });
  window.addEventListener('keydown',event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveCurrentFile(); } });
  ui.restartTerminal.addEventListener('click',async () => { const created=await api().terminalRestart(terminalId); terminal.clear(); terminalId=created.terminalId; fitAddon.fit(); });
  ui.killTerminal.addEventListener('click',async () => { if (terminalId) await api().terminalKill(terminalId); terminalId=null; terminal.writeln('\r\n[terminal stopped]'); });
    ui.copyBrowserInstructionTemplate?.addEventListener('click',async () => { try { await navigator.clipboard.writeText(browserInstructionPrompt()); if (ui.browserInstructionCopyStatus) ui.browserInstructionCopyStatus.textContent='Provider prompt copied. Paste it into the selected browser chat, then give the provider the task.'; } catch (error) { if (ui.browserInstructionCopyStatus) ui.browserInstructionCopyStatus.textContent=`Could not copy prompt: ${error.message || error}`; } });
  ui.openBrowserSetup?.addEventListener('click',() => shellManager.select('settings'));
  ui.openManagedProvider?.addEventListener('click',openManagedProvider);
  ui.browserProviderTab?.addEventListener('change',() => { const tab = providerTabs.find(item => item.targetId === (ui.browserProviderTab?.value || '')); runtimeViewState = window.RuntimeViewState.withBrowserTargets(runtimeViewState, providerTabs, tab || null); showWatchedProviderTab(tab); if (tab) showBrowserRelayStatus(tab.providerId ? `Selected ${describeProviderTab(tab)}. Start relay when ready.` : `${describeProviderTab(tab)} is not an HTTP or HTTPS page.`, tab.providerId ? 'working' : 'error'); else renderBrowserWorkflowState(); });
  ui.refreshBrowserProviderTabs?.addEventListener('click',findBrowserProviderTabs); ui.startBrowserRelay?.addEventListener('click',startBrowserRelay); ui.stopBrowserRelay?.addEventListener('click',stopBrowserRelay);
  ui.approveAction?.addEventListener('click',() => { if (pendingApprovalId) api().agentApprove(pendingApprovalId); }); ui.rejectAction?.addEventListener('click',() => { if (pendingApprovalId) api().agentReject(pendingApprovalId); });
  ui.toggleMcp.addEventListener('click',async () => { const status=await api().mcpStatus().catch(() => ({enabled:false})); const result=await api().setMcpEnabled(!status.enabled).catch(() => ({enabled:!status.enabled,connected:false})); ui.toggleMcp.textContent=result.connected ? 'MCP ON' : result.enabled ? 'MCP …' : 'MCP OFF'; });
  ui.refreshGit.addEventListener('click',refreshGit); ui.gitFilter.addEventListener('input',refreshGit); ui.refreshChanges.addEventListener('click',refreshChanges); ui.refreshEvidence.addEventListener('click',refreshEvidence); ui.evidenceFilter.addEventListener('input',refreshEvidence); ui.refreshTrace.addEventListener('click',refreshTrace); [ui.traceStatusFilter,ui.traceToolFilter,ui.traceModuleFilter,ui.traceTurnFilter].forEach(input => input.addEventListener('input',renderTrace)); ui.refreshSkills.addEventListener('click',refreshSkills); ui.openSkillsFolder?.addEventListener('click',() => api().openSkillsFolder().catch(error => { if (ui.skillDetails) ui.skillDetails.textContent=error.message || 'Could not open skills folder.'; }));
}

(async () => {
  try {
    const layout=await api().workbenchLayout();
    shellManager=new window.ShellModuleManager({ workbench:rendererById('workbench'), rail:document.querySelector('.activity-bar'), modules:layout.modules, renderContent:module => module.content === 'settings' && window.SettingsModule ? window.SettingsModule.template() : modules[module.content]() });
    shellManager.mount(); bindUi(); bindInteractions();
    if (window.TaskStatePanel) {
      const ide = window.accessIde;
      const taskStateIpc = {
        invoke(channel) {
          const args = Array.prototype.slice.call(arguments, 1);
          if (channel === 'task-state:snapshot') return ide.taskStateSnapshot();
          if (channel === 'task-state:set-goal') return ide.taskStateSetGoal(args[0]);
          if (channel === 'task-state:add-level') return ide.taskStateAddLevel(args[0]);
          if (channel === 'task-state:reset') return ide.taskStateReset();
          return Promise.resolve(null);
        },
        on(channel, listener) {
          if (channel === 'task-state:update') return ide.onTaskStateUpdate(listener);
          if (channel === 'task-state:blocked') return ide.onTaskStateBlocked(listener);
          if (channel === 'task-state:decision') return ide.onTaskStateDecision(listener);
          if (channel === 'task-state:complete') return ide.onTaskStateComplete(listener);
          if (channel === 'task-state:level-complete') return ide.onTaskStateLevelComplete(listener);
          if (channel === 'task-state:unknown') return ide.onTaskStateUnknown(listener);
        }
      };
      window.TaskStatePanel.mount('.module-task-state', { ipc: taskStateIpc });
    }
    if (window.SettingsModule?.bind) window.SettingsModule.bind({ api:window.accessIde, ui });
    wireContextMenuActions();
    api().onTerminalData(payload => { if (payload.terminalId === terminalId) terminal.write(payload.data); });
    api().onTerminalExit(payload => { if (payload.terminalId === terminalId) terminal.writeln(`\r\n[process exited with code ${payload.exitCode ?? 'unknown'}]`); });
    api().onAgentEvent(pushAgentEvent); api().onAgentState(applyAgentState);
    rendererById('agentTimelineToggle')?.addEventListener('click', () => { agentTimelineExpanded = !agentTimelineExpanded; renderAgent(); });
    window.setInterval(() => { if (agentRunning && ui.agentElapsed) ui.agentElapsed.textContent = agentElapsedLabel(); }, 1000);
    await loadPreferences(); await initTerminal();
    await Promise.allSettled([refreshRuntime(),refreshFiles(),refreshGit(),refreshChanges(),refreshEvidence(),refreshSkills(),refreshTrace(),refreshWorkspaceSync(),runProjectAudit()]);
  } catch (error) { document.body.textContent=`Workbench startup failed: ${error.message}`; }
})();

(() => {
  const stateText=value => String(value || 'unknown').replace(/_/g,' ').toUpperCase();
  function setFooter(id,label,state,identity='') { const element=document.getElementById(id); if (!element) return; element.textContent=`${identity ? `${identity} · ` : `${label} `}${stateText(state)}`; element.dataset.state=String(state || 'unknown'); }
  async function refreshRuntimeControlStatus() { try { const status=await window.accessIde.status(); runtimeViewState=window.RuntimeViewState.fromSnapshot(runtimeViewState,status); agentRunning=runtimeViewState.agent.running; runtimeStarted=runtimeViewState.runtime.active === true; setFooter('footerRuntime','RUNTIME',runtimeViewState.runtime.status); setFooter('footerProvider','PROVIDER',runtimeViewState.provider.status,providerIdentity); setFooter('footerWorkspace','WORKSPACE',runtimeViewState.workspace.status); updateAgentControlButton(); return status; } catch { runtimeViewState={ ...runtimeViewState, runtime:{ status:'failed', active:false } }; runtimeStarted=false; setFooter('footerRuntime','RUNTIME','failed'); return null; } }
  async function runRuntimeControl(action) {
    let result;
    if (action === 'restart') {
      result = await window.accessIde.runtimeRestart();
    } else if (action === 'stop') {
      result = await window.accessIde.runtimeStop();
    } else if (action === 'start') {
      result = await window.accessIde.runtimeStart();
    }
    if (!result?.ok) throw new Error(result?.error || `Runtime ${action} failed.`);
    await refreshRuntimeControlStatus();
    return result;
  }
  /* Initialize the agent control button system */
  const updateAgentControlButton = () => {
    for (const button of [document.getElementById('liveAgentControl')].filter(Boolean)) {
      if (runtimeStarted) {
        button.textContent = 'Stop Runtime';
        button.className = 'primary-button is-running';
        button.dataset.action = 'stop';
      } else {
        button.textContent = 'Start Runtime';
        button.className = 'primary-button';
        button.dataset.action = 'start';
      }
    }
  };

  const handleAgentControlClick = event => {
    const button = event.currentTarget;
    const action = runtimeStarted ? 'stop' : 'start';

    button.textContent = 'Processing...';
    button.disabled = true;

    runRuntimeControl(action).then(result => {
      runtimeStarted = result?.status?.runtimeControl?.active === true;
      button.disabled = false;
      updateAgentControlButton();

      setTimeout(() => {
        updateAgentControlButton();
      }, 1500);
    }).catch(error => {
      console.error('Runtime control error:', error);
      if (ui.status) {
        ui.status.textContent = error.message || 'Failed to ' + action;
        ui.status.dataset.state = 'error';
      }
      button.disabled = false;
      updateAgentControlButton();
    });
  };

  function initializeAgentControl() {
    updateAgentControlButton();
    document.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('#liveAgentControl') : null;
      if (button) handleAgentControlClick({ currentTarget: button });
    });
    refreshRuntimeControlStatus();
    window.setInterval(refreshRuntimeControlStatus, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initializeAgentControl,{once:true}); else initializeAgentControl();
})();

