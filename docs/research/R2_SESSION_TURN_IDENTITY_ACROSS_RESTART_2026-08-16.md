# R2 — Session / Turn Identity Across Restart

**Branch:** `refactor/browser-conversation-turn-transport-20260816`  
**Starting head:** `04eecb78ccc883a7a0eae71777c015bb11d0100f`  
**Accepted implementation head:** `72b078cf11c98c08dc8df4a0d9895d1b5156ae57`  
**Final status:** `PROVEN` — live owned-runtime + Managed Chrome + relay reconstruction preserves local session lineage and exactly-once transport identity for the tested restart boundary.

## Question

After the owned local agent runtime and browser transport are reconstructed for the same workspace and exact Browser Loop conversation, does the next natural turn continue the same durable local agent session without replaying the historical assistant turn or silently adopting ambiguous state?

## Boundary under study

```text
exact ChatGPT conversation
  -> ProviderChannel / replacement CDP target
  -> BrowserInstructionRelay durable journal scope
  -> AgentRuntimeAdapter owned-runtime lifecycle
  -> UnifiedAgentService
  -> AgentSessionRuntime current-session pointer
  -> AgentEventStore durable session history
  -> reconstructed local runtime
```

R2 deliberately separated this into controlled sub-boundaries before the final combined live acceptance.

## Identity chain

R2 tracks these identities independently:

```text
provider conversation identity
provider assistant transport identity
browser target generation / targetId
relay journal scope + instruction record
local agent sessionId
local reasoning execution
result / delivery-response correlation
```

A CDP `targetId` is replaceable. It must not, by itself, create a new conversation lineage or a new local reasoning session.

## Initial source finding — local session pointer was destroyed

The local agent event store and current-session pointer are durable under the workspace-scoped runtime state root.

`AgentSessionRuntime.getCurrentSession()` can read persisted `current.json`, rehydrate the named session through `getSession(sessionId)`, and reconstruct `AgentExecutive` state from durable events.

However, ordinary runtime construction previously called `resetForFreshRuntime()`, and the old implementation deleted the durable `current.json` pointer. That meant historical state could remain on disk while the runtime lost the authoritative continuation identity.

### Repair

`AgentSessionRuntime.resetForFreshRuntime()` now separates ordinary runtime reconstruction from explicit fresh-session semantics:

```text
resetForFreshRuntime()
  -> clear in-memory session objects
  -> preserve durable current-session pointer

resetForFreshRuntime({ clearCurrentSession:true })
  -> clear in-memory session objects
  -> remove durable current-session pointer
  -> explicit fresh-session boundary
```

### Focused proof

At head `f058fa8bbc434543c804e57fe5b96e269d43893c`:

- `agent-runtime-resilience-smoke: PASS`;
- ordinary reconstruction reused the original `sessionId`;
- explicit `clearCurrentSession:true` created a fresh session;
- the full repository `npm run check` passed.

Classification for this sub-boundary: `PROVEN`.

## Relay / replacement-target source finding

The transport journal intentionally scopes durable conversation state by workspace + conversation identity rather than CDP `targetId`, so a replacement browser target can adopt the same transport lineage.

A second defect existed in relay startup classification: every durable `consumed` instruction was treated as ambiguous recovery, including mechanically known safe historical dispositions such as:

- `delivery_response`;
- `first_start_historical_baseline`;
- `known_historical_baseline`.

### Repair

Relay startup now distinguishes safe consumed history from ambiguous side-effect history:

```text
consumed + known safe disposition
  -> historical baseline; do not execute

executing / delivering / delivery_unverified / delivery_failed
or consumed + unknown disposition
  -> fail closed / recovery required
```

### Focused proof

At head `69363f51abcfc1c43e553b6b9101d57c22bd0a22`:

- replacement target `tab-1 -> tab-2` preserved the same conversation/journal lineage;
- a consumed `delivery_response` remained non-executable;
- unknown consumed disposition still failed closed;
- full `npm run check` passed.

Classification for this sub-boundary: `PROVEN`.

## Harness failures that were not product failures

Two acceptance failures were classified before any production patch:

### Harness failure 1 — stale diagnostic baseline

The first live restart harness scanned failures from before Stop All, so the expected shutdown event `browser_relay.target_lost` was incorrectly treated as a post-restart failure.

The runtime had already reconstructed successfully and was healthy.

Classification: `TEST_HARNESS_FAILURE`.

Correction: establish a new diagnostic baseline only after restart completes.

### Harness failure 2 — readiness timeout while forward progress continued

A later run timed out waiting for `waiting_for_instruction` while provider capability readiness was still progressing through successful completion and subsequent probe events.

Classification: `TEST_HARNESS_FAILURE`.

Correction: separate the bounded provider/startup readiness timeout from the shorter causal-cycle timeout and fail immediately only on an explicit readiness rejection.

No production patch was made from either harness failure.

## Live production defect — completed session was terminalized during Stop All

The first valid live R2 run falsified session continuity:

```text
before: agent-1786866890206-66dff93a
after:  agent-1786870491115-d07a193c
```

