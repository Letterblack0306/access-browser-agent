# Next Implementation Plan — Agent Truth, Adaptive Continuation, and Complete Observability

Date: 2026-08-14
Branch: `rebuild/fresh-ui-shell-loop-20260814`
Status: **ACTIVE NEXT-SLICE PLAN — documentation first, implementation not yet started**

Companion contract:

`docs/REBUILD_PREIMPLEMENTATION_AGENT_TRUTH_OBSERVABILITY_CONTRACT_2026-08-14.md`

This plan supersedes any earlier assumption that the branch should be frozen for local testing immediately after the exact-chat/diagnostic UI work. The branch must first satisfy the additional GPT-Knowledge-derived requirements below.

## 1. Target

Repository:

`Letterblack0306/Accecc_Browser_Agent`

Branch:

`rebuild/fresh-ui-shell-loop-20260814`

Implementation baseline remains:

`3ca86e5fd9a98188e9b4a1b25b3da9842806374c`

Do not merge/cherry-pick/apply/copy historical PTY-UI, state-driven UI, electron-ide, old workbench, stash, checkpoint, or detached-worktree code.

## 2. Learned current state

### Active runtime responsibility model

```text
Reasoning provider/model
  owns semantic interpretation, planning, adaptation, tool choice

Agent runtime
  owns session/turn lifecycle and model/tool continuation

Governed runtime/tools
  own real workspace/process/tool execution

Browser transport
  owns exact target/session identity, delivery, retry and acknowledgement

Evidence/validation
  owns receipts and claim-matched proof

UI
  projects runtime truth; it does not decide semantic completion
```

### Already implemented/supported in the rebuild branch

- fresh isolated shell/UI entrypoint;
- current provider/runtime authority retained;
- exact configured chat URL as normal loop input;
- managed Chrome with dynamic CDP port discovery;
- explicit Start/Recover/Stop behavior;
- passive saved-browser state during app boot;
- exact target creation/selection path;
- bounded result-delivery retry lifecycle;
- transport duplicate protection;
- safe PTY/process fallback;
- append-only JSONL diagnostic session infrastructure;
- user-facing Complete Log surface and diagnostic filters;
- secret redaction.

### Important unproven/missing behavior discovered during documentation audit

- producer-side diagnostics are not yet guaranteed for every critical backend event;
- correlation IDs are not yet guaranteed end-to-end;
- `SUBMISSION_ACCEPTED` is not yet necessarily `RENDERED_DELIVERY_VERIFIED`;
- browser failure screenshot/DOM artifacts are not yet mandatory;
- LM Studio/provider readiness needs selected-model capability proof, particularly real tool calling;
- non-terminal tool observations must be proven to return control to the reasoning agent;
- provider-native diagnostic metadata should survive normalization;
- one correlated real runtime path is still unproven.

## 3. Requirement contract

### R1 — Adaptive reasoning after missing/failed evidence

`NOT_FOUND`, `EMPTY`, `FAILED`, `UNAVAILABLE`, or `TIMEOUT` from one tool/action must be passed back as observations to the reasoning agent.

They must not automatically become semantic task failure.

The agent should dynamically choose another useful action when one exists.

### R2 — Quiet stopping forbidden

If the agent cannot continue, the user-facing result and diagnostic journal must state the real blocker.

No missing document, zero search result, provider issue, tool error, or absent expected owner may silently terminate the task.

### R3 — Complete producer-side diagnostic evidence

Critical events must be written by their producers to the shared diagnostic sink, not only forwarded through the renderer.

Required producers:

- agent runtime;
- provider adapter;
- browser session authority;
- browser relay;
- terminal/process runtime;
- governed tool/execution path where practical;
- main-process lifecycle.

### R4 — Mandatory causal identity

A browser-originated instruction must be reconstructable across:

```text
conversationId
sessionId
instructionId
turnId
operationId
toolCallId
browserInstanceId
targetId
deliveryId
providerRequestId when available
```

IDs are generated/propagated by deterministic runtime owners and are independent of prose.

### R5 — Provider/model capability truth

Health is evaluated at `provider + endpoint + selected model`.

At minimum distinguish:

