# Remote Rebuild Completion Audit — 2026-08-14

Branch: `rebuild/fresh-ui-shell-loop-20260814`
Original clean baseline used to start the rebuild: `3ca86e5fd9a98188e9b4a1b25b3da9842806374c`
Draft review: PR #15

## Authority and claim boundary

This file is the single rebuild audit/acceptance record.

The original baseline is **not** semantic architecture authority. It is only the clean source revision from which the isolated rebuild began. Current implementation authority is the explicit rebuild contract established from current product requirements, GPT-Knowledge engineering guidance, current source ownership and evidence discovered during this audit.

Historical branches/worktrees/stashes remain requirement evidence only. They are not implementation sources to merge, cherry-pick, apply or copy.

Repository source can prove structure and contracts. Source tests can define acceptance behavior. Neither proves the real Electron/provider/Chrome/CDP loop until it is executed in one isolated local checkout. GitHub-hosted validation has previously been blocked by workflow `startup_failure` before jobs were created.

## Required architecture

```text
Reasoning agent
  owns interpretation, adaptation, tool choice and recovery
        |
        v
Governed tools / policy
  deterministic workspace and safety boundaries
        |
        v
Evidence / validation
  observations, receipts and correlation

Browser bridge
  transports exact assistant-authored envelopes
  preserves exact conversation identity
  never performs semantic task classification
```

Infrastructure lifecycle states such as `WAITING`, `EXECUTING`, `DELIVERING`, `RECOVERY` and `STOPPED` are operational truth only. They do not prescribe a semantic Plan -> Approve -> Execute workflow.

## Cross-check disposition

| ID | Original finding | Current source disposition |
| --- | --- | --- |
| A01 | Ordinary approval subsystem controlled tool execution. | **FIXED ACTIVE PATH.** `UnifiedAgentService` has no pending-approval owner; tool registry execution has no approval branch; runtime adapter/preload expose no approve/reject action. The rebuild wrapper unregisters the two historical approval IPC handlers defined by inherited `main.js`. |
| A02 | Optional Cline-style Plan -> Approval -> Execute reasoning engine remained reachable. | **FIXED ACTIVE PATH.** Provider choice changes provider only. Active runtime constructs one adaptive `LiveAgentCore`; fresh settings expose no engine switch. Historical Cline-style files may remain in the repository as inactive code but are not active owners or validation requirements. |
| A03 | Keyword/regex objective classifier prescribed capability/completion requirements. | **FIXED ACTIVE PATH.** Active reasoning receives the objective, registered tools and real observations. No regex objective classifier controls completion. Negative regression tests assert this. |
| A04 | Rejected `runCommand` could be silently replaced by a different successful workspace operation. | **FIXED.** Tool registry no longer substitutes semantic/native fallbacks. Governed command executes exactly or returns its exact denial/failure observation. stdout and stderr remain distinct evidence. |
| B01 | Exact-chat opener and relay used independent `ProviderChannel` state. | **FIXED ACTIVE PATH.** Rebuild entrypoint installs one shared observable browser channel for exact open, target validation, instruction capture and delivery. |
| B02 | Any HTTP/HTTPS page was treated as a valid chat; instruction capture read whole page body. | **FIXED.** Normal loop currently supports an explicit ChatGPT adapter and assistant-message selector. Unsupported pages may appear in diagnostics but cannot be selected for execution. Empty/new chats remain valid because selector provenance and message presence are separate facts. |
| B03 | Restart could silently mark an unprocessed instruction historical. | **FIXED CONTRACT.** Persistent transport journal records instruction and loop state. First-start historical baseline is explicit; later unseen instructions are not silently consumed. Ambiguous executing/delivering states become `INSTRUCTION_RECOVERY_REQUIRED`, never automatic replay. |
| B04 | Typed direct command transport was absent. | **FIXED.** `TYPE: quick_command` goes directly to the governed terminal, bypasses the reasoning model and returns exact command/cwd/stdout/stderr/exit/receipt evidence. |
| B05 | Local execution result could disappear on crash before browser delivery. | **FIXED CONTRACT.** Durable journal now records `result_queued -> delivering -> delivered / delivery_unverified / delivery_failed`. A queued result can be restored after browser/target replacement without repeating local execution. |
| B06 | CDP target ID was part of durable dedupe identity. | **FIXED.** Transport identity uses workspace + exact conversation + transport identity + raw envelope hash. Target ID is evidence, not semantic transport identity, so Reset can replace the target without making an old instruction new. |
| B07 | `SEND_NOT_CONFIRMED` was automatically retryable after a potentially successful submit. | **FIXED.** Post-submit ambiguity is `delivery_unverified`; it is never automatically resent. Only clearly pre-submit/transient states are retryable. |
| O01 | Structured diagnostics alone did not guarantee raw foreground process stdout/stderr. | **FIXED SOURCE CONTRACT.** `start:trace` uses an external launcher/spool and the rebuild entrypoint ingests those records into the diagnostic session; internal stdout/stderr capture remains fallback. Runtime execution is still pending local proof. |
| O02 | Browser failure artifacts could contain raw page text/screenshots without explicit privacy state. | **FIXED SOURCE CONTRACT.** Default DOM evidence is minimized and excludes chat body text. Screenshots are disabled by default and require explicit environment opt-in; artifacts carry privacy metadata. |
| P01 | Reachable provider could still execute without matching model/tool capability proof. | **FIXED ACTIVE PATH.** Agent runtime blocks execution unless the active provider/model identity has matching `agent_ready` evidence. Browser relay start re-probes through preload and BrowserSessionAuthority independently refuses start unless active provider status is `agent_ready`. |
| T01 | Target provenance was incomplete. | **FIXED SOURCE CONTRACT.** Target records retain provider/configured URL/selection/validation provenance and exact conversation checks are repeated before delivery. |
| U01 | Deterministic Stop All was absent. | **FIXED UI SOURCE.** Fresh renderer provides Stop All through the existing authority and stops Access-owned relay, current agent/runtime, managed Chrome and Access terminal only. |
| U02 | Saved provider configuration caused implicit model/health contact during application startup. | **FIXED SOURCE CONTRACT.** Normal provider installation is passive and performs zero model-list/health network requests. `Discover` is an explicit single discovery attempt. `Use`/Test and browser-dependent work trigger bounded readiness only when the provider is actually needed. An unreachable provider remains silent after that action until a later explicit provider-dependent action retries. |
| U03 | Runtime and Browser Loop exposed duplicate preparatory lifecycle buttons and a competing local task composer. | **FIXED SOURCE CONTRACT.** Browser conversation is the normal instruction owner. The renderer preload no longer exposes manual `agentRun`; the local Run-task/Ctrl+Enter path is inactive/hidden. Exact Chat URL + one stateful Start/Stop is the normal path. Start demand-activates runtime, opens/verifies the exact chat and attaches the relay; Reset/Stop All remain recovery controls. |
| U04 | Strict CSP startup was violated by layout code writing CSS variables through `documentElement.style`. | **FIXED KNOWN PRODUCER.** `RebuildShell` now mutates the permitted same-origin `:root` stylesheet rule through CSSOM and the CSP remains `style-src 'self'`. Live trace must verify whether any independent CSP producer remains, especially terminal rendering. |
| U05 | Managed Chrome required a user-selected profile even though CDP ownership was intended to be internal. | **FIXED SOURCE CONTRACT.** Managed Chrome now uses a persistent Access-owned default profile when no override is configured and still launches with `--remote-debugging-port=0`; `DevToolsActivePort` is discovered dynamically. Custom profile/executable remain optional advanced overrides. |
| R01 | Task-state bridge still represented semantic classification architecture. | **FIXED ACTIVE PATH.** The compatibility-named bridge is transport-only: no semantic router, no task-state lifecycle inference and no semantic IPC registration. |

