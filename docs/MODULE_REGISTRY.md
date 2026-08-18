# Access Agent Runtime Module Registry

> Generated from `src/system/module-registry.js` by `npm run module:tree`.
> Ownership/maintenance registry only. It must never become an agent semantic state machine.

Registered ownership modules: 25.

## Active execution tree

```text
electron/rebuild-main.js [electron-main-authority]
  └─ electron/preload.js [renderer-ipc-boundary]
  └─   └─ electron/rebuild-shell.js [workbench-layout-owner]
  └─   └─   └─ electron/rebuild-renderer.js [workbench-controller]
  └─   └─   └─   └─ electron/rebuild-runtime-state.js [runtime-view-projection]
  └─   └─   └─   └─ electron/rebuild-settings.js [provider-settings-ui]
  └─   └─   └─   └─ electron/rebuild-diagnostic-enhancer.js [diagnostic-ui-enhancer]
  └─   └─ electron/rebuild-renderer.js [workbench-controller]
  └─   └─   └─ electron/rebuild-runtime-state.js [runtime-view-projection]
  └─   └─   └─ electron/rebuild-settings.js [provider-settings-ui]
  └─   └─   └─ electron/rebuild-diagnostic-enhancer.js [diagnostic-ui-enhancer]
  └─ electron/browser-session-authority.js [browser-session-authority]
  └─   └─ src/system/managed-chrome.js [managed-browser-process]
  └─   └─ src/browser/provider-channel.js [browser-provider-channel]
  └─   └─   └─ src/browser/observable-browser-runtime.js [observable-browser-runtime]
  └─   └─   └─   └─ src/agent/executive/BrowserInstructionRelay.js [browser-transport-relay]
  └─   └─   └─   └─   └─ src/system/browser-transport-journal.js [browser-transport-journal]
  └─   └─   └─   └─   └─ electron/task-state-router-bridge.js [instruction-agent-bridge]
  └─   └─   └─   └─   └─   └─ electron/agent-runtime-adapter.js [agent-runtime-adapter]
  └─   └─   └─   └─   └─   └─   └─ src/agent/executive/UnifiedAgentService.js [unified-agent-service]
  └─   └─   └─   └─   └─   └─   └─   └─ src/agent/executive/LiveAgentCore.js [adaptive-reasoning-loop]
  └─   └─   └─   └─   └─   └─   └─   └─   └─ src/agent/ToolRegistry.js [agent-tool-registry]
  └─   └─   └─   └─   └─   └─   └─   └─   └─   └─ src/agent/guards/ChangeGovernanceGuard.js [change-governance-guard]
  └─   └─   └─   └─   └─   └─   └─   └─ src/agent/executive/LiveToolContext.js [workspace-capability-context]
  └─   └─   └─   └─   └─   └─   └─   └─   └─ src/system/workspace-reader.js [workspace-filesystem-authority]
  └─   └─   └─   └─   └─   └─   └─   └─   └─ src/agent/ToolRegistry.js [agent-tool-registry]
  └─   └─   └─   └─   └─   └─   └─   └─   └─   └─ src/agent/guards/ChangeGovernanceGuard.js [change-governance-guard]
  └─   └─   └─   └─   └─   └─   └─   └─   └─ src/system/governed-terminal.js [governed-terminal]
  └─   └─   └─ src/agent/executive/BrowserInstructionRelay.js [browser-transport-relay]
  └─   └─   └─   └─ src/system/browser-transport-journal.js [browser-transport-journal]
  └─   └─   └─   └─ electron/task-state-router-bridge.js [instruction-agent-bridge]
  └─   └─   └─   └─   └─ electron/agent-runtime-adapter.js [agent-runtime-adapter]
  └─   └─   └─   └─   └─   └─ src/agent/executive/UnifiedAgentService.js [unified-agent-service]
  └─   └─   └─   └─   └─   └─   └─ src/agent/executive/LiveAgentCore.js [adaptive-reasoning-loop]
  └─   └─   └─   └─   └─   └─   └─   └─ src/agent/ToolRegistry.js [agent-tool-registry]
  └─   └─   └─   └─   └─   └─   └─   └─   └─ src/agent/guards/ChangeGovernanceGuard.js [change-governance-guard]
  └─   └─   └─   └─   └─   └─   └─ src/agent/executive/LiveToolContext.js [workspace-capability-context]
  └─   └─   └─   └─   └─   └─   └─   └─ src/system/workspace-reader.js [workspace-filesystem-authority]
  └─   └─   └─   └─   └─   └─   └─   └─ src/agent/ToolRegistry.js [agent-tool-registry]
  └─   └─   └─   └─   └─   └─   └─   └─   └─ src/agent/guards/ChangeGovernanceGuard.js [change-governance-guard]
  └─   └─   └─   └─   └─   └─   └─   └─ src/system/governed-terminal.js [governed-terminal]
  └─   └─ src/agent/executive/BrowserInstructionRelay.js [browser-transport-relay]
  └─   └─   └─ src/system/browser-transport-journal.js [browser-transport-journal]
  └─   └─   └─ electron/task-state-router-bridge.js [instruction-agent-bridge]
  └─   └─   └─   └─ electron/agent-runtime-adapter.js [agent-runtime-adapter]
  └─   └─   └─   └─   └─ src/agent/executive/UnifiedAgentService.js [unified-agent-service]
  └─   └─   └─   └─   └─   └─ src/agent/executive/LiveAgentCore.js [adaptive-reasoning-loop]
  └─   └─   └─   └─   └─   └─   └─ src/agent/ToolRegistry.js [agent-tool-registry]
  └─   └─   └─   └─   └─   └─   └─   └─ src/agent/guards/ChangeGovernanceGuard.js [change-governance-guard]
  └─   └─   └─   └─   └─   └─ src/agent/executive/LiveToolContext.js [workspace-capability-context]
  └─   └─   └─   └─   └─   └─   └─ src/system/workspace-reader.js [workspace-filesystem-authority]
  └─   └─   └─   └─   └─   └─   └─ src/agent/ToolRegistry.js [agent-tool-registry]
  └─   └─   └─   └─   └─   └─   └─   └─ src/agent/guards/ChangeGovernanceGuard.js [change-governance-guard]
  └─   └─   └─   └─   └─   └─   └─ src/system/governed-terminal.js [governed-terminal]
  └─ src/app/workspace-bridge-server.js [workspace-bridge-mutation-boundary]
  └─   └─ src/system/workspace-reader.js [workspace-filesystem-authority]
  └─   └─ src/agent/guards/ChangeGovernanceGuard.js [change-governance-guard]
  └─ src/browser/observable-browser-runtime.js [observable-browser-runtime]
  └─   └─ src/agent/executive/BrowserInstructionRelay.js [browser-transport-relay]
  └─   └─   └─ src/system/browser-transport-journal.js [browser-transport-journal]
  └─   └─   └─ electron/task-state-router-bridge.js [instruction-agent-bridge]
  └─   └─   └─   └─ electron/agent-runtime-adapter.js [agent-runtime-adapter]
  └─   └─   └─   └─   └─ src/agent/executive/UnifiedAgentService.js [unified-agent-service]
  └─   └─   └─   └─   └─   └─ src/agent/executive/LiveAgentCore.js [adaptive-reasoning-loop]
  └─   └─   └─   └─   └─   └─   └─ src/agent/ToolRegistry.js [agent-tool-registry]
  └─   └─   └─   └─   └─   └─   └─   └─ src/agent/guards/ChangeGovernanceGuard.js [change-governance-guard]
  └─   └─   └─   └─   └─   └─ src/agent/executive/LiveToolContext.js [workspace-capability-context]
  └─   └─   └─   └─   └─   └─   └─ src/system/workspace-reader.js [workspace-filesystem-authority]
  └─   └─   └─   └─   └─   └─   └─ src/agent/ToolRegistry.js [agent-tool-registry]
  └─   └─   └─   └─   └─   └─   └─   └─ src/agent/guards/ChangeGovernanceGuard.js [change-governance-guard]
  └─   └─   └─   └─   └─   └─   └─ src/system/governed-terminal.js [governed-terminal]
  └─ src/system/runtime-diagnostic-bus.js [runtime-diagnostic-bus]
  └─   └─ src/system/runtime-diagnostic-log.js [runtime-diagnostic-log]
```

