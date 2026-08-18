# Fresh UI / Shell / Loop Rebuild Plan — 2026-08-14

## Status

Planning authority for branch `rebuild/fresh-ui-shell-loop-20260814`.

Base revision: `3ca86e5fd9a98188e9b4a1b25b3da9842806374c` (`agent/cline-provider-runtime`).

This branch exists specifically to rebuild the product-facing UI, workbench shell, and browser/local execution loop without mixing in historical implementations.

## 1. Non-negotiable isolation rules

1. Do not merge, rebase, cherry-pick, apply, or copy code from `PTY-UI`, `feat/state-driven-agent-ui`, `electron-ide`, old workbench branches, old stashes, or detached historical worktrees.
2. Historical branches/files may be inspected only to recover requirements, user-visible behavior, and lessons learned.
3. The standalone Loop Tool and prior Cline runtime logs are reference evidence only. Reimplement required behavior against the current runtime contracts rather than transplanting code.
4. Do not import the local-only commits `179ab3e` or `65f1ad4`. Their validated findings are acceptance requirements to reproduce cleanly.
5. No implementation phase starts from a UI screenshot, old file, or memory alone. Every phase begins from current source/runtime ownership and an explicit acceptance proof.
6. The bridge transports and protects information; it must not become a second semantic reasoning engine.
7. UI state must be a projection of real runtime state. The UI must not invent `running`, `complete`, `healthy`, `verified`, or delivery success.
8. A task is not product-complete merely because the local agent loop finished. Browser-originated work completes only after the result has been delivered or an explicit delivery failure is surfaced.

## 2. Evidence sources used for this rebuild

### Current repository

The current branch/runtime remains implementation authority for provider/auth/runtime contracts, workspace boundaries, agent execution, browser provider transport, terminal IPC, settings, and validation entrypoints.

### GPT-Knowledge

Use these canonical references during implementation review:

- `letterblack-branding/industrial-dark-ui-system.md`
- `letterblack-branding/ui-screen-system.md`
- `ai-agents/unified-agent-engineering-methods.md`
- `ai-agents/agent-reasoning-transport-boundary.md`

Key rules carried into this rebuild:

- research before conclusion and proof before plan;
- establish revision/workspace identity before editing;
- trace user-visible behavior to the active runtime owner;
- agents reason, bridges transport;
- completion evidence must match the claim;
- the UI must reflect real backend/runtime state;
- use a compact Industrial Dark cockpit rather than decorative card stacks.

### Other-agent/runtime evidence

Prior runtime analysis established requirements that must be recreated cleanly:

- inbound browser instructions must not be semantically classified as assistant replies before reaching the reasoning agent;
- queued browser results need bounded delivery retries and explicit timeout/failure evidence;
- completion must not be surfaced before write-back/delivery succeeds;
- post-navigation delivery must tolerate transient composer/target instability instead of silently losing the result;
- terminal fallback sessions must support create/write/resize/kill/dispose without null-process crashes;
- UI mounting must have one deterministic owner rather than independent scripts racing to overwrite a module.

### Standalone Loop Tool behavior reference

The new integrated loop must preserve these user-level capabilities without copying the old GUI implementation:

1. attach to an explicitly selected/local Chrome CDP endpoint;
2. detect a structured assistant instruction/command envelope;
3. execute only through the governed local workspace execution capability;
4. capture stdout, stderr, exit status, timeout, operation identity, and duration;
5. wrap the observation in a structured result envelope;
6. deliver the result back to the originating browser conversation;
7. repeat continuously while preventing duplicate transport execution;
8. support Start, Stop, Stop All, Check Once, visible current command, and activity/evidence state;
9. persist enough loop/session state to recover safely after restart;
10. do not depend on the legacy Browser Dev HTTP API.

## 3. Target product architecture

```text
                       ACCESS AGENT WORKBENCH

┌──────────────────────────────────────────────────────────────────┐
│ Top Bar: workspace | runtime | provider | browser | health       │
├──────────────┬──────────────────────────────┬─────────────────────┤
│ Left Context │ Primary Task / Chat / Output │ Live Agent / State  │
│ Explorer     │                              │ Browser Target      │
│ Sessions     │                              │ Tools / Routing     │
│ Files        │                              │ Evidence summary    │
├──────────────┴──────────────────────────────┴─────────────────────┤
│ Bottom Dock: Terminal | Events | Logs | Validation | Problems    │
├──────────────────────────────────────────────────────────────────┤
│ Status Bar: runtime | loop | target | operation | provider       │
└──────────────────────────────────────────────────────────────────┘
```

### Ownership layers

```text
Reasoning Agent
  AgentSessionRuntime / UnifiedAgentService / selected provider
          │
          ▼
Loop Coordinator
  operation identity, cancellation, retry budget, delivery lifecycle
          │
          ├── Governed Workspace Execution
          │
          └── Browser Transport
                ProviderChannel / browser target authority
          │
          ▼
Runtime Event / View Projection
  one normalized UI-facing state model
          │
          ▼
Workbench Shell + Views
```

