# Rebuild Pre-Implementation Agent Truth + Observability Contract — 2026-08-14

Branch: `rebuild/fresh-ui-shell-loop-20260814`
Status: **MANDATORY DESIGN CONTRACT — implementation must conform before local validation**

## 1. Purpose

This document freezes the behavioral contract for the next implementation slice before any code change is made.

The immediate goal is not visual polish. It is to prove that the browser/local reasoning loop behaves truthfully and adaptively, and that one complete chronological diagnostic record can explain failures without repeated manual debugging.

The required architecture is:

```text
user / browser instruction
        ↓
transport preserves identity + message
        ↓
reasoning agent receives observation/objective
        ↓
agent dynamically reasons and chooses useful capabilities
        ↓
governed runtime executes selected capability
        ↓
real observation returns to the agent
        ↓
agent re-evaluates objective and adapts
        ↓
validation/evidence where required
        ↓
result delivery to exact originating chat
```

A lifecycle state machine may describe infrastructure state, but it must never replace the model's semantic reasoning loop.

---

## 2. GPT-Knowledge authorities applied

This contract incorporates the following reusable guidance:

- `000_START_HERE.md`
- `project-engineering/project-feature-implementation-plan.md`
- `ai-agents/unified-agent-engineering-methods.md`
- `ai-agents/agent-reasoning-transport-boundary.md`
- `ai-agents/professional-agent-runtime-cli-and-provider-architecture.md`
- `ai-agents/repeated-audit-failures-and-corrective-method.md`
- `ai-agents/studies/lbe-completion-contract-and-validation-evidence-study.md`
- `browser-agents/browser-access-tooling-and-evidence.md`
- `local-models/lm-studio-runtime-and-agent-integration.md`
- `letterblack-branding/industrial-dark-ui-system.md`
- `letterblack-branding/ui-screen-system.md`

Live repository/runtime evidence remains higher authority than these documents.

---

## 3. Target lock

Project/repository:

`Letterblack0306/Accecc_Browser_Agent`

Implementation branch:

`rebuild/fresh-ui-shell-loop-20260814`

Selected implementation baseline:

`3ca86e5fd9a98188e9b4a1b25b3da9842806374c`

Current branch purpose:

- rebuild product-facing shell/UI without restoring historical workbench code;
- preserve current reasoning/runtime/provider authority;
- create a reliable exact-chat browser/local execution loop;
- expose complete truthful diagnostics;
- prove adaptive reasoning before adding richer user-facing agent-process projection.

Historical PTY/UI/workbench branches are requirement references only. They are not implementation sources.

---

## 4. Feature learning record

### Purpose

Allow a user to provide an exact chat URL, start a dedicated managed browser/runtime loop, have a local reasoning agent dynamically act through governed tools, and deliver the result back to that exact conversation with complete correlated evidence.

### Current authoritative owners to preserve/extend

- reasoning/provider execution: `AgentRuntimeAdapter` → `UnifiedAgentService` / active reasoning runtime;
- browser transport: `BrowserInstructionRelay` + `BrowserSessionAuthority` + `ProviderChannel`;
- browser process: `ManagedChrome`;
- workspace execution: current governed workspace/tool runtime;
- terminal: `PtyTerminalManager` with explicit fallback;
- preferences: `IdePreferences`;
- visible state: fresh `rebuild-runtime-state.js` projection;
- diagnostics: `RuntimeDiagnosticLog` plus producer instrumentation;
- shell/UI: fresh rebuild shell and renderer only.

### Known defects/gaps before the next slice

1. Diagnostic schema exists, but producer-side coverage and mandatory causal correlation are not yet proven across every subsystem.
2. Browser submission acceptance is not sufficient proof that the result visibly appeared in the exact intended conversation.
3. Failure-time DOM/visual browser artifacts are not yet a required evidence output.
4. Provider readiness currently risks being interpreted too strongly if only connectivity/completion is proven; selected-model tool capability must be independently established.
5. Agent autonomy must be regression-tested so `NOT_FOUND`, `EMPTY`, `FAILED`, or `UNAVAILABLE` tool observations return control to reasoning instead of becoming semantic task failure.
6. The primary future agent UI must show ordered runtime interaction rather than a scripted step/card dashboard.

---

## 5. Core autonomy invariant

### Mandatory rule

> A tool observation of `NOT_FOUND`, `EMPTY`, `FAILED`, `UNAVAILABLE`, `TIMEOUT`, or another non-terminal observation must return control to the reasoning agent unless a deterministic policy/security/runtime boundary makes continued execution impossible.

