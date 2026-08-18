# R3 — Ambiguous Durable Recovery Authority

**Branch:** `refactor/browser-conversation-turn-transport-20260816`  
**Research start head:** `e4eed03646440717ca20ad631a7e0de9d23421bd`  
**Status:** IMPLEMENTED / REGRESSION_PASSED / RUNTIME_PROVEN_ISOLATED_FIXTURE - focused and full repository regressions pass; copied-production-journal recovery is proven; the isolated rendered operator path is runtime-proven; live ChatGPT content behavior is not proven.

## Current position

R1 result-feedback ownership and R2 controlled restart continuity are closed as `PROVEN` for their tested boundaries.

R3 does not reopen those questions. It addresses the separate durable ambiguity preserved in the production transport journal:

```text
instructionId = turn-a51547a0194bf764
state = executing
```

The record must not be manually deleted, rewritten, or treated as completed merely to unblock the relay.

## Question

> When durable transport history says an instruction crossed a possible side-effect boundary but completion cannot be proven, how can an operator explicitly reconcile it without deleting evidence, guessing completion, or causing re-execution?

## Boundary under study

```text
append-only BrowserTransportJournal evidence
  -> journal projection / ambiguous-state classification
  -> BrowserInstructionRelay startup or polling recovery block
  -> recovery event and operator-visible evidence
  -> explicit governed reconciliation action
  -> durable reconciliation receipt
  -> derived continuation eligibility
  -> relay returns to waiting without replay
```

## Current proven behavior

At PR18 head before R3 implementation:

- `BrowserTransportJournal` persists append-only JSONL events and derives the current record projection by key.
- `BrowserInstructionRelay.start()` fails closed when the visible instruction has durable state `executing`, `failed`, `delivering`, `delivery_unverified`, `delivery_failed`, or ambiguous `consumed`.
- `BrowserInstructionRelay._tick()` applies the same fail-closed rule before submitting work.
- `result_queued` with a durable payload is separately recoverable without repeating local execution.
- known safe consumed dispositions are historical baselines, not reconciliation of ambiguous side effects.
- no verified operator-facing reconciliation owner has yet been established.

These are source-level findings. The exact local checkout, dirty state, production journal location, and rendered recovery surface still require BirdEye/local evidence.

## State classification

### Automatically recoverable

```text
result_queued + durable payload
  -> restore delivery only
  -> never repeat local execution
```

### Mechanically safe historical baseline

```text
consumed + delivery_response
consumed + first_start_historical_baseline
consumed + known_historical_baseline
  -> do not execute
  -> continuation may proceed
```

### Ambiguous and blocked

```text
executing
delivering
delivery_unverified
delivery_failed
failed where external side effects may have occurred
consumed + unknown disposition
  -> RECOVERY_REQUIRED
  -> no automatic execution
  -> no automatic delivery
```

R3 must verify whether every listed state belongs in the same reconciliation class. It must not mechanically generalize from the preserved `executing` case.

## Required operator evidence

Before any reconciliation choice, the operator must be able to inspect the available durable evidence for the exact record:

- journal key;
- instructionId and transportKey;
- workspaceRoot and conversationId;
- original state and state timestamps;
- raw content hash;
- target/provider identities when recorded;
- sessionId, result record hash/path, or delivery evidence when present;
- correlated diagnostic events or receipts when present;
- explicit statement of which expected evidence is absent.

The UI must not imply that missing evidence proves failure or success.

## Allowed dispositions

### `abandoned`

Meaning:

- the previous outcome remains unknown;
- the original instruction will never be automatically executed or delivered;
- the operator intentionally accepts that the work may be incomplete.

Required fields:

- actor;
- reason;
- timestamp;
- original record key and state.

### `quarantined`

Meaning:

- the record remains unresolved for forensic or manual investigation;
- it is excluded from automatic work;
- continuation policy must be explicitly defined and tested rather than inferred.

R3 must decide whether quarantine blocks only the affected transport identity or the entire workspace/conversation scope. This is an open authority question.

### `proven_complete`

Meaning:

- completion has been established by evidence outside the ambiguous state label;
- automatic replay is forbidden;
- continuation may proceed.

