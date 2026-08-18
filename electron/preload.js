'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const QUIET_SUCCESS_IPC = new Set([
  'ide:status',
  'ide:diagnostic-session',
  'ide:diagnostic-recent',
  'ide:module-registry-status',
  'ide:agent-status',
  'ide:agent-receipts',
  'ide:agent-execution-trace',
  'ide:workspace-sync-status',
  'ide:mcp-status',
  'ide:git-status',
  'ide:terminal-write',
  'ide:terminal-resize',
  'ide:workbench-layout',
  'ide:preferences',
]);

function subscribe(channel, listener) {
  if (typeof listener !== 'function') throw new TypeError(`${channel} listener must be a function.`);
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function diagnostic(payload) {
  try { ipcRenderer.send('ide:diagnostic-event', payload); } catch {}
}

async function invoke(channel, ...args) {
  const quiet = QUIET_SUCCESS_IPC.has(channel);
  const started = performance.now();
  if (!quiet) diagnostic({ source:'preload', category:'ipc', action:channel, phase:'start', data:{ args } });
  try {
    const result = await ipcRenderer.invoke(channel, ...args);
    if (!quiet) diagnostic({ source:'preload', category:'ipc', action:channel, phase:'success', durationMs:performance.now()-started, data:{ result } });
    return result;
  } catch (error) {
    diagnostic({ source:'preload', category:'ipc', action:channel, phase:'failed', severity:'error', durationMs:performance.now()-started, error, data:{ args, quietObservation:quiet } });
    throw error;
  }
}

contextBridge.exposeInMainWorld('accessIde', Object.freeze({
  status: () => invoke('ide:status'),
  runtimeStart: () => invoke('ide:runtime-start'),
  runtimeStop: () => invoke('ide:runtime-stop'),
  runtimeRestart: () => invoke('ide:runtime-restart'),
  workbenchLayout: () => invoke('ide:workbench-layout'),
  preferences: () => invoke('ide:preferences'),
  savePreferences: input => invoke('ide:save-preferences', input),
  selectChromeProfile: currentPath => invoke('ide:select-chrome-profile', currentPath),
  browserStart: () => invoke('ide:browser-start'),
  browserStop: () => invoke('ide:browser-stop'),
  browserProviderTabs: () => invoke('ide:browser-provider-tabs'),
  browserOpen: () => invoke('ide:browser-open'),
  browserOpenExactChat: input => invoke('ide:browser-open-exact-chat', input),
  browserRelaySelect: target => invoke('ide:browser-relay-select', target),
  browserRelayStart: () => invoke('ide:browser-relay-start'),
  browserRelayStop: () => invoke('ide:browser-relay-stop'),
 browserRecoveryRead: input => invoke('ide:browser-recovery-read', input),
 browserRecoveryReconcile: input => invoke('ide:browser-recovery-reconcile', input),
  browserRelayCheck: async () => {
    const [tabs, status] = await Promise.all([invoke('ide:browser-provider-tabs'), invoke('ide:status')]);
    return { ok:true, tabs, status };
  },
  providerConfigure: input => invoke('ide:provider-configure', input),
  providerReadiness: () => invoke('ide:provider-readiness'),
  moduleRegistryStatus: () => invoke('ide:module-registry-status'),
  selectWorkspace: () => invoke('ide:select-workspace'),
  selectSyncTarget: currentPath => invoke('ide:select-sync-target', currentPath),
  workspaceSyncStatus: () => invoke('ide:workspace-sync-status'),
  workspaceSyncStart: input => invoke('ide:workspace-sync-start', input),
  workspaceSyncStop: () => invoke('ide:workspace-sync-stop'),
  list: relativePath => invoke('ide:list', relativePath),
  read: relativePath => invoke('ide:read', relativePath),
  write: input => invoke('ide:write', input),
  search: (query, relativePath) => invoke('ide:search', query, relativePath),
  inspectWorkspace: relativePath => invoke('ide:inspect-workspace', relativePath),
  mcpStatus: () => invoke('ide:mcp-status'),
  setMcpEnabled: enabled => invoke('ide:mcp-set-enabled', enabled),
  sendBirdEye: () => invoke('ide:birdeye-send'),
  birdEyeStatus: () => invoke('ide:birdeye-status'),
  models: baseUrl => invoke('ide:models', baseUrl),
  gitStatus: () => invoke('ide:git-status'),
  gitDiff: relativePath => invoke('ide:git-diff', relativePath),
  skills: () => invoke('ide:skills'),
  skillRead: name => invoke('ide:skill-read', name),
  openSkillsFolder: () => invoke('ide:open-skills-folder'),
  terminalCreate: () => invoke('ide:terminal-create'),
  terminalWrite: (terminalId, data) => invoke('ide:terminal-write', terminalId, data),
  terminalResize: (terminalId, cols, rows) => invoke('ide:terminal-resize', terminalId, cols, rows),
  terminalKill: terminalId => invoke('ide:terminal-kill', terminalId),
  terminalRestart: terminalId => invoke('ide:terminal-restart', terminalId),
  onTerminalData: listener => subscribe('ide:terminal-data', listener),
  onTerminalExit: listener => subscribe('ide:terminal-exit', listener),
  showContextMenu: input => invoke('ide:context-menu', input),
  revealPath: relativePath => invoke('ide:reveal-path', relativePath),
  onContextMenuAction: listener => subscribe('ide:context-menu-action', listener),
  agentStop: turnId => invoke('ide:agent-stop', turnId),
  agentStatus: () => invoke('ide:agent-status'),
  agentReceipts: () => invoke('ide:agent-receipts'),
  agentExecutionTrace: sessionId => invoke('ide:agent-execution-trace', sessionId),
  onAgentEvent: listener => subscribe('ide:agent-event', listener),
  onAgentState: listener => subscribe('ide:agent-state', listener),
  diagnosticEvent: input => diagnostic(input),
  diagnosticSession: () => invoke('ide:diagnostic-session'),
  diagnosticRecent: limit => invoke('ide:diagnostic-recent', limit),
  diagnosticReveal: () => invoke('ide:diagnostic-reveal'),
  onDiagnosticRecord: listener => subscribe('ide:diagnostic-record', listener),
}));
