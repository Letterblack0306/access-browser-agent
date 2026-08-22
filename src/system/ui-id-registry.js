'use strict';

const ALLOWED_UI_IDS = Object.freeze(new Set([
  // index.html
  'workspace',
  'chooseWorkspace',
  'agentControl',
  'toggleMcp',
  'status',
  'workbench',
  'footerRuntime',
  'footerSession',
  'footerProvider',
  'footerWorkspace',
  // renderer home
  'homeStartTask',
  'homeOpenWorkspace',
  'homeWorkspace',
  'homeConfigureProvider',
  'homeChangeWorkspace',
  'homeProvider',
  'homeBrowser',
  'homeConfigureBrowser',
  'homeRuntime',
  'homeRefreshStatus',
  'homeGoLibrary',
  'homeGoActivity',
  // renderer explorer
  'refreshFiles',
  'search',
  'files',
  // renderer editor
  'editorTabs',
  'toggleDiff',
  'revertFile',
  'saveFile',
  'editorInput',
  // renderer activity
  'refreshActivity',
  'activityList',
  // renderer changes
  'refreshChanges',
  'changesList',
  // renderer evidence
  'refreshEvidence',
  'evidenceFilter',
  'evidenceList',
  // renderer skills
  'refreshSkills',
  'skillsList',
  // renderer runtime
  'refreshRuntime',
  'runtimeSummary',
  // renderer settings status
  'settingsStatus',
  // settings
  'baseUrl',
  'model',
  'refreshModels',
  'testConnection',
  'saveSettings',
  'mcpServerCommand',
  'browserProfilePath',
  'chooseChromeProfile',
  'browserExecutable',
  'saveBrowserSettings',
  'browserSettingsStatus',
  // lm studio advanced
  'lmStudioApiKey',
  'lmStudioEndpointPolicy',
  'lmStudioContextLength',
  'lmStudioTtlSeconds',
  'lmStudioConversationMode',
  // action feedback
  'uiActionStatus',
    // find/replace
  'editorFindPanel',
  'editorReplaceToggle',
  'editorFindInput',
  'editorFindStatus',
  'editorFindCase',
  'editorFindPrevious',
  'editorFindNext',
  'editorFindClose',
  'editorReplaceRow',
  'editorReplaceInput',
  'editorReplaceOne',
  'editorReplaceAll',
  // modern agent UI
  'agentStatusDot',
  'agentStatusText',
  'agentTimer',
  'agentStopBtn',
  'agentClearBtn',
  'agentChatContainer',
  'agentEmptyState',
  'agentInput',
  'agentSendBtn',
  'statusBarDot',
  'statusBarLabel',
  'statusBarTools',
  'statusBarTokens',
  // task state panel (right-side module)
  'taskStatePanel',
  'taskStateGoal',
  'taskStateLevel',
  'taskStateEmpty',
  'taskStateLevelsList',
  'taskStateEvidenceList',
  'taskStateDecisionsList',
  'taskStateBlockerCard',
  'taskStateDecisionCard',
  'taskStateLevelCompleteCard',
  'taskStateCompleteCard',
]));

function assertAllowedUiId(id) {
  if (!ALLOWED_UI_IDS.has(id)) {
    throw new Error(`UI ID registry blocked untracked element id: ${id}`);
  }
}

function allowedUiIds() {
  return [...ALLOWED_UI_IDS];
}

module.exports = {
  ALLOWED_UI_IDS,
  assertAllowedUiId,
  allowedUiIds,
};