A failed tool call is evidence about that tool/action. It is not automatically evidence that the objective failed.

### Required observation vocabulary

Tool/runtime observations should distinguish at least:

```text
FOUND
NOT_FOUND
EMPTY
UNAVAILABLE
PERMISSION_DENIED
FAILED
TIMEOUT
INVALID_REQUEST
CANCELLED
```

These are observations, not semantic task conclusions.

### Correct behavior example

```text
workspace.read("docs/architecture/runtime.md")
→ NOT_FOUND

agent receives observation
→ searches active source/registry/runtime
→ finds another relevant owner
→ continues objective
```

### Forbidden behavior

```text
document missing
→ semantic task FAILED
→ reasoning loop stops silently
```

### Legitimate terminal conditions

The reasoning task may stop only when one of the following is actually established:

1. the objective is completed and claim-matched validation is satisfied;
2. the user cancels;
3. a hard policy/security boundary forbids required continuation;
4. a required capability/data dependency remains genuinely unavailable after bounded discovery;
5. continuing would require inventing consequential facts;
6. the runtime itself is unusable and cannot safely recover.

When blocked, the agent must report the exact blocker and evidence. Quiet stopping is prohibited.

---

## 6. Infrastructure state is not semantic reasoning

Infrastructure lifecycle states may include:

```text
STOPPED
STARTING_BROWSER
OPENING_CHAT
VERIFYING_CHAT
ATTACHING
WAITING_FOR_INSTRUCTION
EXECUTING
RESULT_QUEUED
DELIVERING
RECOVERING
STOPPING
DEGRADED
BLOCKED
```

These states exist for:

- UI truth;
- cancellation;
- retry/recovery;
- persistence;
- diagnostics;
- delivery semantics.

They must **not** prescribe a fixed reasoning sequence such as:

```text
READ → SEARCH → PATCH → TEST → COMPLETE
```

The agent chooses actions dynamically from the live capability set and observations.

---

## 7. Exact-chat loop contract

### Normal user workflow

The normal surface requires only:

1. configured reasoning provider;
2. exact chat URL;
3. Start.

Start performs:

```text
validate configured chat URL
→ start dedicated managed Chrome
→ use OS-selected CDP port
→ discover actual DevTools endpoint
→ open exact supplied URL
→ capture created targetId
→ wait for page readiness
→ verify expected conversation identity + usable composer
→ bind relay to that exact target
→ enter WAITING_FOR_INSTRUCTION
```

Normal operation must not guess among arbitrary existing tabs.

Manual target selection remains an advanced diagnostic/recovery capability only.

### Recover

`Recover` is a deterministic recovery operation, not a simple reload:

```text
stop relay/polling
→ stop only the managed browser owned by this runtime
→ invalidate stale endpoint/target state
→ launch a fresh managed browser
→ discover fresh dynamic CDP endpoint
→ reopen exact configured chat URL
→ verify identity + composer
→ bind new targetId
→ resume WAITING_FOR_INSTRUCTION
```

No silent fallback to a different chat is permitted.

---

## 8. Browser identity and rendered-delivery proof

### Stored browser identity

Maintain:

```text
browserInstanceId
configuredChatUrl
conversationIdentity
targetId
initialUrl
currentUrl
createdAt
lastSeenAt
lastVerifiedAt
```

### Conversation identity

Query strings/fragments may vary without changing the conversation when the provider's stable conversation identity remains the same. A changed conversation path/ID must be treated as a target-identity change.

### Delivery evidence levels

Do not collapse these into one status:

```text
TEXT_INSERTED
SUBMISSION_TRIGGERED
SUBMISSION_ACCEPTED
RENDERED_DELIVERY_VERIFIED
```

`SUBMISSION_ACCEPTED` is not the same as `RENDERED_DELIVERY_VERIFIED`.

For browser-originated work, the strongest completed-delivery claim requires confirmation that the intended result visibly appeared in the exact intended conversation or another provider-specific rendered postcondition was observed.

If rendered confirmation cannot be collected, report the weaker evidence honestly.

---

## 9. Browser failure artifacts

Browser failures must create evidence sufficient for direct diagnosis.

Automatic evidence capture should occur for at least:

```text
CHAT_VERIFICATION_FAILED
CHAT_IDENTITY_CHANGED
COMPOSER_NOT_FOUND
SEND_BUTTON_UNAVAILABLE
SEND_NOT_CONFIRMED
TARGET_LOST
DELIVERY_FAILED
RECOVER_FAILED
```