Required fields:

- actor;
- reason;
- one or more correlated evidence references;
- evidence type and identity;
- original record key and state.

An operator assertion without evidence references must not satisfy `proven_complete`.

## Durable reconciliation receipt

Reconciliation should be represented as a separate append-only event linked to the original instruction record, not as deletion or silent replacement of the original JSONL evidence.

Candidate record shape to validate against existing repository conventions:

```json
{
  "kind": "instruction_reconciliation",
  "reconciliationId": "reconcile-...",
  "instructionKey": "...",
  "instructionId": "turn-a51547a0194bf764",
  "previousState": "executing",
  "disposition": "abandoned | quarantined | proven_complete",
  "actor": {
    "type": "operator",
    "id": "..."
  },
  "reason": "...",
  "evidenceRefs": [],
  "recordedAt": "..."
}
```

This is a research schema, not yet implementation truth. Local/source inspection must determine existing identity, receipt, actor, and validation conventions before code is written.

## Authority constraints

- The reasoning agent may explain evidence and recommend a disposition.
- The operator owns the explicit reconciliation choice.
- The relay owns fail-closed enforcement and continuation eligibility.
- The journal owns durable evidence and reconciliation receipts.
- Neither the relay nor a text parser may infer semantic completion.
- Reconciliation is not permission to repeat an external side effect.
- Raw journal editing is not a supported reconciliation mechanism.
- A reconciliation action must be governed, auditable, and scoped to one exact durable record.

## One bounded first investigation

### Question

Where does the current `INSTRUCTION_RECOVERY_REQUIRED` event terminate, and which active rendered/runtime component can safely host an explicit reconciliation action?

### Source of truth

- local indexed workspace at the exact PR18 checkout;
- active imports/registration from relay through Electron/runtime/UI;
- production recovery event and journal record;
- current repository source at the same revision.

### Expected observable

One traced active path:

```text
journal record
  -> relay recovery error/event
  -> adapter/IPC/state owner
  -> rendered operator surface
```

with every producer and consumer identified.

### Falsifier

Any of the following prevents implementation planning:

- the inspected UI path does not consume the relay recovery event;
- multiple conflicting recovery authorities exist;
- the local checkout does not match the expected PR18 revision;
- the production journal belongs to a different runtime/workspace;
- no governed operator-action surface exists.

### Result classification

Until that trace is collected:

`BLOCKED_CONFIGURATION` for local-owner verification because BirdEye/local workspace access is unavailable in the current session.

## Implementation gate

No R3 code patch is authorized by this research record alone.

Implementation begins only after:

1. BirdEye proves the indexed Access Browser Agent root.
2. BirdEye records branch, HEAD, upstream, and dirty state.
3. The exact production journal path and preserved ambiguous record are inspected read-only.
4. The active recovery event consumer and operator surface are traced.
5. Existing receipt, actor, IPC, and governance conventions are identified.
6. The state-specific reconciliation scope is decided.
7. The research schema is revised to match proven project ownership.

## Focused regression requirements

The future implementation must prove at minimum:

1. unresolved `executing` remains blocked across restart;
2. no reconciliation path invokes `submitInstruction` for the ambiguous turn;
3. raw/original journal evidence remains readable and unchanged;
4. each accepted action appends one correlated reconciliation receipt;
5. unsupported `proven_complete` without evidence references is rejected;
6. repeated identical reconciliation is idempotent or deterministically rejected;
7. conflicting second reconciliation cannot silently replace the first;
8. reconciliation is scoped to the exact workspace, conversation, and instruction key;
9. unrelated records remain unchanged;
10. restart derives the same reconciliation projection;
11. continuation behavior matches the selected disposition;
12. recovery UI truth matches backend/journal truth.

## Live acceptance requirement

A live R3 claim requires one preserved or safely reproduced ambiguous record and a correlated operator action proving:

```text
ambiguous record visible
-> relay blocked
-> exact evidence rendered
-> explicit disposition submitted once
-> durable receipt appended once
-> original evidence retained
-> no local re-execution
-> restart preserves reconciliation
-> relay continuation matches disposition
```

Source tests alone cannot close R3.