- server reachability;
- authentication status;
- model inventory;
- selected model availability;
- simple completion capability;
- tool calling capability;
- structured output capability as verified/unsupported/unknown;
- latency/cold-start information when observable;
- exact failure reason.

A model that can answer text but cannot reliably participate in the tool loop must not be displayed as fully agent-ready.

### R6 — Provider-native diagnostics preserved

Preserve useful native metadata such as provider request ID, native stop reason, native event type, model ID, and raw diagnostic reference where available.

### R7 — Browser delivery evidence levels

Keep distinct:

```text
TEXT_INSERTED
SUBMISSION_TRIGGERED
SUBMISSION_ACCEPTED
RENDERED_DELIVERY_VERIFIED
```

The UI and completion journal must report only the strongest evidence actually observed.

### R8 — Failure artifacts

For significant browser failures automatically capture bounded diagnostic artifacts (DOM/accessibility evidence, screenshot, URL/title, relevant console state where available) and link them to the JSONL record.

### R9 — Exact-chat continuity

Configured conversation identity remains authoritative. A changed target/chat identity blocks delivery rather than silently selecting another target.

### R10 — Reasoning remains model-owned

Infrastructure lifecycle states are telemetry/control mechanisms only. They must never encode a rigid semantic workflow for the reasoning model.

## 4. Change surface

The exact file list must be confirmed from live source immediately before editing, but the expected active owners are:

### Must change / instrument

- diagnostic runtime/sink infrastructure;
- agent runtime adapter/service event boundary;
- browser instruction relay;
- browser session authority;
- provider channel;
- selected provider adapter/health capability path;
- terminal manager/process event path;
- runtime-to-view projection where new evidence states are displayed;
- Complete Log renderer/artifact linking;
- focused rebuild contract tests.

### Must validate without unnecessary redesign

- task-state bridge semantics;
- governed tool result vocabulary;
- current agent tool continuation behavior;
- current session/turn IDs;
- existing provider model capability metadata;
- browser result persistence/replay protection.

### Must remain compatible

- current workspace hard boundary;
- current provider authentication contract;
- current MCP/governance boundaries;
- fresh shell isolation;
- current branch's exact-chat Start/Recover UX;
- existing terminal fallback behavior;
- secret-redaction contract.

### Not in scope for this slice

- new decorative UI redesign;
- restoring old workbench UI;
- broad agent-process visualization;
- new multi-agent hierarchy;
- semantic browser/bridge classifier;
- changing project-wide governance merely to satisfy tests;
- merge/release/publish.

## 5. Implementation sequence

### Step 1 — Producer diagnostic plumbing

Create/extend a dependency-safe diagnostic emission boundary so backend producers write directly to the same chronological session journal.

Acceptance:

- a renderer crash cannot erase backend events already emitted;
- producer diagnostic failures cannot crash runtime execution;
- redaction remains enforced centrally.

### Step 2 — Correlation context

Define a compact runtime correlation envelope and propagate it across browser instruction capture, reasoning turn, tool calls, validation, and delivery.

Acceptance:

- one instruction can be filtered/reconstructed end-to-end from a single JSONL file;
- retry/recovery preserves operation identity while new attempts get their own attempt/delivery identity where needed.

### Step 3 — Observation semantics / adaptive continuation

Inspect the actual governed tool/result path and ensure non-terminal tool outcomes are returned to reasoning rather than converted into task failure by routing/runtime glue.

Do not add a second semantic planner.

Acceptance tests:

- missing expected document → agent searches another relevant source;
- empty search → agent continues/reasons;
- first tool failure → agent adapts when an alternative exists;
- genuine missing dependency → explicit BLOCKED response;
- no quiet stop.

### Step 4 — Provider/model capability probe

Extend readiness so the selected model is tested for the capabilities the agent requires.

At minimum add a safe tool-call capability probe using a non-mutating test tool or isolated capability fixture.

Acceptance:

- text-only model is distinguishable from tool-capable model;
- unsupported/unknown capability is not mislabeled healthy;
- provider-native request/stop metadata is retained in diagnostics.

### Step 5 — Rendered browser-delivery verification