## Adaptive agent contract

A tool outcome such as:

```text
NOT_FOUND
EMPTY
FAILED
UNAVAILABLE
TIMEOUT
```

is an observation, not automatic task failure. It returns to the reasoning model, which can choose another relevant registered capability, inspect alternate evidence, revise its approach or report a real blocker when no truthful continuation exists.

The agent must not silently stop because an expected document is absent. A real blocker must be stated and supported by evidence.

No private model chain-of-thought is persisted or exposed. User-visible reasoning later should consist only of concise decision/progress summaries grounded in runtime events.

## Browser transport contract

Normal path:

```text
exact supported chat URL
-> explicit Start
-> demand-start internal runtime if inactive
-> provider/model capability probe
-> Access-owned managed Chrome profile
-> OS-assigned dynamic CDP port
-> exact target creation from pasted URL
-> composer + conversation identity verification
-> assistant-selector provenance
-> relay WAITING
-> new structured browser instruction
-> durable transport observation
-> ordinary adaptive reasoning instruction OR quick_command
-> local evidence/result record
-> durable result queue
-> browser submission
-> rendered same-conversation verification
-> WAITING
```

Normal startup does **not** require Start Chrome, target enumeration, target dropdown selection, CDP port selection, profile selection, local Run task or a second copy of the instruction.

Delivery evidence levels remain distinct:

```text
TEXT_INSERTED_PENDING
SUBMISSION_ACCEPTED
RENDERED_DELIVERY_VERIFIED
```

`SUBMISSION_ACCEPTED` is never presented as rendered delivery. `SEND_NOT_CONFIRMED` or missing rendered proof is not automatically resent because a resend could duplicate a real browser side effect.