## Contracts

### `electron/agent-runtime-adapter.js`

- Owner: `agent-runtime-adapter`
- Behavior: Bind provider identity/capability proof to the active runtime and expose agent execution/status/trace.
- Success: Execution is permitted only for the active provider/model identity with matching agent-ready proof.
- Failure: Unverified provider capability blocks execution with provider-precondition evidence.
- Parents: `electron/task-state-router-bridge.js`

### `electron/browser-session-authority.js`

- Owner: `browser-session-authority`
- Behavior: Own selected target continuity, managed-browser lifecycle coordination, and relay start prerequisites.
- Success: Relay starts only against a validated supported target with agent-ready provider state.
- Failure: Target/provider drift enters recovery or fails visibly; no target guessing.
- Parents: `electron/rebuild-main.js`

### `electron/preload.js`

- Owner: `renderer-ipc-boundary`
- Behavior: Expose the bounded rebuild IPC surface to the renderer and record IPC lifecycle diagnostics.
- Success: Renderer calls only explicit rebuild capabilities through context isolation.
- Failure: IPC failures reject with diagnostics; hidden main-process capabilities remain unreachable.
- Parents: `electron/rebuild-main.js`

### `electron/rebuild-diagnostic-enhancer.js`

- Owner: `diagnostic-ui-enhancer`
- Behavior: Enrich Complete Log correlation detail and show read-only module maintenance status in the Runtime view.
- Success: Maintenance drift appears as Caution/Maintained without gating runtime, browser, tools, or reasoning.
- Failure: Status lookup failure appears as caution text only and never changes execution authority.
- Parents: `electron/rebuild-renderer.js`

