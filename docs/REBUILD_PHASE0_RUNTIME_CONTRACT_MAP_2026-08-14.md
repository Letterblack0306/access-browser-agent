# Rebuild Phase 0 — Runtime Contract Map

Date: 2026-08-14
Branch: `rebuild/fresh-ui-shell-loop-20260814`

## Purpose

Freeze the current active runtime contracts before the fresh shell, UI projection, and loop coordinator are implemented. This document distinguishes current source truth from required rebuild behavior. It is not permission to copy historical UI/runtime code.

## Evidence classes

- **PROVEN** — directly visible in the active source or prior runtime evidence and sufficient for the stated claim.
- **SUPPORTED** — evidence is strong but the final live proof belongs to a later phase.
- **HYPOTHESIS** — design candidate requiring a discriminating test.
- **UNKNOWN** — not yet established.

## Active ownership map

| Surface | Current owner | Current contract | Evidence | Rebuild decision |
|---|---|---|---|---|
| Browser instruction envelope | `src/agent/executive/BrowserInstructionRelay.js` | Poll selected target, parse newest valid envelope, hash exact envelope, submit to local runtime | PROVEN | Preserve transport identity/dedupe semantics; move lifecycle into fresh loop coordinator |
| Browser target read/write | `src/browser/provider-channel.js` | CDP `Runtime.evaluate` + `Input.insertText`/Enter against explicit target id | PROVEN | Keep CDP transport concept; strengthen target continuity and bounded readiness |
| Browser instruction routing | `electron/task-state-router-bridge.js` | Current bridge runs browser input through `TaskStateRouter` before runtime | PROVEN | Browser inbound instruction must bypass reply semantics and reach reasoning runtime directly |
| Agent execution | `electron/agent-runtime-adapter.js` -> `UnifiedAgentService` / configured provider | Current local reasoning/tool runtime | SUPPORTED | Treat as reasoning authority; do not duplicate semantic reasoning in transport |
| Browser result persistence | `src/system/browser-result-store.js` | Persist result/correlation record | SUPPORTED | Keep evidence/persistence role; fresh coordinator owns delivery lifecycle |
| Runtime IPC | `electron/main.js` | Main process exposes agent, browser, workspace, terminal and settings IPC | PROVEN | New UI consumes explicit capabilities; shell owns no runtime lifecycle |
| Browser relay events | `BrowserInstructionRelay.onEvent` -> `ide:agent-event` | Renderer receives relay lifecycle events | PROVEN | Replace ad-hoc view interpretation with one normalized runtime-view projection |
| Terminal | `electron/pty-terminal-manager.js` | Native `node-pty` create/write/resize/kill/dispose | PROVEN | Add explicit safe degraded/fallback contract; never dereference null process |
| UI shell | current `electron/index.html`, `renderer.js`, `shell-module-manager.js` | Existing task-first workbench | PROVEN | Do not restore or extend historical shell; Phase 1 creates a fresh shell |

## Current browser relay sequence

Current source behavior:

```text
selected target
  -> start()
  -> snapshot target
  -> mark existing envelope historical
  -> poll
  -> parse new envelope
  -> submitInstruction(...)
  -> persist result
  -> queue resultEnvelope
  -> later poll
  -> channel.send(...)
  -> clear pending
```

### Proven gaps to close

#### G1 — inbound instruction can be interpreted by the reply router

Current `TaskStateRouterBridge.submitInstruction()` calls `_ensureRouter()`, extracts text and calls `router.handle(replyText)` before deciding whether to invoke the reasoning runtime.

**Required contract:** inputs explicitly identified as browser instructions must be delivered directly to the reasoning runtime. Transport may validate identity/workspace/authority, but it must not semantically complete or suppress the instruction.

#### G2 — result delivery is single-attempt and failure degrades/stops the relay

Current relay attempts `channel.send(...)` once for a queued result. Any send exception reaches the outer `_tick()` catch, sets `running = false`, changes lifecycle to `degraded`, and retains no bounded retry lifecycle.

**Required contract:** delivery is independently addressable and uses bounded retry/time budget for retryable target/composer/provider-readiness failures. Exhaustion becomes an explicit terminal delivery failure.

#### G3 — browser result status is not a complete delivery state model

Current relay has only `pendingResult:Boolean(...)` plus broad lifecycle values. It cannot expose attempt number, first queued time, last attempt, retryable failure, terminal delivery failure, or delivery evidence.

**Required contract:** projection must distinguish `result_queued`, `delivering`, `delivery_retry`, `delivered`, and `delivery_failed` with operation/instruction identity.

#### G4 — browser target continuity is only partially validated

Current relay binds `targetId`/`providerId`; current provider adapter is generic for any HTTP(S) page. Snapshot validation proves the same target id/provider id pair, but generic provider identity does not prove the target still represents the intended conversation after navigation.

**Required contract:** before intake and delivery, refresh target metadata and validate the intended selected conversation/target capability. Navigation must produce an observable revalidation path rather than a silent assumption.

#### G5 — composer readiness uses short fixed waits

Current provider send path uses fixed `100ms` and `250ms` waits. `COMPOSER_NOT_FOUND`, generating state, unavailable send control, or post-navigation UI reconstruction can fail immediately.

**Required contract:** readiness/retry policy is bounded by elapsed time + attempt count and emits evidence. Do not hide a permanent failure behind indefinite polling.

#### G6 — PTY API assumes a non-null native process

Current `write`, `resize`, and `kill` directly dereference `session.processRef`.

**Required contract:** an explicit fallback/degraded session must make `write`, `resize`, `kill`, and `dispose` safe and truthful. UI must show fallback/degraded capability rather than pretending native PTY availability.

## Transport vs reasoning boundary

The fresh coordinator may own:

- capture and delivery;
- exact event dedupe;
- workspace/source/target/session/operation identity;
- retry budgets and cancellation;
- persistence and evidence refs;
- target/capability validation;
- hard authority/security boundaries.

It must not decide:

- whether the user's instruction is semantically complete;
- whether repeated text is useful/corrective;
- implementation strategy;
- whether the reasoning agent needs more inspection;
- conversational intent beyond the minimum structural envelope contract.

## Phase-0 executable acceptance specifications

`test/rebuild-phase0-contract-smoke.js` intentionally describes contracts that the clean baseline does not yet satisfy.

The initial expected failures are:

1. inbound browser instruction bypasses the semantic reply router;
2. retryable result-delivery failure keeps the operation pending/running rather than degrading the whole relay;
3. a fallback terminal session tolerates write/resize/kill without null-process exceptions.

The Phase-0 spec is **not added to `npm run check` yet** because it is expected to fail until the fresh implementation supplies these contracts. Phase 4/6 will wire the relevant tests into canonical validation once they pass.

## Phase-0 exit evidence

Phase 0 is complete when:

- this ownership map matches the active branch source;
- the executable acceptance spec fails for the expected missing contracts, not for syntax/setup errors;
- no old UI/runtime code has been imported;
- implementation ownership for Phase 1 (shell) and Phase 4 (loop coordinator) is explicit;
- remaining target-continuity details are recorded as design/test work rather than assumed solved.