## Durable recovery contract

Instruction/result journal states include:

```text
observed
executing
result_queued
delivering
delivered
delivery_unverified
delivery_failed
failed
```

Rules:

- `result_queued` may be restored after restart/Reset and delivered without repeating local work;
- `delivered` is not replayed;
- `executing` and `delivering` are ambiguous side-effect boundaries and require recovery review rather than automatic replay;
- `delivery_unverified` is never automatically resent;
- target replacement does not reset instruction identity;
- explicit Stop may defer a durable queued result rather than destroying it.

## Provider truth contract

The UI/runtime distinguish:

```text
unconfigured
unavailable
reachable_unverified
capability_failed
agent_ready
```

Agent execution and Browser Loop WAITING require matching `agent_ready` proof for the currently active provider/model. Runtime/provider replacement invalidates old capability evidence.

Provider connectivity is **event-driven**:

```text
app boot / idle status polling
-> zero provider network requests

Discover click
-> one model-discovery request
-> success OR one visible failure
-> stop; no background retry

Use / Test / provider-dependent browser action
-> passive provider install
-> bounded readiness attempt
-> if the first completion cannot connect, stop immediately
-> success OR one visible failure for that action
-> no background retry

later explicit provider-dependent action
-> new bounded attempt is allowed
```

There is no idle provider heartbeat, model polling, health polling, retry timer or exponential reconnect loop. A provider failure must correspond to a concrete user/runtime action. Failure does not permanently suppress future attempts; it only ends the current action's provider contact.

## Diagnostic truth contract

One chronological diagnostic session is intended to correlate:

- foreground process stdout/stderr and exit;
- Electron main/renderer lifecycle;
- UI clicks and relevant changes;
- IPC request/success/failure/duration;
- provider discovery, capability probes and native request metadata;
- managed Chrome/CDP/target lifecycle;
- instruction/delivery journal transitions;
- operation/session/turn/tool-call/delivery IDs;
- tool observations and receipts;
- terminal stdout/stderr/exit;
- browser delivery attempts and rendered verification;
- recovery and user/setup failures.

Credentials, tokens, cookies and private chain-of-thought must not be persisted. Ambiguous failure causes remain `UNKNOWN` instead of being guessed.

Repeated local `ide:status`, module-registry status and diagnostic/log reads are expected observability traffic. They are acceptable while idle provided they do not trigger provider network contact, browser startup/target enumeration or agent execution.

## Active UI contract

Normal Browser Loop usage is deliberately minimal:

- exact Chat URL;
- one stateful `Start` / `Stop` control;
- status/evidence.

`Reset attachment`, `Check once`, `Reset runtime` and `Stop All` are recovery/diagnostic controls, not normal startup steps. Manual Start Chrome / Refresh tabs / target dropdown / Use selected tab are not active user workflow.

The browser conversation is the instruction owner. The local workbench does not ask the user to type the objective again and does not start an independent local planning session. After Start succeeds, the agent waits for the browser instruction.

Runtime is an internal authority, not a preparatory user workflow. Browser Loop Start activates it on demand when inactive. Runtime health remains visible, and `Reset runtime` remains available only as an advanced recovery action.

Managed Chrome uses an Access-owned profile and dynamic CDP port by default. A custom profile/executable is an optional advanced override. The exact pasted chat URL, not an existing arbitrary tab or fixed port, owns the attachment flow.

Saved URL/provider values are passive. Opening the app must not start Chrome, attach an old target or silently contact/discover provider models. Idle status refresh must not generate provider traffic.

Strict CSP remains `style-src 'self'`. Layout persistence/resizing must not use element-inline style writes. If terminal/xterm or another component still produces CSP violations in live trace, that producer must be identified separately rather than enabling `unsafe-inline`.

The richer user-facing agent-process projection remains deferred until the browser/local loop is proven from a real correlated log.

## Source validation status

The repository validation contract now contains negative regressions for removed architecture rather than tests that preserve it:

- no semantic objective classifier;
- no semantic command fallback/substitution;
- no active Cline-style reasoning engine;
- no semantic task-state bridge;
- no approval API in the preload surface;
- no renderer-facing manual `agentRun` instruction path;
- explicit supported chat adapter and assistant provenance;
- exact-URL browser ownership instead of mandatory target dropdown selection;
- agent-ready browser-start gate;
- event-driven provider contact with passive boot/configuration and explicit discovery/readiness attempts;
- demand-driven internal runtime activation from Browser Loop Start;
- one stateful Browser Loop Start/Stop control with recovery controls separated from normal startup;
- Access-owned default Chrome profile plus OS-assigned dynamic CDP port;
- strict-CSP layout sizing without element-inline CSS variable mutation;
- adaptive continuation after missing evidence;
- quick-command bypass of reasoning;
- durable queued-result recovery across target replacement;
- no automatic retry after ambiguous post-submit state;
- rendered delivery remains separate from submission acceptance;
- minimized browser evidence/privacy metadata.