### `electron/rebuild-main.js`

- Owner: `electron-main-authority`
- Behavior: Own the active Electron process, shared browser channel, diagnostic session, quick-command bridge, module-maintenance status, and rebuild entrypoint.
- Success: One rebuild process owns startup and shared infrastructure without activating historical UI owners.
- Failure: Startup fails visibly or diagnostics record the infrastructure failure.
- Parents: none

### `electron/rebuild-renderer.js`

- Owner: `workbench-controller`
- Behavior: Own explicit user actions, passive boot, browser-loop controls, Stop All, and visible workbench state updates.
- Success: UI actions project backend truth and never auto-start browser/provider work during boot.
- Failure: User-visible Problems/diagnostics surface failed actions without inventing success.
- Parents: `electron/preload.js`, `electron/rebuild-shell.js`

### `electron/rebuild-runtime-state.js`

- Owner: `runtime-view-projection`
- Behavior: Normalize backend snapshots/events into user-visible runtime, provider, loop, delivery, terminal, and problem state.
- Success: Visible state strength never exceeds backend evidence strength.
- Failure: Unknown or ambiguous backend state stays unknown/unverified rather than guessed.
- Parents: `electron/rebuild-renderer.js`

### `electron/rebuild-settings.js`

- Owner: `provider-settings-ui`
- Behavior: Own explicit provider discovery, capability testing, provider activation, Chrome defaults, and integration settings.
- Success: Saved settings remain passive until the user explicitly invokes discovery/test/use/start actions.
- Failure: Provider/settings errors remain visible and do not silently start runtime/browser work.
- Parents: `electron/rebuild-renderer.js`

### `electron/rebuild-shell.js`

- Owner: `workbench-layout-owner`
- Behavior: Own resizable workbench layout persistence and center/right/bottom tab visibility only.
- Success: Layout changes do not acquire task, provider, browser, or semantic agent authority.
- Failure: Invalid layout interaction remains local UI state and cannot invent runtime success.
- Parents: `electron/preload.js`