After submission acceptance, inspect the exact target for provider-specific rendered postcondition evidence.

Acceptance:

- `SUBMISSION_ACCEPTED` and `RENDERED_DELIVERY_VERIFIED` remain distinct;
- exact target/conversation identity is checked before final proof;
- failure/timeouts report strongest known evidence without guessing.

### Step 6 — Failure artifacts

Capture bounded artifacts for important target/composer/delivery/recovery failures.

Acceptance:

- artifact has SHA-256 and causal IDs;
- JSONL record links to artifact;
- screenshot/DOM evidence is redacted or omitted when unsafe;
- artifacts are local runtime evidence and not automatically committed to Git.

### Step 7 — Complete Log integration

Expose correlation and artifact references without turning each event into a card.

Acceptance:

- dense chronological log remains primary diagnostic UI;
- filters work by category/classification/correlation;
- user can open the session folder and identify evidence directly.

### Step 8 — Focused contract validation

Run source/static/unit/contract tests for all above requirements.

Do not call this end-to-end proof.

### Step 9 — Duplicate/authority scan

Before local freeze, verify no new parallel semantic owner, browser owner, diagnostic owner, or completion judge was introduced.

### Step 10 — Freeze for isolated local validation

Only after all above source/contract requirements are present should the branch be frozen for the user's one clean isolated checkout.

## 6. Required regression scenarios

| Scenario | Expected result |
| --- | --- |
| Referenced document missing | Observation returned to model; agent discovers alternate evidence and continues |
| Search returns no matches | No automatic task failure/complete; model re-evaluates |
| First chosen tool fails | Error returned; agent adapts or reports evidence-backed blocker |
| Required capability truly unavailable | Explicit `BLOCKED`, exact dependency, no fabricated success |
| Provider reaches server but model lacks tools | Provider is not labeled fully agent-ready |
| Browser chat navigates to another conversation | Delivery blocks with `CHAT_IDENTITY_CHANGED` |
| Composer unavailable temporarily | Bounded retry + diagnostic evidence |
| Submission accepted but rendered result unverified | Report `SUBMISSION_ACCEPTED`, not delivered/verified |
| Browser failure | Correlated DOM/screenshot artifact recorded |
| Retry after transient delivery error | No duplicate local mutating execution |
| Recover after stale CDP/browser | New browser/target created for exact configured chat; old process cannot erase new state |
| Renderer failure | Backend producer diagnostics remain in JSONL |

## 7. Validation ladder

Use claim-matched proof:

```text
source inspection
→ syntax/static checks
→ focused contract tests
→ affected integration tests
→ Electron runtime smoke
→ real provider/model capability test
→ real exact-chat browser loop
→ deliberate missing-document autonomy case
→ deliberate browser/recovery failure case
→ rendered-delivery verification
→ restart/recovery/no-duplicate case
→ user-visible walkthrough
```

A lower level cannot justify a higher-level claim.

## 8. One isolated local E2E proof required before DONE

The final runtime proof must be one correlated real interaction:

```text
user exact chat
→ managed Chrome/dynamic CDP
→ exact target verification
→ instruction capture
→ local reasoning turn
→ governed tool call
→ real tool observation
→ adaptive continuation if an observation fails/is missing
→ validation/evidence where required
→ result queue
→ browser delivery
→ rendered outcome proof
```

The diagnostic journal must reconstruct that complete causal path.

## 9. Completion predicate

This next slice is DONE only when:

- all requirements R1–R10 are implemented against active owners;
- focused and broader regression tests pass on the exact branch HEAD;
- no duplicate semantic/runtime authority was added;
- one real missing-evidence scenario proves adaptive continuation;
- selected-model tool capability is proven or truthfully unavailable;
- exact browser delivery reaches at least `SUBMISSION_ACCEPTED` and reports rendered verification separately;
- browser failure artifacts are usable;
- one JSONL session explains the full operation without needing ad-hoc extra logging;
- Recover proves exact-chat continuity without duplicate execution;
- one isolated local E2E runtime path passes;
- remaining limitations are explicitly reported.

Until that predicate is met, PR #15 remains draft and the richer agent-process UI remains deferred.
