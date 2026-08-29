'use strict';

const ALLOWED_MODULES = Object.freeze({
  'node:fs': { features: ['readFile', 'writeFile', 'appendFile', 'readFileSync', 'writeFileSync', 'existsSync', 'mkdir', 'mkdirSync', 'stat', 'statSync', 'readdir', 'readdirSync', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'copyFile', 'copyFileSync', 'rename', 'renameSync'] },
  'node:fs/promises': { features: ['readFile', 'writeFile', 'appendFile', 'mkdir', 'stat', 'readdir', 'unlink', 'rm', 'cp', 'rename', 'access', 'symlink', 'readlink', 'realpath', 'truncate'] },
  'node:path': { features: ['join', 'resolve', 'relative', 'dirname', 'basename', 'extname', 'isAbsolute', 'normalize', 'sep', 'delimiter'] },
  'node:path/posix': { features: ['join', 'resolve', 'relative', 'dirname', 'basename', 'extname', 'isAbsolute', 'normalize', 'sep'] },
  'node:path/win32': { features: ['join', 'resolve', 'relative', 'dirname', 'basename', 'extname', 'isAbsolute', 'normalize', 'sep'] },
  'node:crypto': { features: ['randomUUID', 'createHash', 'createHmac', 'pbkdf2', 'scrypt', 'scryptSync', 'createCipheriv', 'createDecipheriv', 'createSign', 'createVerify', 'createECDH', 'generateKeyPairSync', 'generateKeyPair'] },
  'node:events': { features: ['EventEmitter'] },
  'node:child_process': { features: ['spawn', 'exec', 'execFile', 'fork', 'execFileSync', 'spawnSync'] },
  'node:util': { features: ['promisify', 'format', 'inherits', 'types'] },
  'node:os': { features: ['tmpdir', 'homedir', 'platform', 'arch', 'cpus', 'freemem', 'totalmem', 'uptime', 'hostname', 'networkInterfaces'] },
  'node:stream': { features: ['Readable', 'Writable', 'Transform', 'Duplex', 'PassThrough', 'pipeline'] },
  'node:buffer': { features: ['Buffer'] },
  'node:url': { features: ['URL', 'URLSearchParams', 'parse', 'format', 'resolve'] },
  'node:http': { features: ['createServer', 'request', 'get', 'Agent', 'ClientRequest', 'Server', 'ServerResponse', 'IncomingMessage'] },
  'node:https': { features: ['createServer', 'request', 'get', 'Agent'] },
  'electron': { features: ['app', 'BrowserWindow', 'clipboard', 'dialog', 'ipcMain', 'Menu', 'shell', 'session', 'protocol', 'net', 'powerMonitor', 'powerSaveBlocker', 'screen', 'nativeImage', 'nativeTheme', 'webContents'] },
  '../src/app/workspace-bridge-server': { features: ['createWorkspaceBridgeServer'] },
  '../src/system/ide-preferences': { features: ['IdePreferences'] },
  '../src/system/local-runtime-diagnostics': { features: ['LocalRuntimeDiagnostics'] },
  '../src/system/skill-catalog': { features: ['SkillCatalog'] },
  '../src/system/workspace-git-status': { features: ['WorkspaceGitStatus'] },
  '../src/system/workspace-handoff-service': { features: ['WorkspaceHandoffService'] },
  '../src/system/workspace-path-guard': { features: ['validateWorkspacePath'] },
  '../src/system/machine-environment': { features: ['MachineEnvironment', 'normalizeExecutableName', 'executableKind'] },
  '../src/system/governed-terminal': { features: ['GovernedTerminal', 'parseTerminalCommand', 'DEFAULT_ALLOWED_COMMANDS', 'DENIED_COMMANDS', 'normalizeAllowedCommands'] },
  '../src/system/mcp-client': { features: ['McpClient'] },
  '../src/system/managed-chrome': { features: ['ManagedChrome'] },
  '../src/browser/provider-channel': { features: ['ProviderChannel'] },
  '../src/llm/OpenAICompatibleProvider': { features: ['OpenAICompatibleProvider', 'normalizeBaseUrl', 'parseToolArguments'] },
  '../src/agent/executive/UnifiedAgentService': { features: ['UnifiedAgentService'] },
  '../src/agent/executive/BrowserInstructionRelay': { features: ['BrowserInstructionRelay'] },
  '../src/system/browser-result-store': { features: ['BrowserResultStore'] },
  '../src/system/task-state/TaskStateController': { features: ['TaskStateController'] },
  '../src/system/task-state/TaskStateRouter': { features: ['TaskStateRouter'] },
  './task-state-router-bridge': { features: ['TaskStateRouterBridge'] },
  './agent-runtime-adapter': { features: ['AgentRuntimeAdapter'] },
  './settings-module': { features: ['SettingsModule'] },
  './lm-studio-settings-bridge': { features: [] },
  './renderer': { features: [] },
  './preload': { features: [] },
  './shell-module-manager': { features: [] },
  './pty-terminal-manager': { features: ['PtyTerminalManager'] },
});