### `electron/task-state-router-bridge.js`

- Owner: `instruction-agent-bridge`
- Behavior: Transport structured browser instructions directly into the active agent runtime without semantic reply classification.
- Success: Structured browser instructions preserve identity and reach reasoning unchanged.
- Failure: Inactive runtime or runtime failure returns explicit failure without reclassification.
- Parents: `src/agent/executive/BrowserInstructionRelay.js`

### `src/agent/executive/BrowserInstructionRelay.js`

- Owner: `browser-transport-relay`
- Behavior: Own exact instruction-envelope transport identity, durable observation/result lifecycle, bounded pre-submit retries, and no semantic task reasoning.
- Success: Each new envelope executes at most once and durable queued results can survive recovery without repeating local work.
- Failure: Ambiguous executing/delivering states require recovery review; post-submit ambiguity is never automatically resent.
- Parents: `electron/browser-session-authority.js`, `src/browser/provider-channel.js`, `src/browser/observable-browser-runtime.js`

### `src/agent/executive/LiveAgentCore.js`

- Owner: `adaptive-reasoning-loop`
- Behavior: Own model-driven interpretation, tool choice, adaptation, user-visible intent summaries, and completion judgment.
- Success: Tool observations including failures can inform the next reasoning turn without regex objective control.
- Failure: Hard runtime/policy/provider blockers surface truthfully; private chain-of-thought is never emitted.
- Parents: `src/agent/executive/UnifiedAgentService.js`

### `src/agent/executive/LiveToolContext.js`

- Owner: `workspace-capability-context`
- Behavior: Construct current callable workspace adapters, bounded host-environment discovery, and governed execution for the reasoning agent.
- Success: Registered tools are current adapters rather than a claim that unregistered machine capabilities do not exist; discovered actions still execute only through governed runtime owners.
- Failure: Unavailable executables, workspace/path failures, and command denial remain exact observations and are never substituted.
- Parents: `src/agent/executive/UnifiedAgentService.js`

### `src/agent/executive/UnifiedAgentService.js`

- Owner: `unified-agent-service`
- Behavior: Own one adaptive reasoning runtime, provider health/reconnect, skills, MCP tools, and result projection.
- Success: Provider choice never changes semantic agent architecture; observations return to the reasoning loop.
- Failure: Provider/runtime unavailability becomes explicit blocked/failed state with evidence.
- Parents: `electron/agent-runtime-adapter.js`

### `src/agent/guards/ChangeGovernanceGuard.js`

- Owner: `change-governance-guard`
- Behavior: Validate change-index/intent integrity, parallel active changes, governance-document bootstrap, and declared target coverage before workspace mutation.
- Success: An authorized active change permits only its declared ordinary targets; overlapping targets or multi-change commands require explicit change identity while governance documents remain narrowly bootstrap-writable.
- Failure: Missing, stale, incomplete, mismatched, ambiguous, or undeclared change intent fails closed before side effects.
- Parents: `src/agent/ToolRegistry.js`, `src/app/workspace-bridge-server.js`

### `src/agent/ToolRegistry.js`

- Owner: `agent-tool-registry`
- Behavior: Register capabilities, execute exact tools, emit evidence diagnostics, and enforce change governance before mutating actions.
- Success: Read-only tools remain available; mutation proceeds only with a valid active change intent.
- Failure: Missing/incomplete governance blocks mutation before tool side effects.
- Parents: `src/agent/executive/LiveAgentCore.js`, `src/agent/executive/LiveToolContext.js`

### `src/app/workspace-bridge-server.js`

- Owner: `workspace-bridge-mutation-boundary`
- Behavior: Own the local workspace HTTP bridge and enforce change governance before direct hash-guarded PUT writes reach disk.
- Success: Read routes remain passive and direct writes are accepted only when the target is authorized by active change documentation.
- Failure: Missing/incomplete/undeclared governance returns a blocked response before WorkspaceReader.write is invoked.
- Parents: `electron/rebuild-main.js`

