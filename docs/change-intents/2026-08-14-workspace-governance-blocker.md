# Change Intent

## Change ID

`2026-08-14-workspace-governance-blocker`

## Status

`completed`

## Requested outcome

Add a fail-closed workspace governance boundary so agent-authored mutations require a documented change intent first, while adding a runtime-module ownership registry that surfaces maintenance drift as a visible caution without becoming an agent reasoning state machine.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-14-workspace-governance-blocker.md`
- `docs/MODULE_REGISTRY.md`
- `electron/rebuild-main.js`
- `electron/preload.js`
- `electron/rebuild-renderer.js`
- `electron/rebuild-diagnostic-enhancer.js`
- `scripts/change-governance-check.js`
- `scripts/module-registry.js`
- `src/app/workspace-bridge-server.js`
- `src/agent/guards/ChangeGovernanceGuard.js`
- `src/agent/ToolRegistry.js`
- `src/agent/executive/LiveToolContext.js`
- `src/system/workspace-reader.js`
- `src/system/module-registry.js`
- `test/change-governance-smoke.js`
- `test/live-tool-context-patch-smoke.js`
- `test/module-registry-smoke.js`
- `test/rebuild-agent-truth-observability-smoke.js`
- `test/rebuild-shell-smoke.js`
- `test/workspace-bridge-contract-smoke.js`
- `package.json`

## Intent

Implement the GPT-Knowledge blocker pattern in the active Access Agent rebuild without importing historical UI/runtime implementations. Pre-change documentation becomes a deterministic mutation precondition. Runtime-module registry information remains architecture/maintenance metadata and must never become a semantic planning or approval workflow.

## Planned changes

- Add a repository change index and per-change intent contract.
- Add a deterministic change-governance validator for required sections, active status, target-file declarations, and parallel active changes.
- Add an agent-side `ChangeGovernanceGuard` that blocks create/write/patch/delete and governed command execution unless the active change documentation authorizes it.
- Preserve the narrow governance-document bootstrap path used by the GPT-Knowledge reference so an agent can create the next `docs/change-intents/<id>.md` and update `docs/CHANGE_INDEX.md` before ordinary mutation.
- Add a governed `createFile` capability: ordinary new files require active target declaration; governance documents may be created through the bootstrap exception only.
- Enforce the same guard at the direct workspace bridge PUT mutation boundary so renderer/raw HTTP writes cannot bypass ToolRegistry governance.
- Apply the same governance precondition to typed browser `quick_command` execution so it cannot bypass the workspace mutation contract.
- Preserve read-only investigation tools without requiring change documentation.
- Extend the existing import/feature module registry with a separate runtime ownership registry containing owner, behavior, success, failure, and parent relationships.
- Generate `docs/MODULE_REGISTRY.md` from the canonical runtime registry.
- Surface runtime-registry drift as `MODULE_REGISTRY_CAUTION` in validation and as a read-only caution badge in the workspace Runtime view through the diagnostics/UI enhancement layer; it must not block ordinary runtime/agent execution.
- Add regression tests and package scripts so the hard governance check runs before the normal repository validation.

## Why

The workspace needs a durable anti-drift mechanism for long-running agent work. Agents must not mutate files first and explain later. The blocker should force the intended files, reason, and planned change to exist before mutation, then preserve implementation/validation evidence afterward. The bootstrap must remain possible without opening a general mutation bypass. Direct disk mutation surfaces must not provide an alternate path around the guard. Separately, runtime ownership must remain traceable so architectural modules cannot silently drift or become unmaintained, while maintenance drift remains a caution rather than an agent-control decision.

## Post-change update

- Added `docs/CHANGE_INDEX.md` and this per-change intent contract as the durable governance record.
- Added `ChangeGovernanceGuard` with repository/index/intent validation, parallel active-change support, target attribution, explicit ambiguity handling, and a narrow governance-document bootstrap.
- Added governed `createFile` support so a future change-intent file can be created without opening a general file-creation bypass.
- Enforced governance before agent `createFile`, `writeFile`, `applyPatch`, and `runCommand` side effects through `ToolRegistry`.
- Enforced the same governance contract on typed browser `quick_command` execution.
- Enforced the same guard at the direct workspace bridge PUT boundary before `WorkspaceReader.write`, closing the raw/direct disk-mutation bypass.
- Kept read-only investigation tools outside the mutation blocker.
- Extended `WorkspaceReader` with workspace-contained exclusive create semantics while preserving expected-hash overwrite protection.
- Added `RUNTIME_MODULES` ownership contracts and `docs/MODULE_REGISTRY.md` as a maintenance projection. Registry drift is a caution, not a semantic agent state.
- Registered the direct mutation owners `src/app/workspace-bridge-server.js` and `src/system/workspace-reader.js`, and corrected the governance owner contract to describe parallel active changes instead of a single-active-change assumption.
- Added Runtime-view module maintenance visibility through the existing diagnostics/UI enhancement layer without gating runtime, browser, tools, or reasoning.
- Updated regression contracts for governance, direct patching, workspace bridge mutation, module ownership, rebuild observability, and shell/runtime UI behavior.
- Wired repository validation so `precheck` runs workspace governance and module-maintenance status before the broader check suite.

## Validation evidence

- Source-level review confirms the hard mutation guard is present at the agent ToolRegistry boundary, typed browser `quick_command` boundary, and direct workspace bridge PUT boundary.
- Source-level review confirms governance-document bootstrap is limited to `docs/CHANGE_INDEX.md` and `docs/change-intents/*.md`; ordinary new files still require active target declaration.
- Source-level review confirms parallel active changes are supported, overlapping target declarations require explicit `changeId`, and multi-change governed commands require explicit `changeId`.
- `src/system/module-registry.js` now registers 25 active ownership modules, including the direct workspace bridge and filesystem authorities, with unique owner/behavior/success/failure contracts and registered parent relationships.
- `test/module-registry-smoke.js` now asserts the two direct mutation owners and the parallel-change governance contract.
- `package.json` runs `guard:workspace` and `module:status` from `precheck`, and includes the governance/module tests in the repository validation contract.
- Final remote source head after governance closure is `28e0babc4b2021e2e3429bfd1cff2a0df8c3506a` before this evidence-only governance-document update. GitHub Actions run `31825819622` for that source head concluded `startup_failure` with zero jobs. Therefore no hosted repository command executed; this is an external CI blocker, not a test pass or source-test failure.
- Full `npm run check` and live Windows/browser/provider E2E remain intentionally pending for the isolated local validation stage. This completed change records source implementation closure only and does not claim runtime proof or PR merge readiness.