When technically available, capture:

- current URL/title;
- DOM/accessibility snapshot or bounded relevant DOM evidence;
- screenshot;
- console errors relevant to the operation;
- target/browser identity;
- timestamps and causal IDs.

A successful exact-chat verification may also capture one bounded baseline artifact for comparison.

### Artifact metadata

```text
artifactId
sha256
path/reference
capturedAt
sessionId
turnId
operationId
toolCallId
browserInstanceId
targetId
url
artifactType
redactionState
```

Screenshots/log artifacts must not expose credentials or secrets.

---

## 10. Complete chronological diagnostic journal

Each app run creates one append-only JSONL session journal.

Every operational record contains:

```text
schema
seq
timestamp
sessionId
source
category
action
phase
severity
classification
durationMs
correlation
data
error
artifactRefs
```

### Required classifications

```text
USER_SETUP
ENVIRONMENT
PROVIDER
BROWSER
TARGET
TRANSPORT
AGENT
TOOL
WORKSPACE
UI
INTERNAL
UNKNOWN
```

Do not guess a classification when evidence is insufficient; use `UNKNOWN`.

### Mandatory producer-side logging

The diagnostic file must not depend on renderer survival.

Producers must write their own important events directly to the diagnostic sink while also emitting UI events where applicable:

```text
Agent Runtime ─────┬→ diagnostic sink
                   └→ UI event channel

Browser Relay ─────┬→ diagnostic sink
                   └→ UI event channel

Provider Adapter ──┬→ diagnostic sink
                   └→ UI projection

Terminal ──────────┬→ diagnostic sink
                   └→ UI terminal stream

Browser Authority ─┬→ diagnostic sink
                   └→ UI state projection
```

The UI is a consumer of evidence, not the owner of evidence existence.

---

## 11. Mandatory causal correlation

For the real browser→agent→tool→browser path, correlation is not optional.

Create/propagate stable IDs such as:

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
providerRequestId
```

Every subsystem should preserve the IDs applicable to its portion of the operation.

The Complete Log must permit one instruction to be reconstructed as:

```text
browser instruction captured
→ reasoning turn created
→ tool call(s)
→ tool observation(s)
→ agent continuation/adaptation
→ validation/evidence
→ result queued
→ delivery attempt(s)
→ rendered-delivery verification or explicit weaker/failure state
```

---

## 12. UI interaction diagnostics

All normal user interactions that can change behavior/state should emit diagnostic events, including:

- clicks;
- view/tab changes;
- Start/Stop/Recover;
- model selection;
- provider configuration changes;
- chat URL changes;
- browser settings changes;
- workspace selection;
- terminal lifecycle operations;
- validation actions.

Sensitive input contents are redacted. Safe identifiers/state may be logged.

Every renderer→main IPC operation should record:

```text
START
SUCCESS + duration + bounded result summary
or
FAILED + duration + exact error
```

---

## 13. Provider/model capability proof

Provider readiness is evaluated at:

```text
provider + endpoint + selected model
```

Do not present a model as agent-ready merely because:

- TCP connection succeeds;
- `/v1/models` succeeds;
- the model appears in inventory;
- a simple text completion returns `READY`.

For a tool-using agent, health/capability evidence should distinguish at least:

```text
serverReachable
authenticationAccepted
modelsEndpointResponsive
selectedModelAvailable
completionVerified
toolCallingVerified
structuredOutputVerified | unsupported | unknown
contextWindowKnown | unknown
coldStartMs
inferenceMs
checkedAt
failureReason
```

A model that completes text but cannot reliably issue/continue a real tool call must not be labeled fully agent-ready.

Preserve provider-native diagnostics when available:

```text
providerId
modelId
providerRequestId
providerEventType
providerStopReason
rawDiagnosticRef
```

The normalized runtime event model must not erase useful native failure evidence.

---

## 14. Tool-call autonomy acceptance cases

Before accepting the reasoning loop, prove at least these cases:

### A — Missing expected document

Instruction references a nonexistent document.

Expected:

- tool returns `NOT_FOUND`;
- agent receives the observation;
- agent attempts another relevant evidence source/capability;
- agent continues without a scripted failure transition.

### B — First tool action fails

Expected:

- exact failure is observed;
- agent reasons over it;
- agent selects another useful action when one exists.

### C — Search is empty

Expected:

- zero results remain an observation;
- task does not automatically become failed or complete.

### D — Expected implementation owner absent

Expected:

- agent performs bounded owner/capability discovery before claiming the feature is unavailable.

### E — Genuine blocker

Expected:

- agent performs bounded discovery;
- no valid alternative exists;
- agent reports `BLOCKED` with exact missing dependency and evidence.

### F — Alternate evidence sufficient

Expected:

- agent continues without unnecessary user interruption.

### G — Retry without duplicate side effect

Expected:

- transport/runtime retry does not cause duplicate mutating tool execution;
- stable operation/tool identities allow replay protection.

---

## 15. Completion truth

Keep these responsibilities separate:

```text
requirement / completion contract
        !=