There must be no independent UI-owned agent lifecycle and no semantic task classifier inside the transport path.

## 4. Fresh shell design

Recreate the shell from scratch rather than modifying the historical workbench implementation.

### Permanent structural regions

- `topbar`
- `left-context`
- `primary-workspace`
- `right-state`
- `bottom-dock`
- `statusbar`

The shell owns placement, resizing, active-view selection, persistence of panel dimensions, keyboard focus routing, and responsive collapse behavior.

Views own their content only. A view must never rewrite shell markup or mount itself by polling for a CSS selector.

### Initial views

Phase-1 primary views:

- Task / Chat
- Workspace / Editor
- Execution Monitor
- Browser / Loop
- Terminal
- Events / Reasons
- Validation / Problems
- Settings

Secondary views are added only after the primary execution loop is live-proven.

## 5. UI design system

Use the Letterblack Industrial Dark system as the design source.

### Visual direction

- base `#0b0b0c`;
- primary surface `#141416`;
- raised surface `#1c1c1f`;
- structural border `#2a2a2d`;
- main text `#e1e1e6`;
- muted text `#8e8e93`;
- Letterblack red `#ff3b3b` only for active/critical semantic signals;
- green for verified healthy/running success;
- amber for queued/waiting/warning;
- compact 28–32 px operational controls;
- thin dividers and restrained 4–6 px radius;
- no oversized decorative cards, gradients, or fake activity animation.

### Usability requirements

- primary task and response remain visible without navigation;
- Start/Stop loop state is obvious and reversible;
- current Chrome target is always named and inspectable;
- queued/delivering/failed result states are visible;
- command/tool activity is collapsible but not hidden;
- errors appear where the action occurred and in Problems/Events;
- terminal and logs do not steal focus during agent execution;
- keyboard navigation and accessible labels are required;
- panel dimensions persist but always have a Reset Layout action;
- no duplicate controls for the same runtime authority.

## 6. Single runtime-to-UI state model

Create one UI projection layer with normalized immutable snapshots/events.

Minimum state domains:

```text
workspace
runtime
provider
auth
agentSession
operation
loop
browserTarget
browserDelivery
terminal
validation
problems
```

Each displayed state must include provenance where useful:

```text
state
updatedAt
operationId/sessionId
detail/error
evidenceRef
```

UI components subscribe to the projection. They do not infer completion from button clicks or local timers.

## 7. Complete loop system

Create a fresh loop coordinator around the current agent/runtime and transport contracts.

### Loop lifecycle

```text
STOPPED
  -> ATTACHING
  -> WAITING_FOR_INSTRUCTION
  -> EXECUTING
  -> RESULT_QUEUED
  -> DELIVERING
  -> WAITING_FOR_INSTRUCTION

Any state -> STOPPING -> STOPPED
Any operation may -> DEGRADED/BLOCKED with explicit reason
```

These states describe execution/transport lifecycle only; they do not decide semantic meaning for the agent.

### Instruction intake

An inbound browser instruction must preserve:

- conversation/source identity;
- instruction/event identity;
- workspace identity;
- browser target identity;
- timestamp;
- raw instruction;
- optional prior context reference.

It is delivered to the reasoning runtime as an instruction. No reply classifier may complete it before execution.

### Duplicate protection

Deduplicate transport events by stable event/operation identity or exact captured envelope identity. Do not use semantic text similarity to decide whether the reasoning agent should see an instruction.

### Execution

Local actions flow only through registered/governed workspace tools. The loop records tool observations and validation evidence; it never equates exit code 0 with feature completion.

### Browser result delivery

Delivery has its own state and proof:

```text
queued -> attempt -> accepted/acknowledged
                    OR retryable failure -> bounded retry
                    OR terminal failure
```

Required properties:

- bounded retry count and elapsed-time budget;
- result remains addressable by operation/instruction ID;
- stop/disconnect explicitly discards or preserves queued delivery with evidence;
- no `complete` UI state before delivery acceptance for browser-originated work;
- composer/send readiness uses bounded waiting rather than a fixed tiny delay;
- navigation/target changes trigger target validation/re-resolution rules rather than silent use of stale assumptions;
- all failures become visible runtime events.

## 8. Browser target continuity

The new design must explicitly own target continuity.

Target selection records:

```text
targetId
url
title
browser/session identity
selectedAt
lastValidatedAt
```

Before instruction capture and before result delivery, validate that the target still exists and represents the intended conversation. Navigation does not automatically mean a new target, but the system must re-read target metadata and composer capability before delivery.

Do not infer provider identity solely from `http/https` URL validity.

## 9. Terminal subsystem

Recreate the terminal integration behind an explicit capability boundary.