const RUNTIME_MODULES = Object.freeze({
  'electron/rebuild-main.js': contract('electron-main-authority', 'Own the active Electron process, shared browser channel, diagnostic session, quick-command bridge, module-maintenance status, and rebuild entrypoint.', 'One rebuild process owns startup and shared infrastructure without activating historical UI owners.', 'Startup fails visibly or diagnostics record the infrastructure failure.', []),
  'electron/preload.js': contract('renderer-ipc-boundary', 'Expose the bounded rebuild IPC surface to the renderer and record IPC lifecycle diagnostics.', 'Renderer calls only explicit rebuild capabilities through context isolation.', 'IPC failures reject with diagnostics; hidden main-process capabilities remain unreachable.', ['electron/rebuild-main.js']),
  'electron/browser-session-authority.js': contract('browser-session-authority', 'Own selected target continuity, managed-browser lifecycle coordination, and relay start prerequisites.', 'Relay starts only against a validated supported target with agent-ready provider state.', 'Target/provider drift enters recovery or fails visibly; no target guessing.', ['electron/rebuild-main.js']),
  'src/app/workspace-bridge-server.js': contract('workspace-bridge-mutation-boundary', 'Own the local workspace HTTP bridge and enforce change governance before direct hash-guarded PUT writes reach disk.', 'Read routes remain passive and direct writes are accepted only when the target is authorized by active change documentation.', 'Missing/incomplete/undeclared governance returns a blocked response before WorkspaceReader.write is invoked.', ['electron/rebuild-main.js']),
  'src/system/workspace-reader.js': contract('workspace-filesystem-authority', 'Own workspace-scoped list/read/create/write/search/inspect filesystem operations with path containment and hash-guarded overwrite semantics.', 'Filesystem operations remain inside the active workspace; creates are exclusive and overwrites require the expected SHA-256.', 'Path escape, missing source, stale hash, oversized content, or existing create target returns exact failure without hidden mutation.', ['src/app/workspace-bridge-server.js','src/agent/executive/LiveToolContext.js']),
  'src/system/managed-chrome.js': contract('managed-browser-process', 'Own the dedicated Chrome process and dynamically discovered CDP endpoint.', 'Only the Access-owned managed Chrome process is started/stopped and a usable CDP endpoint is reported.', 'Missing profile/executable/CDP readiness produces a classified browser/setup failure.', ['electron/browser-session-authority.js']),
  'src/browser/provider-channel.js': contract('browser-provider-channel', 'Own supported-chat target inspection, assistant-message provenance, exact conversation identity, composer readiness, and browser send.', 'Capture and delivery stay on one validated conversation identity.', 'Unsupported provider, provenance failure, target drift, or send ambiguity is explicit.', ['electron/browser-session-authority.js']),
  'src/browser/observable-browser-runtime.js': contract('observable-browser-runtime', 'Wrap browser channel and relay with rendered-delivery verification, failure artifacts, and correlated diagnostics.', 'Submission evidence and rendered-delivery evidence remain distinct and attributable.', 'Unverified rendered delivery remains explicit and is never silently promoted to delivered.', ['electron/rebuild-main.js','src/browser/provider-channel.js']),
  'src/agent/executive/BrowserInstructionRelay.js': contract('browser-transport-relay', 'Own exact instruction-envelope transport identity, durable observation/result lifecycle, bounded pre-submit retries, and no semantic task reasoning.', 'Each new envelope executes at most once and durable queued results can survive recovery without repeating local work.', 'Ambiguous executing/delivering states require recovery review; post-submit ambiguity is never automatically resent.', ['electron/browser-session-authority.js','src/browser/provider-channel.js','src/browser/observable-browser-runtime.js']),
  'src/system/browser-transport-journal.js': contract('browser-transport-journal', 'Persist instruction and delivery lifecycle by workspace + conversation + transport identity independent of transient CDP target ID.', 'Restart/Recover distinguishes observed, executing, queued, delivering, delivered, and ambiguous states.', 'Corrupt/ambiguous lifecycle blocks automatic replay rather than risking duplicate side effects.', ['src/agent/executive/BrowserInstructionRelay.js']),
  'electron/task-state-router-bridge.js': contract('instruction-agent-bridge', 'Transport structured browser instructions directly into the active agent runtime without semantic reply classification.', 'Structured browser instructions preserve identity and reach reasoning unchanged.', 'Inactive runtime or runtime failure returns explicit failure without reclassification.', ['src/agent/executive/BrowserInstructionRelay.js']),
  'electron/agent-runtime-adapter.js': contract('agent-runtime-adapter', 'Bind provider identity/capability proof to the active runtime and expose agent execution/status/trace.', 'Execution is permitted only for the active provider/model identity with matching agent-ready proof.', 'Unverified provider capability blocks execution with provider-precondition evidence.', ['electron/task-state-router-bridge.js']),
  'src/agent/executive/UnifiedAgentService.js': contract('unified-agent-service', 'Own one adaptive reasoning runtime, provider health/reconnect, skills, MCP tools, and result projection.', 'Provider choice never changes semantic agent architecture; observations return to the reasoning loop.', 'Provider/runtime unavailability becomes explicit blocked/failed state with evidence.', ['electron/agent-runtime-adapter.js']),
  'src/agent/executive/LiveAgentCore.js': contract('adaptive-reasoning-loop', 'Own model-driven interpretation, tool choice, adaptation, user-visible intent summaries, and completion judgment.', 'Tool observations including failures can inform the next reasoning turn without regex objective control.', 'Hard runtime/policy/provider blockers surface truthfully; private chain-of-thought is never emitted.', ['src/agent/executive/UnifiedAgentService.js']),
  'src/agent/executive/LiveToolContext.js': contract('workspace-capability-context', 'Construct current callable workspace adapters, bounded host-environment discovery, and governed execution for the reasoning agent.', 'Registered tools are current adapters rather than a claim that unregistered machine capabilities do not exist; discovered actions still execute only through governed runtime owners.', 'Unavailable executables, workspace/path failures, and command denial remain exact observations and are never substituted.', ['src/agent/executive/UnifiedAgentService.js']),
  'src/agent/ToolRegistry.js': contract('agent-tool-registry', 'Register capabilities, execute exact tools, emit evidence diagnostics, and enforce change governance before mutating actions.', 'Read-only tools remain available; mutation proceeds only with a valid active change intent.', 'Missing/incomplete governance blocks mutation before tool side effects.', ['src/agent/executive/LiveAgentCore.js','src/agent/executive/LiveToolContext.js']),
  'src/agent/guards/ChangeGovernanceGuard.js': contract('change-governance-guard', 'Validate change-index/intent integrity, parallel active changes, governance-document bootstrap, and declared target coverage before workspace mutation.', 'An authorized active change permits only its declared ordinary targets; overlapping targets or multi-change commands require explicit change identity while governance documents remain narrowly bootstrap-writable.', 'Missing, stale, incomplete, mismatched, ambiguous, or undeclared change intent fails closed before side effects.', ['src/agent/ToolRegistry.js','src/app/workspace-bridge-server.js']),
  'src/system/governed-terminal.js': contract('governed-terminal', 'Resolve a requested bare executable from the live machine environment, execute its exact literal argv inside the active workspace through LBE, and persist execution receipts.', 'A discovered executable is bounded to the exact request, runs with workspace cwd and shell composition disabled, and returns separate stdout/stderr/exit/executable identity evidence.', 'Missing executable, denied interpreter, unsafe wrapper argument, LBE denial, spawn failure, or timeout returns exact evidence and never substitutes another operation.', ['src/agent/executive/LiveToolContext.js']),
  'src/system/runtime-diagnostic-bus.js': contract('runtime-diagnostic-bus', 'Provide producer-side sanitized diagnostic publication and subscriptions across runtime owners.', 'Diagnostics can be emitted before renderer availability and retain correlation/classification fields.', 'A diagnostic sink failure must not fabricate successful runtime state.', ['electron/rebuild-main.js']),
  'src/system/runtime-diagnostic-log.js': contract('runtime-diagnostic-log', 'Persist chronological structured runtime diagnostics with sanitization and classification.', 'One session log correlates active runtime events without secrets/private reasoning.', 'Logging failure remains diagnosable and must not create stronger runtime claims.', ['src/system/runtime-diagnostic-bus.js']),
});

function contract(owner, behavior, success, failure, parents) {
  return Object.freeze({ owner, behavior, success, failure, parents:Object.freeze([...parents]) });
}

function assertAllowed(moduleId) {
  if (!(moduleId in ALLOWED_MODULES)) throw new Error(`Module registry blocked untracked module: ${moduleId}`);
}
function assertFeature(moduleId, feature) {
  const mod = ALLOWED_MODULES[moduleId];
  if (!mod || !mod.features.includes(feature)) throw new Error(`Module registry blocked untracked feature '${feature}' from ${moduleId}`);
}
function registerModule(moduleId, features = []) {
  if (ALLOWED_MODULES[moduleId]) throw new Error(`Module already registered: ${moduleId}`);
  throw new Error('Static module registry cannot be mutated at runtime; update src/system/module-registry.js.');
}
function registeredModules() { return Object.keys(ALLOWED_MODULES); }
function registeredFeatures(moduleId) { return ALLOWED_MODULES[moduleId]?.features || []; }
function runtimeModules() { return RUNTIME_MODULES; }

module.exports = { ALLOWED_MODULES, RUNTIME_MODULES, assertAllowed, assertFeature, registerModule, registeredModules, registeredFeatures, runtimeModules };