### `src/browser/observable-browser-runtime.js`

- Owner: `observable-browser-runtime`
- Behavior: Wrap browser channel and relay with rendered-delivery verification, failure artifacts, and correlated diagnostics.
- Success: Submission evidence and rendered-delivery evidence remain distinct and attributable.
- Failure: Unverified rendered delivery remains explicit and is never silently promoted to delivered.
- Parents: `electron/rebuild-main.js`, `src/browser/provider-channel.js`

### `src/browser/provider-channel.js`

- Owner: `browser-provider-channel`
- Behavior: Own supported-chat target inspection, assistant-message provenance, exact conversation identity, composer readiness, and browser send.
- Success: Capture and delivery stay on one validated conversation identity.
- Failure: Unsupported provider, provenance failure, target drift, or send ambiguity is explicit.
- Parents: `electron/browser-session-authority.js`

### `src/system/browser-transport-journal.js`

- Owner: `browser-transport-journal`
- Behavior: Persist instruction and delivery lifecycle by workspace + conversation + transport identity independent of transient CDP target ID.
- Success: Restart/Recover distinguishes observed, executing, queued, delivering, delivered, and ambiguous states.
- Failure: Corrupt/ambiguous lifecycle blocks automatic replay rather than risking duplicate side effects.
- Parents: `src/agent/executive/BrowserInstructionRelay.js`

### `src/system/governed-terminal.js`

- Owner: `governed-terminal`
- Behavior: Resolve a requested bare executable from the live machine environment, execute its exact literal argv inside the active workspace through LBE, and persist execution receipts.
- Success: A discovered executable is bounded to the exact request, runs with workspace cwd and shell composition disabled, and returns separate stdout/stderr/exit/executable identity evidence.
- Failure: Missing executable, denied interpreter, unsafe wrapper argument, LBE denial, spawn failure, or timeout returns exact evidence and never substitutes another operation.
- Parents: `src/agent/executive/LiveToolContext.js`

### `src/system/managed-chrome.js`

- Owner: `managed-browser-process`
- Behavior: Own the dedicated Chrome process and dynamically discovered CDP endpoint.
- Success: Only the Access-owned managed Chrome process is started/stopped and a usable CDP endpoint is reported.
- Failure: Missing profile/executable/CDP readiness produces a classified browser/setup failure.
- Parents: `electron/browser-session-authority.js`

### `src/system/runtime-diagnostic-bus.js`

- Owner: `runtime-diagnostic-bus`
- Behavior: Provide producer-side sanitized diagnostic publication and subscriptions across runtime owners.
- Success: Diagnostics can be emitted before renderer availability and retain correlation/classification fields.
- Failure: A diagnostic sink failure must not fabricate successful runtime state.
- Parents: `electron/rebuild-main.js`

### `src/system/runtime-diagnostic-log.js`

- Owner: `runtime-diagnostic-log`
- Behavior: Persist chronological structured runtime diagnostics with sanitization and classification.
- Success: One session log correlates active runtime events without secrets/private reasoning.
- Failure: Logging failure remains diagnosable and must not create stronger runtime claims.
- Parents: `src/system/runtime-diagnostic-bus.js`

### `src/system/workspace-reader.js`

- Owner: `workspace-filesystem-authority`
- Behavior: Own workspace-scoped list/read/create/write/search/inspect filesystem operations with path containment and hash-guarded overwrite semantics.
- Success: Filesystem operations remain inside the active workspace; creates are exclusive and overwrites require the expected SHA-256.
- Failure: Path escape, missing source, stale hash, oversized content, or existing create target returns exact failure without hidden mutation.
- Parents: `src/app/workspace-bridge-server.js`, `src/agent/executive/LiveToolContext.js`

## Maintenance rule

Any change that adds, removes, renames, or changes ownership/behavior of an active runtime module must update `RUNTIME_MODULES` and regenerate this document. `npm run module:status` reports drift as a caution; it does not control agent reasoning or approvals.
