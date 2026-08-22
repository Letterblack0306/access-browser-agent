'use strict';

const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWorkspaceBridgeServer } = require('../src/app/workspace-bridge-server');
const { IdePreferences } = require('../src/system/ide-preferences');
const { LocalRuntimeDiagnostics } = require('../src/system/local-runtime-diagnostics');
const { SkillCatalog } = require('../src/system/skill-catalog');
const { WorkspaceGitStatus } = require('../src/system/workspace-git-status');
const { validateWorkspacePath } = require('../src/system/workspace-path-guard');
const { parseWorkbenchLayout } = require('../src/system/workbench-layout');
const { AgentRuntimeAdapter } = require('./agent-runtime-adapter');
const { PtyTerminalManager } = require('./pty-terminal-manager');
const { McpClient } = require('../src/system/mcp-client');
const { ManagedChrome } = require('../src/system/managed-chrome');
const { ProviderChannel } = require('../src/browser/provider-channel');
const { BrowserInstructionRelay } = require('../src/agent/executive/BrowserInstructionRelay');
const { BrowserResultStore } = require('../src/system/browser-result-store');
const { BrowserSessionAuthority } = require('./browser-session-authority');
const { TaskStateRouterBridge } = require('./task-state-router-bridge');
const { WorkspaceCloneSync } = require('../src/system/workspace-clone-sync');

const bridgePort = Number(process.env.ACCESS_AGENT_IDE_BRIDGE_PORT || 7726);
const diagnostics = new LocalRuntimeDiagnostics();
const terminalManager = new PtyTerminalManager();
const workbenchLayout = parseWorkbenchLayout(
  fs.readFileSync(path.join(__dirname, 'workbench.layout.json'), 'utf8'),
);
const skills = new SkillCatalog(
  process.env.ACCESS_AGENT_SKILLS_ROOT || path.join(__dirname, '..', 'skills'),
);

let windowRef;
let bridgeServer;
let preferences;
let preferenceValues;
let workspaceGit;
let agentRuntime;
let mcpEnabled = false;
let mcpClient;
let managedChrome;
let generalManagedChrome;
let browserRelay;
let browserAuthority;
let taskStateRouterBridge;
let workspaceSync;
let runtimeActive = false;
let workspaceRoot = path.resolve(process.env.ACCESS_AGENT_WORKSPACE_ROOT || process.cwd());

if (!app.requestSingleInstanceLock()) app.quit();

function bridgeUrl(route = '') {
  return `http://127.0.0.1:${bridgePort}${route}`;
}