## Falsifiers for final acceptance

R3 is `DISPROVEN` if any accepted reconciliation:

- deletes or rewrites original evidence;
- causes local re-execution or duplicate delivery;
- accepts `proven_complete` without correlated proof;
- can target the wrong workspace/conversation/instruction;
- can be silently replaced by another disposition;
- unblocks the relay without a durable receipt;
- reports continuation while the backend remains in recovery;
- loses its disposition after restart.

## Current anti-drift checkpoint

```text
CURRENT REMOTE HEAD:
  e4eed03646440717ca20ad631a7e0de9d23421bd at research start

ACCEPTED IMPLEMENTATION HEAD:
  72b078cf11c98c08dc8df4a0d9895d1b5156ae57

PROVEN INVARIANTS:
  R1 result-feedback ownership
  R2 controlled restart continuity
  ambiguous side-effect states fail closed
  original production ambiguity remains preserved

OPEN QUESTION:
 real rendered Problems -> IPC -> authority -> journal -> restart acceptance

LOCAL STATUS:
 local branch and dirty state verified through Loop Tool; GitHub PR state verified through connector; BirdEye was not callable in this session

NEXT SINGLE QUESTION:
 exercise one real rendered reconciliation against an isolated journal copy and prove waiting_for_instruction with zero historical submission
```


## Candidate implementation and validation evidence

Candidate branch: r3/canonical-46-integration-20260816

Validated working-tree base: b9371b6d85ffc3f9ef8e9b724ef0babe2a86d7b6

The candidate implements:

- append-only instruction_reconciliation receipts linked to one exact instruction key;

- abandoned, quarantined, and proven_complete dispositions backed by structured artifact identity and SHA-256;

- exact workspace and conversation scope derived from the selected relay target;

- rejection of missing proof, wrong scope, unsupported disposition, and conflicting reconciliation;

- deterministic idempotency for repeated identical requests;

- restart reconstruction without rewriting the original instruction record;

- relay continuation as a non-executable historical baseline after reconciliation;

- Problems evidence with the durable key, state, hashes, timestamps, available evidence, missing evidence, and explicit actions;

- IPC and preload read/reconcile APIs.

Validated cases:

- browser-recovery-reconciliation-smoke: PASS;

- browser-instruction-relay-smoke: PASS, including zero submission after reconciliation;

- browser-relay-restart-identity-smoke: PASS;

- BrowserSessionAuthority smoke: PASS, including active-target-derived scope;

- rebuild-runtime-state-smoke: PASS;

- rebuild-shell-smoke: PASS;

- full npm run check: PASS;

- isolated copied-production-journal acceptance: PASS.

Copied production evidence:

- instruction key: 5fad5bad16338bd15f885acc63165cda63088b2d4712640327c48d24b8c5929d;

- instructionId: turn-a51547a0194bf764;

- prior state: executing;

- isolated disposition: quarantined;

- durable receipt: 411d6c222e37fcfdffbd983b2132b5b0eb3c8706eb108f8edd23284444165c47;

- original production journal remained byte-for-byte unchanged;

- restart projection retained the reconciliation;

- the isolated harness did not invoke relay execution.

GitHub cross-check:

- PR 18 remains open, draft, mergeable, and unmerged;

- PR 18 remote head remains 68eff6f3708bca0198453d6ec9c25ccd862fdc61;

- the local R3 branch is not yet present on GitHub.

Proof classification:

- journal and relay contract: REGRESSION_PASSED;

- copied production journal acceptance: CANDIDATE_PASSED;

- real rendered Problems UI action through the running application: NOT YET PROVEN;

- production-journal mutation: NOT ATTEMPTED and not authorized by this evidence.

That bounded isolated-fixture acceptance has now passed. Live ChatGPT content behavior was not exercised and must not be inferred.

## Classification

`RUNTIME_PROVEN_ISOLATED_FIXTURE`

The bounded R3 operator recovery contract is runtime-proven against the isolated rendered fixture; live ChatGPT content acceptance remains separate.
## Rendered acceptance investigation update - 2026-08-16

### Evidence boundary