The browser/transport side had reconstructed successfully, but the local reasoning session changed.

### Proven root cause

The durable session pointer was preserved correctly after the earlier `AgentSessionRuntime` repair. The active owned-runtime shutdown path still did this:

```text
completed session S exists
-> Stop All
-> stopOwnedRuntime() sees a turnId/sessionId
-> AgentRuntimeAdapter.stop(S)
-> UnifiedAgentService.stop(S)
-> durable session S becomes stopped
-> runtime reconstructs and rehydrates S
-> next natural turn sees status=stopped
-> AgentSessionRuntime correctly creates new session T
```

The defect was therefore not in `AgentSessionRuntime` session adoption. The defect was in the process-lifecycle owner terminalizing an already completed durable conversation merely because a session identity existed.

### Repair

`AgentRuntimeAdapter.stop()` now preserves non-running completed/idle durable sessions and delegates to `service.stop()` only for genuinely running work.

Contract:

```text
explicit stop of in-flight work
  -> stop / terminalize active session

owned runtime shutdown with completed or idle session
  -> preserve durable continuation lineage
```

### Focused proof

At accepted implementation head `72b078cf11c98c08dc8df4a0d9895d1b5156ae57`:

- `agent-runtime-adapter-stop-lifecycle-smoke: PASS`;
- completed/non-running session does not call the authoritative stop path;
- running session delegates to stop exactly once;
- full `npm run check` passed.

Classification: `PROVEN` at repository/runtime-owner level.

## Final live acceptance — PASS

The final live R2 acceptance ran on exact implementation head:

`72b078cf11c98c08dc8df4a0d9895d1b5156ae57`

against the exact selected ChatGPT conversation:

`https://chatgpt.com/c/6a7dd21e-47dc-83ed-a7a5-51e66d7bfed9`

Observed result:

```text
R2 LIVE RESTART IDENTITY ACCEPTANCE: PASS

sessionId:
  agent-1786870491115-d07a193c

firstTargetId:
  6D6BDC4E6A27BA36624E7C8B3C28A1C2

secondTargetId:
  869F6FA380A7E9E417E5A228C0F5513A

targetReplaced: true

localSubmissionCountBeforeRestart: 1
localSubmissionCountAfterRestartBeforeNewTurn: 1
finalLocalSubmissionCount: 2

sessionLineagePreserved: true

final relay lifecycle:
  waiting_for_instruction

final delivery evidence:
  RENDERED_DELIVERY_VERIFIED
```

## What the live proof establishes

For the tested ordinary Stop All -> Start Loop reconstruction boundary:

1. the first natural turn executed once;
2. the R1 result-feedback ownership cycle completed;
3. the owned runtime, Managed Chrome target, and relay were reconstructed;
4. a new CDP target identity was created;
5. the historical assistant turn was not replayed after restart;
6. exactly one later independent natural turn executed;
7. that turn continued the same durable local `sessionId`;
8. outbound result delivery was rendered and verified;
9. the provider response to that result was consumed without local re-execution;
10. the relay returned to stable `waiting_for_instruction`.

Classification: `PROVEN` live end to end for this R2 boundary.

## Falsifiers and result

| Falsifier | Result |
|---|---|
| Runtime reconstruction deletes/replaces current session pointer | Not observed after repair |
| Replacement CDP target forks conversation/journal lineage | Not observed |
| Historical assistant turn executes again after restart | Not observed (`1 -> 1` before new turn) |
| Next independent turn is lost | Not observed |
| Next independent turn executes more than once | Not observed |
| Local sessionId changes without explicit fresh-session request | Not observed |
| Ambiguous side-effect history is silently adopted | Protected by fail-closed regression |
| Result-feedback assistant response becomes another local task | Not observed |

## Remaining restart/recovery work outside this proof

R2 does **not** declare every possible crash/recovery situation solved.

Still separate:

- explicit operator reconciliation for stale durable `executing` / ambiguous production journal records;
- recovery from interruption inside an unresolved `delivering` or `delivery_unverified` side-effect boundary;
- full Electron process death at arbitrary instruction phases rather than the controlled owned-runtime/Managed-Chrome reconstruction tested here;
- selective skill routing, which is separate design debt and not part of R2.

The production journal's historical ambiguous `turn-a51547a0194bf764` record must not be deleted or guessed away. It remains a separate reconciliation problem.

## Final classification

`PROVEN`

The ordinary Access Browser Loop restart path tested here now preserves both:

- **transport exactly-once identity across replacement browser target**, and
- **local reasoning-session continuity across owned-runtime reconstruction**.

The important implementation lesson is that preserving a session pointer is insufficient if a process-lifecycle wrapper terminalizes the referenced session during shutdown. Restart continuity requires both durable identity preservation and correct lifecycle semantics at the active runtime owner.

## Evidence ledger note

The final live acceptance proof is authoritative over earlier intermediate failures. Earlier runs against stale heads or pre-fix harness versions remain useful as failure history, but they do not change the accepted classification above.