function workspaceKey(root) {
  return `ws-${crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16)}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientBridgeError(error) {
  const code = String(error?.cause?.code || error?.code || '');
  return ['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET'].includes(code);
}

async function bridgeRequest(route, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(bridgeUrl(route), {
        ...options,
        headers: { ...(options.headers || {}), Connection: 'close' },
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text || '{}'); }
      catch { throw new Error(`Workspace bridge returned invalid JSON for ${route}.`); }
      if (!response.ok || !body.ok) {
        const error = new Error(body.error || `Bridge request failed (${response.status}).`);
        error.code = body.code;
        error.details = body;
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (!isTransientBridgeError(error) || attempt === 2) throw error;
      await delay(100 * (attempt + 1));
    }
  }
  throw lastError;
}

function mcpStatus() {
  if (mcpClient) return mcpClient.status();
  return {
    enabled: mcpEnabled,
    connected: false,
    status: mcpEnabled ? 'disconnected' : 'disabled',
    tools: [],
    error: null,
  };
}

function createAgentRuntime(root) {
  const runtimeStateRoot = path.join(
    app.getPath('userData'),
    'agent-state',
    workspaceKey(root),
  );
  return new AgentRuntimeAdapter({
    workspaceRoot: root,
    stateRoot: runtimeStateRoot,
    preferencesPath: app.getPath('userData'),
    skills,
    pinnedSkills: [],
    mcp: mcpClient,
    getWindow: () => windowRef,
    getSettings: () => preferenceValues || {},
  });
}

async function createConfiguredAgentRuntime(root) {
  const runtime = createAgentRuntime(root);
  await runtime.updateProviderSettings(preferenceValues);
  await runtime.resetForFreshRuntime();
  return runtime;
}

async function runtimeStatus() {
  const [bridgeResult, agentStatus] = await Promise.all([
    bridgeRequest('/api/runtime/status')
      .then(value => ({ ok: true, value }))
      .catch(error => ({ ok: false, error })),
    agentRuntime
      ? agentRuntime.status().catch(error => ({
          running: false,
          status: 'degraded',
          error: error?.message || String(error),
        }))
      : Promise.resolve({ running: false, status: 'initializing', turnId: null }),
  ]);
  const status = bridgeResult.ok
    ? bridgeResult.value
    : {
        ok: false,
        status: 'degraded',
        bridge: {
          connected: false,
          error: bridgeResult.error?.message || String(bridgeResult.error),
        },
      };
  return {
    ...status,
    workspaceRoot,
    bridgeUrl: bridgeUrl(),
    agent: agentStatus,
    runtimeControl: { active: runtimeActive },
    provider: agentRuntime ? agentRuntime.providerStatus() : null,
    mcp: mcpStatus(),
    browser: managedChrome ? managedChrome.status() : null,
    browserRelay: browserRelay ? browserRelay.status() : null,
    workspaceSync: workspaceSync ? workspaceSync.status() : null,
  };
}

async function stopOwnedRuntime() {
  runtimeActive = false;
  let agent = null;
  if (agentRuntime) {
    const state = await agentRuntime.status().catch(() => null);
    if (state?.turnId) {
      agent = await agentRuntime.stop(state.turnId).catch(error => ({
        ok: false,
        error: error?.message || String(error),
      }));
    }
  }
  return { ok: true, agent, status: await runtimeStatus() };
}

async function startOwnedRuntime() {
  agentRuntime = await createConfiguredAgentRuntime(workspaceRoot);
  runtimeActive = true;
  return { ok: true, status: await runtimeStatus() };
}

async function restartOwnedRuntime() {
  await stopOwnedRuntime();
  agentRuntime = await createConfiguredAgentRuntime(workspaceRoot);
  runtimeActive = true;
  return { ok: true, status: await runtimeStatus() };
}

async function listenBridge(root) {
  const server = createWorkspaceBridgeServer({ workspaceRoot: root });
  await new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(bridgePort, '127.0.0.1');
  });
  return server;
}

async function switchWorkspace(root) {
  const nextRoot = path.resolve(root);
  if (nextRoot === workspaceRoot) return runtimeStatus();

  const previousRoot = workspaceRoot;
  const previousServer = bridgeServer;
  const previousAgentRuntime = agentRuntime;
  const previousWorkspaceGit = workspaceGit;
  let nextServer;

  try {
    if (workspaceSync?.running) workspaceSync.stop();
    if (previousAgentRuntime) {
      const state = await previousAgentRuntime.status().catch(() => null);
      if (state?.turnId) await previousAgentRuntime.stop(state.turnId).catch(() => {});
    }
    if (previousServer) await new Promise(resolve => previousServer.close(resolve));
    nextServer = await listenBridge(nextRoot);
    bridgeServer = nextServer;
    workspaceRoot = nextRoot;
    workspaceGit = new WorkspaceGitStatus(nextRoot);
    agentRuntime = await createConfiguredAgentRuntime(nextRoot);
    if (taskStateRouterBridge) taskStateRouterBridge.onWorkspaceChanged();
    preferenceValues = await preferences.save({
      ...preferenceValues,
      workspaceRoot: nextRoot,
      mcpEnabled,
    });
    return runtimeStatus();
  } catch (error) {
    if (nextServer) await new Promise(resolve => nextServer.close(resolve)).catch(() => {});
    workspaceRoot = previousRoot;
    workspaceGit = previousWorkspaceGit;
    agentRuntime = previousAgentRuntime;
    if (previousServer && !previousServer.listening) {
      try { bridgeServer = await listenBridge(previousRoot); }
      catch { bridgeServer = previousServer; }
    } else {
      bridgeServer = previousServer;
    }
    return {
      ok: false,
      status: 'workspace_switch_failed',
      workspaceRoot: previousRoot,
      attemptedWorkspaceRoot: nextRoot,
      error: error?.message || String(error),
      code: error?.cause?.code || error?.code || null,
    };
  }
}

async function startBridge(root) {
  bridgeServer = await listenBridge(root);
  workspaceRoot = path.resolve(root);
  workspaceGit = new WorkspaceGitStatus(workspaceRoot);
  return runtimeStatus();
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#181818',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  windowRef.removeMenu();
  windowRef.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  windowRef.webContents.on('will-navigate', event => event.preventDefault());
  windowRef.loadFile(path.join(__dirname, 'index.html'));
}

function terminalShell() {
  return process.platform !== 'win32'
    ? (process.env.SHELL || '/bin/bash')
    : (process.env.PWSH_EXE || 'pwsh.exe');
}

function showContextMenu(event, input = {}) {
  const type = String(input.type || 'generic');
  const send = action => event.sender.send('ide:context-menu-action', { action, context: input });
  const separator = { type: 'separator' };
  const templates = {
    terminal: [
      { label: 'Copy', enabled: Boolean(input.hasSelection), click: () => send('copy') },
      { label: 'Paste', enabled: Boolean(clipboard.readText()), click: () => send('paste') },
      separator,
      { label: 'Select All', click: () => send('select-all') },
      { label: 'Clear Terminal', click: () => send('clear-terminal') },
    ],
    editor: [
      { label: 'Copy', enabled: Boolean(input.hasSelection), click: () => send('copy') },
      { label: 'Paste', click: () => send('paste-editor') },
      { label: 'Select All', click: () => send('select-all') },
      separator,
      { label: 'Save', enabled: Boolean(input.path && input.dirty), click: () => send('save-file') },
      { label: 'Revert', enabled: Boolean(input.path && input.dirty), click: () => send('revert-file') },
      { label: 'Copy Path', enabled: Boolean(input.path), click: () => send('copy-path') },
      { label: 'Reveal in File Explorer', enabled: Boolean(input.path), click: () => send('reveal-file') },
    ],
    explorer: [
      { label: 'Open', enabled: Boolean(input.path), click: () => send('open-file') },
      { label: 'Copy Path', enabled: Boolean(input.path), click: () => send('copy-path') },
      { label: 'Reveal in File Explorer', enabled: Boolean(input.path), click: () => send('reveal-file') },
      separator,
      { label: 'Refresh', click: () => send('refresh') },
    ],
    git: [
      { label: 'Open Diff', enabled: Boolean(input.path), click: () => send('open-diff') },
      { label: 'Copy Path', enabled: Boolean(input.path), click: () => send('copy-path') },
      separator,
      { label: 'Refresh Git', click: () => send('refresh') },
    ],
    'agent-event': [
      { label: 'Copy Event', click: () => send('copy-event') },
      { label: 'Copy Receipt ID', enabled: Boolean(input.receiptId), click: () => send('copy-receipt') },
    ],
  };
  Menu.buildFromTemplate(
    templates[type] || [{ label: 'Copy', enabled: Boolean(input.hasSelection), click: () => send('copy') }],
  ).popup({ window: BrowserWindow.fromWebContents(event.sender) });
  return { ok: true };
}

ipcMain.handle('ide:status', runtimeStatus);
ipcMain.handle('ide:runtime-start', startOwnedRuntime);
ipcMain.handle('ide:runtime-stop', stopOwnedRuntime);
ipcMain.handle('ide:runtime-restart', restartOwnedRuntime);
ipcMain.handle('ide:workbench-layout', () => workbenchLayout);
ipcMain.handle('ide:select-chrome-profile', async (_event, currentPath = '') => {
  const requested = String(currentPath || '').trim();
  const result = await dialog.showOpenDialog(windowRef, { title: 'Choose Chrome profile folder', defaultPath: requested && fs.existsSync(requested) ? requested : undefined, properties: ['openDirectory'] });
  return result.canceled || !result.filePaths[0] ? { canceled: true } : { canceled: false, path: path.resolve(result.filePaths[0]) };
});
ipcMain.handle('ide:browser-start', () => browserAuthority.ensureBrowser());
ipcMain.handle('ide:browser-stop', () => browserAuthority.stop());
ipcMain.handle('ide:browser-provider-tabs', () => browserAuthority.listProviderTabs());
ipcMain.handle('ide:browser-open', () => browserAuthority.openBrowser());
ipcMain.handle('ide:browser-relay-select', async (_event, target) => {
  const result = await browserAuthority.selectExistingTarget(target);
  preferenceValues = await preferences.save({
    ...preferenceValues,
    browserProviderTarget: result.selectedTarget || result.relay?.target || null,
    workspaceRoot,
    mcpEnabled,
  });
  return result;
});
ipcMain.handle('ide:browser-relay-start', () => browserAuthority.startRelay());
ipcMain.handle('ide:browser-relay-stop', () => browserAuthority.stopRelay());
ipcMain.handle('ide:browser-recovery-read', (_event, input) => browserAuthority.getRecovery(input));
ipcMain.handle('ide:browser-recovery-reconcile', (_event, input) => browserAuthority.reconcileRecovery(input));
ipcMain.handle('ide:preferences', () => ({ ...preferenceValues, workspaceRoot, mcpEnabled }));
ipcMain.handle('ide:save-preferences', async (_event, input) => {
  preferenceValues = await preferences.save({
    ...preferenceValues,
    ...input,
    workspaceRoot,
    mcpEnabled,
  });
  return preferenceValues;
});
ipcMain.handle('ide:provider-configure', async (_event, input = {}) => {
  const result = await agentRuntime.updateProviderSettings(input);
  if (input.persist === true) {
    preferenceValues = await preferences.save({
      ...preferenceValues,
      lmStudioBaseUrl: String(input.lmStudioBaseUrl || '').trim(),
      lmStudioModel: String(input.lmStudioModel || '').trim(),
      lmStudioApiKey: String(input.lmStudioApiKey || '').trim(),
      lmStudioEndpointPolicy: String(input.lmStudioEndpointPolicy || 'private-network').trim(),
      lmStudioContextLength: input.lmStudioContextLength || null,
      lmStudioTtlSeconds: input.lmStudioTtlSeconds || null,
      mcpServerCommand: String(input.mcpServerCommand || '').trim(),
      workspaceRoot,
      mcpEnabled,
    });
  }
  return result;
});
ipcMain.handle('ide:provider-readiness', () => agentRuntime.providerReadiness());
ipcMain.handle('ide:select-workspace', async () => {
  const result = await dialog.showOpenDialog(windowRef, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return switchWorkspace(result.filePaths[0]);
});
ipcMain.handle('ide:select-sync-target', async (_event, currentPath = '') => {
  const requested = String(currentPath || '').trim();
  const result = await dialog.showOpenDialog(windowRef, {
    title: 'Choose workspace copy destination',
    defaultPath: requested && fs.existsSync(requested) ? requested : undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled || !result.filePaths[0] ? { canceled: true } : { canceled: false, path: path.resolve(result.filePaths[0]) };
});
ipcMain.handle('ide:workspace-sync-status', () => workspaceSync?.status() || { running: false });
ipcMain.handle('ide:workspace-sync-start', async (_event, input = {}) => {
  if (!workspaceSync) throw new Error('Workspace sync is not ready.');
  const status = await workspaceSync.start({
    sourceRoot: workspaceRoot,
    targetRoot: input.targetRoot,
    exclusions: input.exclusions,
  });
  preferenceValues = await preferences.save({
    ...preferenceValues,
    workspaceRoot,
    mcpEnabled,
    workspaceSyncTarget: status.targetRoot,
    workspaceSyncExclusions: status.exclusions,
  });
  return status;
});
ipcMain.handle('ide:workspace-sync-stop', () => workspaceSync?.stop() || { running: false });
ipcMain.handle('ide:mcp-status', mcpStatus);
ipcMain.handle('ide:mcp-set-enabled', async (_event, enabled) => {
  const wantEnabled = enabled === true;
  if (!wantEnabled) {
    mcpEnabled = false;
    if (mcpClient) await mcpClient.stop().catch(() => mcpClient.stop());
  } else {
    if (!String(preferenceValues.mcpServerCommand || '').trim()) {
      return { ok: false, error: 'No MCP server command configured in Settings.', ...mcpStatus() };
    }
    if (!mcpClient) {
      mcpClient = new McpClient({ serverCommand: preferenceValues.mcpServerCommand });
    }
    mcpEnabled = true;
    const status = await mcpClient.start();
    preferenceValues = await preferences.save({ ...preferenceValues, workspaceRoot, mcpEnabled });
    return { ok: status.connected === true, ...status };
  }
  preferenceValues = await preferences.save({ ...preferenceValues, workspaceRoot, mcpEnabled });
  return { ok: true, ...mcpStatus() };
});
ipcMain.handle('ide:list', (_event, relativePath = '.') => bridgeRequest(`/api/workspace/list?path=${encodeURIComponent(relativePath)}`));
ipcMain.handle('ide:read', (_event, relativePath) => bridgeRequest(`/api/workspace/file?path=${encodeURIComponent(relativePath)}`));
ipcMain.handle('ide:write', (_event, input = {}) => bridgeRequest('/api/workspace/file', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
}));
ipcMain.handle('ide:search', (_event, query, relativePath = '.') => bridgeRequest(`/api/workspace/search?query=${encodeURIComponent(query)}&path=${encodeURIComponent(relativePath)}`));
ipcMain.handle('ide:inspect-workspace', (_event, relativePath = '.') => bridgeRequest(`/api/workspace/inspect?path=${encodeURIComponent(relativePath)}`));
ipcMain.handle('ide:models', (_event, baseUrl) => diagnostics.listModels(baseUrl));
ipcMain.handle('ide:git-status', () => workspaceGit.read());
ipcMain.handle('ide:git-diff', (_event, relativePath) => workspaceGit.diff(relativePath));
ipcMain.handle('ide:skills', () => skills.list());
ipcMain.handle('ide:skill-read', (_event, name) => skills.readSkill(name));
ipcMain.handle('ide:open-skills-folder', async () => {
  fs.mkdirSync(skills.directory, { recursive: true });
  const error = await shell.openPath(skills.directory);
  if (error) throw new Error(`Could not open the skills folder: ${error}`);
  return { ok:true, path:skills.directory };
});
ipcMain.handle('ide:terminal-create', event => terminalManager.create({ owner: event.sender, cwd: workspaceRoot, shell: terminalShell() }));
ipcMain.handle('ide:terminal-write', (_event, id, data) => { terminalManager.write(id, data); return { ok: true }; });
ipcMain.handle('ide:terminal-resize', (_event, id, cols, rows) => { terminalManager.resize(id, cols, rows); return { ok: true }; });
ipcMain.handle('ide:terminal-kill', (_event, id) => ({ ok: terminalManager.kill(id) }));
ipcMain.handle('ide:terminal-restart', (event, id) => {
  terminalManager.kill(id);
  return terminalManager.create({ owner: event.sender, cwd: workspaceRoot, shell: terminalShell() });
});
ipcMain.handle('ide:context-menu', showContextMenu);
ipcMain.handle('ide:reveal-path', async (_event, relativePath) => {
  const validated = await validateWorkspacePath(workspaceRoot, String(relativePath || '.'), {
    mustExist: true,
  });
  if (!validated.ok) return validated;
  shell.showItemInFolder(validated.resolved);
  return { ok: true };
});
// FIX #P1e: Apply the runtime-active authorization gate to every execution
// IPC path. Previously only the browser/task-state bridge path was gated,
// so ide:agent-run could invoke a stopped runtime directly.
function assertRuntimeActive() {
  if (!runtimeActive) {
    const error = new Error('Runtime is stopped. Start the runtime before running an agent.');
    error.code = 'RUNTIME_INACTIVE';
    throw error;
  }
}
ipcMain.handle('ide:agent-run', (_event, input = {}) => { assertRuntimeActive(); return agentRuntime.run(input); });
ipcMain.handle('ide:agent-stop', (_event, turnId) => { assertRuntimeActive(); return agentRuntime.stop(turnId); });
ipcMain.handle('ide:agent-status', () => agentRuntime.status());
ipcMain.handle('ide:agent-intervene', (_event, text) => { assertRuntimeActive(); return agentRuntime.intervene(text); });
ipcMain.handle('ide:agent-receipts', () => agentRuntime.receipts());
ipcMain.handle('ide:agent-execution-trace', (_event, sessionId) => agentRuntime.executionTrace(sessionId));
ipcMain.handle('ide:agent-approve', (_event, approvalId) => agentRuntime.approve(approvalId));
ipcMain.handle('ide:agent-reject', (_event, approvalId) => agentRuntime.reject(approvalId));

app.whenReady().then(async () => {
  try {
    preferences = new IdePreferences(app.getPath('userData'));
    preferenceValues = await preferences.load();
    workspaceSync = new WorkspaceCloneSync();
    managedChrome = new ManagedChrome({ getSettings: () => preferenceValues });
    generalManagedChrome = new ManagedChrome({
      getSettings: () => ({
        ...preferenceValues,
        browserProfilePath: path.join(app.getPath('userData'), 'Managed Browser Tools'),
      }),
    });
    mcpEnabled = preferenceValues.mcpEnabled === true;
    mcpClient = new McpClient({ serverCommand: preferenceValues.mcpServerCommand });
    if (mcpEnabled && String(preferenceValues.mcpServerCommand || '').trim()) {
      mcpClient.start().catch(() => {});
    }
    if (!process.env.ACCESS_AGENT_WORKSPACE_ROOT && preferenceValues.workspaceRoot) {
      workspaceRoot = path.resolve(preferenceValues.workspaceRoot);
    }
    agentRuntime = await createConfiguredAgentRuntime(workspaceRoot);
    taskStateRouterBridge = new TaskStateRouterBridge({
      getWorkspaceRoot: () => workspaceRoot,
      getAgentRuntime: () => agentRuntime,
      getWindow: () => windowRef,
      // FIX #P5: Runtime authorization gate — a stopped runtime must not be
      // invoked through the relay → task-state bridge path.
      getRuntimeActive: () => runtimeActive,
    });
    taskStateRouterBridge.registerIpc(ipcMain);

    browserRelay = new BrowserInstructionRelay({
      channel: new ProviderChannel(),
      getEndpoint: () => (browserAuthority ? browserAuthority.getLiveEndpoint() : ''),
      getWorkspaceRoot: () => workspaceRoot,
      submitInstruction: input => taskStateRouterBridge.submitInstruction(input),
      storeResult: payload => new BrowserResultStore(path.join(app.getPath('userData'), 'agent-state', workspaceKey(workspaceRoot))).put(payload),
      onEvent: event => { if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send('ide:agent-event', event); },
    });
    browserAuthority = new BrowserSessionAuthority({ managedChrome, generalManagedChrome, channel:new ProviderChannel(), relay:browserRelay });
    global.__accessAgentRetireBrowserBootstrap=(endpoint,targetId)=>browserAuthority._retireBootstrapTarget(endpoint,targetId);
    workspaceGit = new WorkspaceGitStatus(workspaceRoot);
    await startBridge(workspaceRoot);
    createWindow();
  } catch (error) {
    dialog.showErrorBox('Access Agent IDE could not start', error.message);
    app.quit();
  }
});

app.on('second-instance', () => {
  if (!windowRef) return;
  if (windowRef.isMinimized()) windowRef.restore();
  windowRef.focus();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  terminalManager.dispose();
  if (mcpClient) mcpClient.stop().catch(() => {});
  if (managedChrome) managedChrome.stop().catch(() => {});
  if (generalManagedChrome && generalManagedChrome !== managedChrome) generalManagedChrome.stop().catch(() => {});
  if (browserRelay) browserRelay.stop();
  if (workspaceSync) workspaceSync.stop();
  if (bridgeServer) bridgeServer.close();
});