### Native PTY available

Support:

- create;
- write;
- resize;
- kill;
- dispose;
- exit/data events.

### Native PTY unavailable

Fallback must be explicit (`fallback: true`) and every method must remain safe. `write`, `resize`, `kill`, and `dispose` must never dereference a null process object.

The UI must show that the terminal is in fallback/degraded mode rather than pretending a PTY is active.

## 10. Implementation phases

### Phase 0 — Freeze contracts before UI implementation

- map current active entrypoints and IPC/API contracts;
- document runtime/event ownership;
- create acceptance tests for the proven failure cases;
- record source-vs-runtime unknowns;
- do not alter visual files yet.

Exit gate: contract tests fail for the missing behavior for the expected reason.

### Phase 1 — New shell foundation

Create the new permanent shell, design tokens, layout manager, view registry, focus/resizer behavior, and layout persistence.

Do not plug in legacy workflow views.

Exit gate: shell smoke tests + keyboard/focus/resize tests + static screenshot/manual inspection.

### Phase 2 — Runtime view projection

Create one runtime-to-view projection and bind top/status bars plus Problems/Events.

Exit gate: deterministic projection tests; no view independently fabricates lifecycle state.

### Phase 3 — Task / Chat / Execution UI

Build the primary agent conversation, execution timeline, tool-call display, stop/cancel control, and evidence links against the projection.

Exit gate: simulated event sequence renders the correct running/blocked/failed/completed states.

### Phase 4 — Fresh loop coordinator

Implement instruction intake, operation identity, governed execution handoff, cancellation, result queue, transport dedupe, retry budget, and delivery lifecycle.

Exit gate: contract/integration tests cover duplicate instruction delivery, stop, restart/recovery, failed execution, failed delivery, and successful delivery.

### Phase 5 — Browser/Loop UI

Add target discovery/selection, explicit target identity, loop Start/Stop/Check Once, queued result state, delivery attempts, and browser health.

Exit gate: live target selection plus instruction -> local execution -> result delivery proof.

### Phase 6 — Terminal and workspace surfaces

Integrate terminal, editor/workspace, Git status, validation, and settings through explicit capabilities.

Exit gate: PTY and fallback paths both pass lifecycle tests; no terminal crash on resize/write/kill.

### Phase 7 — UX refinement

Apply Industrial Dark hierarchy, compact density, accessibility, empty/loading/error states, keyboard navigation, persistent layout, and responsive collapse rules.

Exit gate: user-facing walkthrough verifies the common workflow without hunting across panels.

### Phase 8 — Full regression and live proof

Required validation ladder:

1. source/static checks;
2. unit/contract tests;
3. integration tests;
4. Electron runtime smoke;
5. real provider/session test;
6. real Chrome/CDP instruction loop;
7. navigation during an active task;
8. result-delivery retry/failure test;
9. restart/recovery test;
10. user-visible UI walkthrough.

No merge recommendation until all claims are supported at the required evidence level.

## 11. Anti-regression / anti-drift gates

At every phase checkpoint:

- verify branch, HEAD, worktree and dirty state;
- list files changed in the phase;
- explain why each changed file belongs to the phase;
- reject unrelated formatting or cleanup;
- search for duplicate runtime/UI authorities;
- search for stale parallel entrypoints;
- run the phase acceptance tests;
- record remaining unknowns and risks;
- do not proceed when a required runtime claim is only assumed.

Before each implementation review, explicitly ask:

```text
What is PROVEN?
What is only SUPPORTED?
What is still a HYPOTHESIS?
What is UNKNOWN or BLOCKED?
Which active runtime path owns this behavior?
What user-visible proof closes this phase?
```

## 12. Explicit non-goals

This rebuild will not:

- restore `BrowserLoopController` or other deleted historical runtime owners;
- restore the old `agent-event-store`/`agent-progress-*` stack by copying it;
- restore `workbench-ux.js/css` by copying it;
- apply PTY-UI or state-driven-agent-ui commits;
- resurrect duplicate browser/server/agent runtimes merely because the old UI referenced them;
- make the browser transport classify user intent;
- treat passing source tests as proof that the visible product works.

## 13. Definition of done

The rebuild is complete only when a user can:

1. open a workspace and immediately understand runtime/provider/browser health;
2. select or attach to a browser conversation;
3. start the loop;
4. send an instruction from the browser side;
5. watch the local agent reason, use governed tools, and expose execution state;
6. receive the result back in the same intended browser conversation;
7. see delivery success or an explicit delivery failure;
8. navigate/change browser state without silently losing the result;
9. stop/restart the loop without duplicate execution;
10. use terminal/workspace/evidence views without crashes or conflicting lifecycle state;
11. verify from the UI what is actually running, waiting, blocked, failed, delivered, and validated.

Only after this live flow is proven should the branch be considered ready for merge review.