- PROVEN: the committed R3 backend, journal, relay, authority, IPC/preload, Problems projection, focused regressions, full repository check, and copied-production-journal acceptance at commit 78d749fefe9f64810bdb207ea1020530bd3bc9a6;

- PROVEN: the production journal remained unchanged; production reconciliation was not attempted;

- PROVEN DURING THE RENDERED INVESTIGATION: a real Electron renderer and real preload/IPC/authority/journal path detected an isolated synthetic durable executing record and produced the expected recovery-required failure before execution;

- TEST_HARNESS_FAILURE: early rendered runs failed because the harness attempted to recreate a production assistant turn whose durable record contains only rawSha256, not recoverable raw text; later fixture and command-transport errors were harness defects, not product failures;

- BLOCKED_CONFIGURATION: the configured Nvidia provider returned ResourceExhausted: Worker local total request limit reached (16/16), preventing the final post-reconciliation waiting_for_instruction observation;

- DISCOVERED PRODUCT ORDERING ISSUE: provider capability readiness was evaluated before local durable recovery visibility. A local uncommitted candidate now performs a read-only recovery preflight so an unresolved local side-effect boundary can be shown even when the provider is unavailable;

- REGRESSION_PASSED FOR THE CANDIDATE ORDERING FIX: BrowserSessionAuthority and BrowserInstructionRelay focused smoke tests pass;

- NOT YET PROVEN: one rendered Quarantine action completing through UI -> preload -> IPC -> authority -> append-only receipt, followed by restart -> waiting_for_instruction and zero historical submission.

### Do not repeat

- do not attempt to reconstruct the preserved production turn from rawSha256;

- do not mutate or reconcile the production journal;

- do not classify provider-capacity failure as an R3 journal/receipt failure;

- do not bypass provider readiness merely to force a green result;

- do not rerun already-passed backend, copied-journal, or startup investigations unless relevant source changes.

### Completed bounded proof

The isolated rendered fixture exercised the real Quarantine action, durable receipt, restart projection, zero historical replay, and waiting_for_instruction. Live ChatGPT content behavior remains outside this proof.

## Final bounded R3 acceptance - 2026-08-16

### Classification

`RUNTIME_PROVEN_ISOLATED_FIXTURE`

- Real Access Electron renderer: PROVEN.
- Rendered Problems evidence and Quarantine action: PROVEN.
- Preload -> IPC -> BrowserSessionAuthority -> append-only receipt: PROVEN.
- Restart reconciliation projection: PROVEN.
- Post-restart waiting_for_instruction: PROVEN.
- Historical instruction rows added: zero.
- Relay execution invoked for the reconciled historical record: false.
- Production journal unchanged: PROVEN.
- Full npm run check after the recovery-readiness ordering fix: PASS.
- Copied-production-journal acceptance rerun: PASS.

### Important boundary

The selected target used the preserved conversation URL for exact scope identity, but CDP Fetch interception served a synthetic local ChatGPT-shaped page with known assistant text. The live ChatGPT conversation was not read, submitted to, or mutated. Therefore this proves the bounded R3 operator recovery path in the real Access application against an isolated fixture; it does not prove live ChatGPT content behavior.

### Closure

The bounded R3 ambiguous durable recovery authority contract is complete at RUNTIME_PROVEN_ISOLATED_FIXTURE. Live-provider content acceptance is a separate lane and must not be inferred from this result. Production-journal reconciliation remains unattempted and unauthorized.

## Clean-branch recovery-ordering proof - 2026-08-16

`CORE_RENDERED_PASSED_WAITING_BLOCKED_CONFIGURATION`

At clean implementation head `ba3eb77400d529a213ff6c0545294508d7516d54`, the isolated rendered acceptance proved recovery visibility, operator Quarantine, IPC/authority receipt creation, restart projection, zero historical replay, and an unchanged production journal. Preload no longer duplicates provider policy; BrowserSessionAuthority owns recovery-first/provider-readiness ordering.

The provider capability probe still blocked the final WAITING transition. Therefore the core R3 rendered contract passed, while `waiting_for_instruction` remains correctly classified `BLOCKED_CONFIGURATION`. This result does not prove live ChatGPT content behavior and does not authorize production-journal reconciliation.