These are **source assertions only until executed**.

## Remaining blockers before local pull

No known product feature from the current pre-local-validation contract is intentionally left for another implementation pass. Remaining work is verification, not feature expansion:

1. final source scan/compare of active owners and changed files;
2. inspect latest GitHub Actions run; if it still has `startup_failure`/zero jobs, hosted validation remains BLOCKED;
3. one isolated Windows checkout only after remote source freeze;
4. full `npm run check`;
5. launch through `npm run start:trace` and verify idle boot generates zero provider network failures;
6. verify startup CSP log after the layout producer change; if violations remain, identify the exact remaining producer; — **RESOLVED BY EVIDENCE** (see CSP closure section below): remaining producer identified as `@xterm/xterm` v6 terminal renderer; classified as a known non-fatal dependency CSP incompatibility; strict CSP retained; `unsafe-inline` not added;
7. verify the local Run-task/Ctrl+Enter path is not active and the browser conversation is the only normal instruction source;
8. leave custom Chrome profile blank, paste exact ChatGPT URL and verify one Start automatically activates runtime, launches the Access-owned profile on a dynamic port, opens/verifies the exact chat and enters truthful WAITING without Start Chrome/Refresh tabs/target selection;
9. verify Start changes to Stop while running and Stop ends the relay without requiring global teardown;
10. verify Reset attachment rebuilds browser/relay identity without duplicate execution; Stop All tears down all Access-owned resources;
11. with LM Studio unavailable, click Discover once and verify exactly one discovery failure followed by silence;
12. start a later provider-dependent action and verify it makes a new bounded readiness attempt rather than relying on background retries;
13. real LM Studio or Cline capability proof;
14. ordinary browser instruction -> adaptive tools -> result -> rendered same-chat proof;
15. missing-document case -> alternate reasoning action, not silent stop;
16. quick_command -> exact stdout/stderr/exit/receipt and zero reasoning invocation;
17. crash/restart tests around `result_queued` and ambiguous `delivering` states;
18. deliberate user/setup/provider/browser failure classification;
19. inspect complete JSONL and browser artifacts for truthfulness/privacy;
20. separately reproduce/resolve the Windows `node-pty` ConPTY helper `AttachConsole failed` defect without conflating it with browser-loop acceptance.

Until those live steps pass, PR #15 stays draft and no runtime-success claim is valid.

## CSP startup-violation closure (evidence finding)

```
STATUS: RESOLVED BY EVIDENCE
CATEGORY: KNOWN DEPENDENCY CSP INCOMPATIBILITY
SECURITY DECISION: STRICT CSP RETAINED
RUNTIME IMPACT: NONE OBSERVED
```

### Finding

The startup CSP violations were isolated and confirmed on Windows against the canonical head (`Browser Agent_R3_CANONICAL`). The session diagnostic log shows a healthy boot and no functional failure:

- app boot succeeds (`app_ready` -> `browser_window_created`);
- terminal subsystem succeeds (`ide:terminal-create` success; PowerShell stdout flows);
- renderer boot succeeds (`renderer_boot` success; `did_finish_load` success);
- every startup violation is an inline `style-src 'self'` rejection, not a script/connect failure.

### Producer

`@xterm/xterm` v6 terminal renderer (including its DOM-renderer path). It writes ~40+ dynamic computed-geometry inline styles (canvas/screen/textarea/viewport/composition/decoration pixel positions and cell sizes) at render time. These appear as non-fatal red entries in the Problems / Complete Log panel.

### Why no strict-CSP fix was applied

- the geometry is computed at runtime, so static hashes or CSS classes cannot represent the values;
- the `dom` renderer path also writes inline styles and does not help;
- removing the writes requires patching the minified `node_modules` dependency, which violates dependency-ownership/change rules and breaks on any xterm upgrade.

### Decision

- keep `style-src 'self'`;
- do not add `unsafe-inline`;
- accept the known non-fatal xterm CSP console noise (it does not block terminal operation).

### Revisit conditions

Re-open this finding only if one of the following occurs:

- `@xterm/xterm` upstream ships a CSP-compatible renderer;
- the terminal implementation is replaced;
- security requirements for the renderer change.

### Next verification target

CSP is closed as an **evidence finding, not an implementation task**. The next verification target returns to the original rendered delivery flow (audit item 14):

```text
launch patched build
-> create browser instruction
-> provider sends
-> rendered envelope observed
-> RENDERED_DELIVERY_VERIFIED
-> runtime state becomes rendered_verified
```