producer/tool execution
        !=
validation evidence
        !=
completion decision
        !=
browser delivery proof
```

Examples:

- command exit `0` proves that command succeeded under its contract, not that the task is semantically complete;
- a passing focused test proves that test, not necessarily the live UI/runtime path;
- browser submission acceptance proves submission acceptance, not rendered delivery;
- model prose saying "done" is not authoritative completion truth.

The UI and diagnostics must preserve these distinctions.

---

## 16. Future user-facing agent-process view

Do **not** implement this until the real loop and diagnostic evidence are proven locally.

When implemented, the primary surface should project ordered runtime interaction such as:

```text
User instruction
Agent commentary / concise decision summary
Active tool invocation
Live tool/process output
Tool observation
Agent adaptation/reaction
Edits/diffs
Validation/evidence
Final response
```

Avoid a rigid card/state dashboard such as:

```text
Step 1 complete
Step 2 working
Validation 65%
```

Infrastructure health belongs in compact secondary chrome/views.

Do not expose private chain-of-thought. Expose concise user-facing reasoning summaries, actions, observations, blockers, receipts, and evidence.

---

## 17. Pre-implementation gate

Before code changes for this slice begin, confirm:

- [x] target branch/repository is locked;
- [x] no historical branch code will be merged/cherry-picked/applied;
- [x] GPT-Knowledge implementation, agent, browser, provider, completion, and corrective references were audited;
- [x] missing-document/tool-failure continuation behavior is explicitly specified;
- [x] exact-chat identity and Recover behavior are specified;
- [x] diagnostic producer/correlation requirements are specified;
- [x] rendered-delivery evidence is distinguished from submission acceptance;
- [x] browser failure-artifact requirements are specified;
- [x] provider/model capability proof is specified;
- [x] completion claim boundaries are specified;
- [ ] implementation and tests have been updated to satisfy this contract;
- [ ] one clean isolated local runtime path has proven the contract.

---

## 18. Implementation order after this document is committed

Implement in this order:

1. producer-side diagnostic sink wiring;
2. stable causal correlation propagation;
3. normalized observation semantics returning non-terminal failures to reasoning;
4. autonomy regression tests for missing/failed evidence;
5. provider/model capability probe and diagnostic metadata preservation;
6. rendered browser-delivery verification;
7. bounded failure DOM/screenshot artifacts;
8. Complete Log linkage to artifacts/correlation;
9. focused and broader source/contract validation;
10. freeze branch for one isolated local E2E run;
11. only after that proof, design/implement the richer agent-process UI.

No additional visual feature work should precede this sequence.

---

## 19. Completion predicate for this slice

This slice is not complete until one isolated real runtime session proves:

1. exact configured chat URL opens in a dedicated managed browser on a dynamically discovered CDP endpoint;
2. exact conversation identity is verified;
3. loop reaches truthful `WAITING_FOR_INSTRUCTION`;
4. one instruction creates a traceable reasoning turn;
5. the agent performs real governed tool work;
6. at least one deliberately missing/failed evidence observation is handled adaptively without scripted task termination;
7. provider/model tool capability is proven or truthfully reported unsupported/unknown;
8. every relevant boundary shares causal identifiers in one diagnostic journal;
9. result delivery progresses through explicit delivery evidence states;
10. rendered delivery is verified, or the UI/log reports the strongest weaker evidence actually obtained;
11. a browser failure produces correlated diagnostic artifact evidence;
12. Recover re-establishes a fresh browser/target without sending to another conversation;
13. no duplicate mutating action occurs across retry/recovery;
14. any genuine blocker is surfaced explicitly rather than silently stopping;
15. the resulting JSONL alone is sufficient to identify whether a test failure originated in user setup, provider, browser/target, transport, agent, tool/workspace, UI, or remains unknown.

Until this predicate is proven, the branch remains draft and no end-to-end completion claim is permitted.
