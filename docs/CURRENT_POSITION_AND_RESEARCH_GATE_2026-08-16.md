# Access Browser Agent — Current Position and Research Gate

**Date:** 2026-08-16  
**Branch:** `refactor/browser-conversation-turn-transport-20260816`  
**Parent milestone:** Browser Conversation Turn Transport  
**Status:** `in_progress` — repository validation is green; live natural-turn ingress is proven; the remaining cross-boundary flows are intentionally research-gated before repair.

---

## 1. Purpose of this document

This document is the current architecture/evidence record for the Access Browser Agent rebuild.

It exists because the project reached a point where repeatedly running tests, fixing the next visible assertion, and rerunning the suite was no longer enough to establish that the **right system boundary** was being tested.

The operating rule from this point is:

> **Do not fix the next symptom until the complete connecting area is understood. Do not run a test unless it answers one named question with an authoritative observable and a falsifier.**

The goal is not fewer tests. The goal is **higher-information tests**.

Every remaining investigation should start from:

1. the current Access architecture and live evidence;
2. GPT-Knowledge's canonical engineering rules;
3. comparable primary implementations and real failure reports;
4. a connection map identifying which component owns which truth;
5. one explicit question;
6. one bounded acceptance case;
7. an interpretation that allows `PROVEN`, `INFERRED`, `NOT PROVEN`, or `INCONCLUSIVE` rather than forcing every run into pass/fail.

This is the anti-guessing and anti-infinite-testing gate for the remaining Browser Loop work.

---

## 2. Current milestone in one sentence

The Browser Loop has crossed from **special command transport** to **normal agent conversation transport**:

```text
normal ChatGPT assistant turn
  -> mechanical observation / provenance / identity
  -> transport ordering / dedupe / recovery
  -> continuing local reasoning-agent session
  -> optional bounded exact-chat context read
  -> governed tools
  -> result transport back to the same selected chat
```

The remaining question is no longer whether normal prose can enter the local agent. That is now live-proven.

The remaining work is to prove the **rest of the loop as a coherent lifecycle** without creating feedback loops, stale identity handoffs, false completion, or recovery ambiguity.

---

## 3. Architectural rule that now governs the rebuild

Canonical rule:

> **Agents reason; bridges transport. Governance constrains authority without becoming a second reasoning engine.**

### Agent responsibility

The reasoning agent may decide:

- what ordinary natural-language prose means;
- whether a new turn changes direction;
- whether a plan conflicts with prior architecture;
- which tool or skill is relevant;
- whether more conversational context is needed;
- whether a tool failure suggests retry, an alternative, a changed hypothesis, or a blocker;
- whether the latest request is inconsistent with the active project direction.

### Transport responsibility

The transport may deterministically enforce:

- exact selected conversation identity;
- supported provider identity;
- assistant-message provenance;
- generation-complete observation;
- turn/message identity;
- ordering;
- technical deduplication;
- crash/restart journal state;
- result correlation;
- same-target delivery;
- bounded retry policy for delivery mechanics;
- authority and workspace boundaries.

The transport must **not** decide whether ordinary prose is semantically actionable, corrective, redundant, complete, historical, or a new task.

### Explicit exception

`TYPE: quick_command` remains a structured deterministic path because it intentionally says:

```text
Do not interpret this as a normal reasoning turn.
Execute this exact governed command through the explicit quick-command boundary.
```

That is a control path, not the normal conversational path.

---

## 4. Current end-to-end connection map

The remaining architecture should be understood as distinct ownership layers rather than one large “Browser Loop”.

```text
┌──────────────────────────────────────────────────────────────┐
│  A. Selected ChatGPT conversation                           │
│  truth: exact URL / target / provider / authenticated state │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  B. ProviderChannel                                          │
│  observes assistant turns, generation state, provenance,     │
│  provider message identity, bounded conversation context     │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  C. BrowserInstructionRelay                                  │
│  technical identity, ordering, dedupe, journal, recovery,    │
│  correlation, result queue/delivery                          │
└──────────────────────────┬───────────────────────────────────┘
                           │ natural assistant text
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  D. TaskStateRouterBridge / UnifiedAgentService              │
│  transport into the reasoning runtime — no semantic router   │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  E. AgentSessionRuntime / LiveAgentCore                      │
│  continuing reasoning session, durable conversation,         │
│  tool-call loop, failure observations, completion lifecycle  │
└───────────┬───────────────────────────────┬──────────────────┘
            │                               │
            ▼                               ▼
┌──────────────────────┐         ┌─────────────────────────────┐
│ F. Protected context │         │ G. Governed capabilities   │
│ browserConversation- │         │ workspace / Git / terminal │
│ Read, exact chat only│         │ general browser / MCP etc. │
└──────────────────────┘         └──────────────┬──────────────┘
                                                │
                                                ▼
                                   ┌────────────────────────────┐
                                   │ H. Runtime evidence/result │
                                   │ terminal state + evidence  │
                                   └──────────────┬─────────────┘
                                                  │
                                                  ▼
                                   ┌────────────────────────────┐
                                   │ I. Result store / journal  │
                                   │ correlation + durable state│
                                   └──────────────┬─────────────┘
                                                  │
                                                  ▼
                                   ┌────────────────────────────┐
                                   │ J. Same-chat delivery      │
                                   │ composer submit + rendered │
                                   │ evidence                    │
                                   └──────────────┬─────────────┘
                                                  │
                                                  ▼
                                   ┌────────────────────────────┐
                                   │ K. Next-turn protection    │
                                   │ no accidental self-trigger │
                                   │ no duplicate re-execution  │
                                   └────────────────────────────┘
```

A failure at one layer must not be diagnosed as a failure of another layer without evidence.

Examples:

- a Loop Tool foreground timeout is not automatically an Electron crash;
- a stale test assertion is not automatically a runtime defect;
- a missing MCP capability is not automatically an agent reasoning failure;
- a delivered result is not automatically proven rendered in the intended chat;
- “agent completed” is not automatically equivalent to externally observed success;
- a browser target existing is not enough to prove current session identity survived a restart.

---

## 5. Current evidence ledger

### 5.1 PROVEN — repository/source layer

On exact PR head `15c2c3720e234ebedbfacbbeb092f8a6b121cbad`:

- full `npm run check` passed;
- workspace governance passed;
- workspace clone sync passed;
- workspace path guard / reader / bridge contract passed;
- agent-led adaptive checks passed;
- `agent-runtime-resilience-smoke` passed;
- general browser evals passed 6/6;
- Managed Chrome smoke passed;
- ProviderChannel smoke passed;
- BrowserSessionAuthority smoke passed;
- BrowserInstructionRelay smoke passed;
- integration smoke passed;
- all rebuild checks passed, including lifecycle, runtime state, shell, settings, diagnostics, observability, and adaptive continuation.

### 5.2 PROVEN — live Browser Loop ingress

Live diagnostics recorded a real event:

```text
browser_relay.instruction_received
providerId: chatgpt
instructionId: turn-a51547a0194bf764
```

The captured `detail` was ordinary conversational assistant prose. It did **not** require:

- `OBJECTIVE:`;
- `=== ACCESS AGENT INSTRUCTION START ===`;
- a keyword command classifier;
- an ordinary structured task envelope.

This proves that the live inbound path can observe and transport a normal assistant-authored turn.

### 5.3 PROVEN — continuing local agent relationship exists

Live agent-state diagnostics showed a persistent agent session with accumulated objective revisions and prior instructions rather than a fresh local session being created for every Browser Loop turn.

The code path also passes normal browser turns with `newSession:false`.

### 5.4 PROVEN — protected vs general browser separation in repository tests

The general browser tool runtime is separate from the protected ChatGPT transport target. General browser evals prove owned-target isolation and reject foreign target access.

### 5.5 NOT YET PROVEN end to end

The following remain open:

- a newly bounded natural turn produces a local result that is delivered and **rendered** in the same exact selected ChatGPT conversation;
- the delivered result does not become an accidental new inbound task and produce a self-trigger loop;
- exactly-once execution/delivery survives a browser or process restart;
- `browserConversationRead` is actually selected and used by the live reasoning agent when needed;
- session identity handoff remains correct when any of browser target, provider message identity, local agent process, or persisted session changes;
- non-complete states remain truthful through the whole result pipeline.

---

## 6. Mistake ledger — what went wrong during this rebuild

This section is intentionally retained. Future agents should see the mistakes, not just the cleaned-up final architecture.

### M1. We treated a transport bridge as a semantic task parser

The old BrowserInstructionRelay required special instruction wrappers and `OBJECTIVE:` extraction before ordinary text could reach the reasoning runtime.

Why it was wrong:

- the browser-side participant is already a reasoning model;
- the local agent is also a reasoning model;
- putting semantic classification between them created a second incomplete reasoning engine;
- every normal conversational correction had to be reformatted into a machine grammar.

Correction:

- ordinary assistant text now passes unchanged as an assistant turn;
- semantic interpretation belongs to the local agent;
- deterministic parsing remains only for explicit `quick_command`.

### M2. We forced fresh-session semantics on what was meant to be a continuing conversation

Normal browser turns previously used `newSession:true`.

Why it was wrong:

- it broke conversational continuity;
- the local agent could not naturally compare a new plan with the work it had already been doing;
- it increased drift because each turn looked more like an isolated task.

Correction:

- normal turns now use `newSession:false`;
- bounded conversation context can be read on demand.

### M3. We used the latest visible failure as the next architecture decision

Several cycles were effectively:

```text
run broad test
-> first failure
-> patch it
-> rerun
-> next failure
```

That was useful for regression cleanup but dangerous as architecture discovery.

Examples that were **not product architecture failures**:

- incorrect Git checkout command after `git fetch` left the worktree on the old PR17 head;
- a governance document contained equivalent content but not the required literal section names;
- the adaptive tool-resilience test still expected obsolete `waiting_for_dependency` behavior;
- the rebuild lifecycle test still asserted `inbound === "instruction"` after the new transport used `assistant_turn`;
- a foreground `start:trace` process caused the command host to time out even though Electron remained alive.

Correction:

- exact head is proven before interpreting tests;
- governance failures are classified separately from implementation failures;
- stale test contracts are compared against actual runtime architecture before patching;
- long-running launch processes are not classified as crashes from host timeout alone.

### M4. We briefly let source/tests outrun the governance record

Five implementation commits were created before the branch's change intent was registered.

Correction:

- deviation is explicitly recorded;
- later stale-test corrections were first declared in the change intent;
- the current research document is also declared before creation.

### M5. We over-focused on local components without first mapping the cross-boundary lifecycle

Browser startup, auth, relay observation, local-agent session state, tool execution, result mapping, durable delivery, and feedback suppression were often investigated as separate immediate defects.

The missing question was:

> **What identity, state, evidence, and authority must cross each boundary for the full conversation to remain coherent?**

That is now the central remaining research question.

### M6. We risked converting visible failures into silent wrong behavior

A workaround can suppress a loud failure while leaving the underlying state wrong.

Comparable real example: Hermes issue #66429 reports that suppressing a provider prefill error allowed empty assistant turns to accumulate silently in requests, poisoning context and producing repeated/empty behavior.

Access implication:

- never “fix” a feedback loop merely by suppressing a trigger event;
- never “fix” delivery ambiguity merely by retrying until something appears;
- preserve the failed state and prove the new lifecycle contract.

### M7. Terminology still carries historical architecture

The live system still emits names such as:

- `browser_relay.instruction_received`;
- `instructionType: agent_instruction`;
- `pendingInstructions`.

The behavior is now natural-turn based, but these names can mislead future reviewers into reintroducing instruction-envelope semantics.

This is a cleanup item, not an immediate functional blocker. Rename only after the remaining lifecycle is accepted so terminology work does not obscure behavior investigation.

---

## 7. What changed to reach the current architecture

### Browser/runtime ownership

- Access owns Managed Chrome startup.
- Dynamic CDP is used instead of a fixed normal-operation port.
- stale profile/port overrides were removed from the normal path.
- the managed profile was proven authenticated to the selected ChatGPT conversation.
- the exact current chat target replaced an older stale chat URL.

### UI/runtime acceptance

- state-driven UI acceptance replaced blind sleeps and coordinate assumptions;
- explicit runtime failure events fail the acceptance gate immediately;
- UI actions are followed by authoritative observable state and predicate checks.

### General browser capability

- general HTTP/HTTPS browser tools are implemented as a separate owned-target runtime;
- the protected ChatGPT transport tab is not exposed as a general agent browsing target;
- no arbitrary model-supplied JavaScript is exposed through the general tool contract.

### Natural conversation transport

- ordinary `ACCESS AGENT INSTRUCTION` / `OBJECTIVE:` parsing is no longer a prerequisite;
- normal assistant prose is transported directly;
- provider message identity is preferred for dedupe;
- fallback identity includes assistant message position/content information rather than text equality alone;
- normal turns continue the current local agent session;
- `browserConversationRead` provides bounded read-only context from the exact protected conversation;
- explicit `quick_command` remains the structured non-reasoning bypass.

### Agent resilience

- failed tools become observations returned to the reasoning loop;
- a failed tool is not automatically converted into a terminal dependency state when the agent can still adapt;
- tests now protect this behavior.

---

## 8. Why relevant external study is required again

The remaining defects are no longer isolated syntax or unit-test issues. They are **cross-layer agent-runtime problems**:

- session identity and handoff;
- context continuity and freshness;
- message/turn identity;
- exactly-once execution/delivery;
- observable external completion;
- capability discovery;
- bounded recovery;
- self-feedback suppression;
- agent-vs-transport responsibility.

These classes of problems already exist in other mature agent systems. Studying their architecture and real bug reports gives us better questions before we write another patch.

The purpose of comparison is not “copy Agent Zero” or “copy Hermes”. It is to extract:

- the invariant they were trying to preserve;
- the exact failure they observed;
- which layer actually owned the defect;
- what evidence made the diagnosis possible;
- what they deliberately did **not** claim;
- what acceptance test would have caught it earlier.

---

## 9. Reference study matrix

### 9.1 GPT-Knowledge — canonical methodology

**Role:** first architecture/method reference for this project.

Relevant rule:

> Agents reason; bridges transport. Governance constrains authority without becoming a second reasoning engine.

Current Browser Conversation guidance additionally requires:

- normal messages reach the receiving reasoning agent without semantic envelope gating;
- stable turn/message identity is preferred over text-equality dedupe;
- continuing conversation should not force a fresh local session;
- missing context should be supplied through bounded read-only conversation access;
- `quick_command` is a legitimate explicit non-reasoning exception.

**Use for Access:** architecture ownership and anti-regression criteria.

---

### 9.2 OpenAI Codex / Codex CLI — durable project context and reusable workflows

Official Codex use cases emphasize:

- understanding large codebases by tracing flows and mapping modules;
- saving repeated workflows as skills;
- maintaining durable work context;
- using scored/evaluated improvement loops for difficult problems;
- turning expected behavior into evals rather than treating ad-hoc runs as proof.

Source:

- https://developers.openai.com/codex/use-cases

**Access lesson:** do not make every Browser Agent turn rediscover the project's architecture. Stable project rules belong in durable knowledge/skills; the runtime conversation carries the current task; evals should encode a known behavior question after the contract is understood.

**Do not infer from this:** Codex's exact internal session implementation is not a reference implementation for Access unless an official source exposes it.

---

### 9.3 GitHub Agentic Workflows (`gh-aw`) — reasoning inside deterministic containment

GitHub Agentic Workflows explicitly combines an AI decision layer with deterministic GitHub Actions isolation, permissions, network controls, and Safe Outputs.

Primary references:

- https://github.github.com/gh-aw/
- https://github.github.com/gh-aw/introduction/how-they-work/
- https://github.github.com/gh-aw/introduction/architecture/
- https://github.github.com/gh-aw/reference/outcomes/
- https://github.github.com/gh-aw/index.html#gallery

Important patterns:

1. The agent reasons; the substrate constrains authority.
2. Outputs can be buffered and validated before external writes.
3. Observability preserves prompts, patches, logs, firewall activity, and result artifacts.
4. Outcome evaluation can be based on later external repository state rather than workflow self-assessment.
5. `report_incomplete` exists so infrastructure/tool failure is not misclassified as success.
6. `missing_tool` and no-op outcomes are explicit concepts rather than generic failure.

Real issue lessons studied:

- an MCP server blocked by organization policy is a configuration/capability failure; blind retry does not help;
- OpenTelemetry read vs write behavior must be tested as separate capability paths;
- absence of a readable backend can make a result **inconclusive**, not failed;
- no-op is distinct from failure.

**Access lesson:** our remaining acceptance states should include `INCONCLUSIVE` / `CAPABILITY_BLOCKED` where appropriate. Result truth should eventually be checked against external observables such as target conversation state, persisted journal state, and workspace state—not only the local agent's completion message.

---

### 9.4 Hermes Agent — session continuity, gateway boundaries, skills, and real failure reports

Primary repo:

- https://github.com/NousResearch/hermes-agent

Architecture relevance:

- multiple entry points converge on one agent core;
- gateway/platform adapters route messages and map sessions rather than duplicating the full reasoning loop;
- session persistence, tool registry, provider resolution, and platform delivery are explicit subsystems;
- skills are recommended for reusable procedures while tools are reserved for capabilities requiring runtime integration.

#### Hermes issue #82001 — stale session identity after compression

Observed failure:

- a session is compressed/rotated;
- parent session becomes closed;
- a unique live continuation exists;
- client continues submitting the stale parent session ID;
- persistence fails every follow-up turn until the identity is adopted/refreshed.

The issue explicitly distinguishes:

1. busy session;
2. closed + unique live child;
3. closed + no child.

Each requires a different recovery behavior.

It also refuses to overclaim atomicity: lookup and replay are bounded best-effort and fail closed under ambiguity.

Source:

- https://github.com/NousResearch/hermes-agent/issues/82001

**Access lesson:** a Browser Loop restart test must track the whole identity chain:

```text
provider conversation ID
provider message/turn ID
browser target generation
relay journal identity
local agent session ID
result/delivery correlation ID
```

“History still exists” is not enough. The active writer/reader must be pointing at the correct live continuation.

#### Hermes issue #66429 — empty assistant turn feedback/context poisoning

Observed failure:

- empty assistant messages accumulated in request context;
- one more was appended each retry;
- the model saw repeated empty prior assistant turns;
- tool behavior degraded and retry loops appeared;
- a workaround that suppressed a loud provider error made the wrong state quieter instead of fixing it.

Source:

- https://github.com/NousResearch/hermes-agent/issues/66429

**Access lesson:** self-feedback acceptance must inspect actual turn identities and conversation evolution. Do not merely assert “relay returned to waiting”. Prove that the result delivery is not reclassified as a fresh inbound task and that no empty/duplicate transport turn accumulates.

#### Hermes issue #17154 — architecture contracts over local fixes

The audit highlights restart continuity, session recall, tool-policy coverage, memory provenance, gateway responsibility sprawl, and output transformation auditability as system-level risks.

Source:

- https://github.com/NousResearch/hermes-agent/issues/17154

**Access lesson:** remaining Browser Agent quality depends on explicit contracts across layers, not more local conditionals.

---

### 9.5 Agent Zero — same agent across environment bridges, project isolation, recoverability

Primary references:

- https://github.com/agent0ai/agent-zero
- https://www.agent-zero.ai/p/use-cases/

Relevant patterns from the current project:

- project-scoped instructions, files, secrets, memories, repos, and model configuration;
- a host-machine/CLI connector described as a bridge to the same Agent Zero environment rather than a separate reasoning agent;
- browser capabilities integrated into the same project environment;
- snapshot/time-travel style recovery for agent work;
- visible history/evidence for browser steps and work state.

**Access lesson:** project/session identity and bridge identity should not silently create a second disconnected brain. Our Browser Loop should remain a transport into the same local reasoning relationship while project/workspace authority stays isolated.

---

### 9.6 Agent Factory — role contracts and quality gates, not transport architecture

Primary repo:

- https://github.com/agilepeter/agent-factory

Agent Factory is primarily a library/generator of specialized agent prompts and quality-gate workflows rather than a comparable runtime transport implementation.

Useful ideas:

- each role declares its deliverables;
- roles advertise how they combine with other roles;
- deterministic quality gates exist separately from the creative/agent prompt;
- generators expose dry-run/validation paths.

**Access lesson:** use this as a reference for skill/role definition and deliverable contracts, not as evidence for browser/session transport design.

---

### 9.7 Cursor 2026 agent changes — isolated subagent context, plans, environments, observable hooks

Current Cursor changelog patterns studied:

- subagents have independent context and can be specialized by prompt/tool/model;
- async subagents can run without blocking the parent;
- worktrees and cloud VMs isolate parallel changes;
- “Build in Parallel” preserves dependent-step order while parallelizing independent work;
- cloud environments can be snapshotted and reused;
- current hooks expose prompts, responses, thought/turn completion, subagent start, and compaction events;
- Slack agent behavior now exposes a plan before work and can pull context across channels while returning updates to the relevant thread.

Sources:

- https://cursor.com/changelog/2-4
- https://cursor.com/changelog/2-5
- https://cursor.com/changelog/04-24-26
- https://cursor.com/changelog/05-07-26
- https://cursor.com/changelog/cloud-in-agents-window
- https://cursor.com/changelog

**Access lesson:** context isolation and work isolation are deliberate. Parallelism is not a substitute for shared architecture truth. Observability hooks around turn completion and subagent lifecycle are relevant to our result-feedback and session-continuity acceptance.

---

### 9.8 Railly's “Agentic Second Brain” — the most relevant process postmortem

Sources:

- https://www.railly.dev/blog/agentic-second-brain
- https://www.railly.dev/blog/agentic-second-brain-four-months-later

The March system emphasized persistent context through a shared vault, `AGENTS.md`/`CLAUDE.md`, project context files, skills, and recurring-failure knowledge.

The four-month update is more important for our current stage. Its correction is effectively:

```text
memory alone is not enough
more context is not automatically better
more agents are not automatically better
agent-reported completion is not enough
```

The later system moved toward:

- thinner startup context;
- task-specific skills loaded only when needed;
- explicit task contracts;
- bounded authority;
- deterministic checks;
- evidence that records decisions, rejected alternatives, failed experiments, and verification;
- external evidence so the system does not merely agree with itself.

**Access lesson:** our earlier “keep everything in context so the agent does not drift” goal needs a refinement. The correct target is not maximal context. It is **available, attributable, selectively loaded context plus durable evidence**.

That directly supports `browserConversationRead`: recent exact-chat history should be available on demand, but the local agent should not automatically receive the entire chat transcript on every turn.

---

## 10. Cross-reference conclusions

Across these references, several patterns converge strongly enough to use as design constraints.

### C1. Conversation continuity and work authority are different things

The local agent may retain conversational continuity while the workspace/tool boundary remains deterministic and scoped.

Do not solve continuity by weakening authority.

### C2. Identity handoff is a first-class runtime contract

Any restart/rotation/replacement must explicitly answer:

- which conversation is active?
- which assistant turn is the current transport turn?
- which local agent session continues it?
- which journal entry proves execution state?
- which delivery belongs to which result?

### C3. Missing capability is not the same as failed reasoning

A missing/blocked provider, MCP server, browser target, or tool should be classified before the agent is asked to “try again”.

Configuration/policy failures require changed evidence before retry.

### C4. Completion must have an external observable

A local `completed` state is only the agent-runtime result.

For Browser Loop end-to-end completion, the relevant external observable includes the intended target conversation and durable correlation state.

### C5. Context should be available, bounded, and attributable

Do not dump the entire Browser ChatGPT transcript into every local model call.

Prefer:

```text
current turn
+ current local session context
+ relevant project knowledge/skills
+ bounded exact-chat read when the agent needs it
```

### C6. Failure evidence is future knowledge

Preserve:

- failed commands;
- stale identity states;
- rejected hypotheses;
- test failures that were actually stale contracts;
- reason a retry was not attempted;
- exact runtime/log evidence.

This is how the project avoids rediscovering the same mistakes.

### C7. More agents or more tests do not repair an unclear contract

Parallel agents can make an incorrect plan fail faster.

A broad suite can prove regression coverage while still missing the wrong cross-boundary assumption.

Architecture question first; bounded test second.

---

## 11. The new research-before-test protocol

Every remaining flow investigation must be written in this form before execution.

### 11.1 Question

One sentence only.

Example:

> After Access posts the local result into the selected ChatGPT conversation, can the relay distinguish that delivered result from a new browser-agent instruction without semantic text classification?

### 11.2 Boundary under study

Example:

```text
result store -> ProviderChannel.send -> rendered ChatGPT message -> ProviderChannel.snapshot -> BrowserInstructionRelay
```

### 11.3 Local source of truth

Identify the exact owner:

- provider message ID;
- browser target generation;
- relay journal state;
- local agent session state;
- result correlation record;
- rendered DOM observation;
- workspace state.

### 11.4 Comparable precedent

Record the external case that sharpened the question.

Example:

- Hermes #66429 for repeated assistant-turn feedback/context poisoning;
- gh-aw outcomes for external result observation.

### 11.5 Hypothesis

Example:

> The relay should consume only newly completed assistant-authored turns whose transport identity is not already represented by the delivered-result/journal correlation.

### 11.6 Falsifier

Define what would prove the hypothesis wrong.

Example:

> The same result delivery produces a new `instruction_received` event and a second local execution without a user/browser-agent turn intervening.

### 11.7 Bounded test

One test, one target, one turn, one expected state transition.

No open-ended “leave it running and see”.

### 11.8 Allowed result classes

- `PROVEN` — authoritative observable supports the claim;
- `DISPROVEN` — authoritative observable falsifies it;
- `INCONCLUSIVE` — required observation/capability unavailable;
- `BLOCKED_CONFIGURATION` — environment/policy prevents the test;
- `STALE_TEST_OR_FIXTURE` — test assumptions differ from current contract;
- `TEST_HARNESS_FAILURE` — harness failed before product boundary was exercised.

### 11.9 Next action rule

A code change is allowed only after the result identifies the faulty boundary.

Do not patch an adjacent layer to make the test green.

---

## 12. Remaining study lanes before another architecture fix

### Lane A — Outbound result lifecycle and feedback suppression

**Question family:**

- What exact identity marks a message as our delivered result?
- Can the provider expose enough mechanical identity to distinguish it from the next genuine assistant-authored turn?
- Is the browser-side agent expected to answer the delivered result, and if so, what constitutes intentional continuation vs accidental loop?
- Where is the loop terminated: provider turn identity, journal state, correlation metadata, or conversation protocol?

**References:** Hermes #66429, gh-aw outcomes/safe outputs, GPT-Knowledge transport boundary.

**Do not do yet:** add semantic “ignore result-looking text” regexes.

---

### Lane B — Session identity and restart continuation

**Question family:**

- What IDs survive relay restart, Managed Chrome restart, app restart, and local agent restart?
- If a provider-side message/target ID changes but the exact conversation is the same, what is the new live continuation identity?
- Can a stale local session ID point at a closed/obsolete continuation?
- Which ambiguity must fail closed?

**References:** Hermes #82001, Agent Zero project/bridge separation, Cursor handoff/worktree behavior.

**Acceptance should test:** one controlled restart boundary at a time, not all restarts simultaneously.

---

### Lane C — Context retrieval, provenance, and drift resistance

**Question family:**

- When should the local agent call `browserConversationRead`?
- How much recent context is sufficient?
- How are current task, project architecture, GPT-Knowledge, recent chat, and durable session history prioritized?
- Can retrieved conversational text override current user intent incorrectly?
- How does the agent identify “new plan conflicts with active architecture” without turning the bridge into a semantic classifier?

**References:** Railly's four-month update, Hermes #17154, GPT-Knowledge, Agent Zero projects.

**Desired principle:** selective context with provenance, not maximal context.

---

### Lane D — Capability discovery and blocked dependencies

**Question family:**

- Which capability must be proven before a run starts?
- What should happen when provider tool calling, MCP, browser runtime, workspace tool, or external dependency is unavailable?
- Which errors are retryable and which require configuration change?

**References:** gh-aw real MCP/policy failures, Hermes provider/tool architecture, current Access provider capability proof.

**Desired principle:** fail early with capability evidence; do not let the agent reason indefinitely around an unavailable mandatory dependency.

---

### Lane E — Lifecycle truth and externally observed completion

**Question family:**

- How should `completed`, `waiting_for_dependency`, `blocked`, `failed`, `timed_out`, `cancelled`, and delivery ambiguity map across all layers?
- Which state belongs to the agent runtime and which belongs to delivery/outcome?
- Can a successful local task still be an incomplete Browser Loop outcome because delivery was unverified?

**References:** gh-aw `report_incomplete`, outcome evaluation, current Access result-store/relay lifecycle.

**Desired principle:** never collapse distinct states merely to satisfy a boolean `complete` flag.

---

### Lane F — Observability and evidence correlation

**Question family:**

- Can one correlation chain reconstruct:
  assistant turn -> local session -> tool calls -> result -> delivery -> next observed turn?
- Which events are essential vs diagnostic noise?
- Do we retain enough information to distinguish duplicate execution from duplicate observation?

**References:** gh-aw observability artifacts/OTEL, Hermes gateway audit recommendations, current Access correlation framework.

**Desired principle:** one evidence chain per bounded operation; do not log everything indiscriminately.

---

## 13. Acceptance matrix for the remaining Browser Loop milestone

| Area | Current status | Next authoritative observable | Do not infer from |
|---|---|---|---|
| Natural assistant turn ingress | **PROVEN** | existing live `instruction_received` with plain prose | source parser alone |
| Exact-chat selection/auth | **PROVEN for current runtime** | selected target + authenticated provider snapshot | old profile assumptions |
| Continuing local session | **PROVEN live for the tested R2 restart boundary** | same durable `sessionId` before/after controlled restart | text similarity or pointer existence alone |
| Protected conversation read | **NOT PROVEN live** | actual `browserConversationRead` tool receipt + bounded exact-chat turns | tool registration alone |
| Governed tool execution | **PROVEN in tests / prior live browser acceptance** | tool receipt correlated to current natural turn | agent summary |
| Result queue durability | **PROVEN in tests** | journal/result correlation for bounded live turn | pending UI text |
| Same-chat rendered delivery | **PROVEN live for R1/R2** | `RENDERED_DELIVERY_VERIFIED` on the correlated exact-chat path | submit call return alone |
| No self-trigger loop | **PROVEN live for the tested R1/R2 cycles** | delivery-response assistant turn consumed with zero duplicate local execution | short waiting period without correlation |
| Restart identity continuity | **PROVEN live for the controlled R2 Stop All -> Start Loop boundary** | replacement target + unchanged durable `sessionId` + submission counts `1 -> 1 -> 2` | “Chrome reopened” |
| Non-complete lifecycle truth | **PARTIALLY PROVEN** | end-to-end state mapping evidence | local `ok` alone |
| Full repository suite | **PROVEN PASS** on accepted implementation head `72b078cf...` | rerun after code changes; docs-only commits do not invalidate runtime proof | prior PR17 suite or docs head alone |

---

## 14. Stop conditions — how we avoid infinite testing

Stop an investigation when any one of these is true:

1. the named question is answered by an authoritative observable;
2. the falsifier occurs;
3. the required capability is unavailable and the result is therefore `INCONCLUSIVE` or `BLOCKED_CONFIGURATION`;
4. the harness failed before the target boundary was exercised;
5. the test fixture is stale relative to the documented contract;
6. the next run would repeat the same conditions without new evidence.

Do **not** rerun an unchanged experiment merely because the previous result was undesirable.

A retry requires at least one changed input:

- code;
- configuration;
- provider capability;
- environment;
- target/session identity;
- test instrumentation;
- explicit hypothesis.

---

## 15. Evidence hierarchy for remaining decisions

Use this order:

```text
1. User's explicit current direction
2. Live runtime evidence from the actual bounded flow
3. Current Access Browser Agent source on the exact active head
4. Current project governance / active architecture contract
5. GPT-Knowledge canonical engineering method
6. Primary reference implementations + their real issue evidence
7. Official product documentation/changelogs
8. Secondary case studies and pattern libraries
9. Model prior / intuition
```

No architecture change should be justified from level 8 or 9 when higher-level evidence is available.

---

## 16. Immediate next research sequence

### Closed — R1 result-feedback ownership

`PROVEN` live end to end on the accepted PR18 implementation path.

The delivered Access result is rendered in the exact conversation, the causally owned assistant delivery-response turn is consumed rather than submitted to the local agent, and the relay returns to `waiting_for_instruction`.

### Closed — R2 session/turn identity across restart

`PROVEN` live end to end for the controlled Stop All -> Start Loop reconstruction boundary on implementation head:

`72b078cf11c98c08dc8df4a0d9895d1b5156ae57`

The replacement CDP target preserved transport lineage, historical turns were not replayed, the next independent turn executed exactly once, and the same durable local `sessionId` continued.


### Active - R3 ambiguous durable recovery authority

The bounded R3 candidate is implemented on local branch r3/canonical-46-integration-20260816.

Current evidence level:

- focused deterministic recovery regressions: PASS;

- full npm run check: PASS;

- isolated acceptance against a byte-for-byte copy of the production journal: PASS;

- source production journal unchanged: PROVEN;

- restart reconstruction of the appended reconciliation receipt: PROVEN;

- historical relay submission after reconciliation in the focused relay case: zero;

- isolated rendered operator action in the running application: PROVEN; live ChatGPT content behavior: NOT PROVEN.

The preserved production record turn-a51547a0194bf764 remains untouched in durable state executing. No production reconciliation has been performed.

Implemented contract:

ambiguous durable record -> blocked -> exact Problems evidence -> explicit disposition -> append-only receipt -> original evidence preserved -> non-executable baseline -> waiting_for_instruction

GitHub status checked after validation:

- PR 18 is open, draft, mergeable, and unmerged at remote head 68eff6f3708bca0198453d6ec9c25ccd862fdc61;

- the local R3 branch is not pushed.

The bounded rendered recovery path has now passed against an isolated fixture. The production journal remains untouched, and live ChatGPT content behavior remains a separate lane.

Context-on-demand, capability preflight, and broader lifecycle acceptance remain separate deferred lanes. They are not R3.

---

## 17. What “done” means for this milestone

This milestone is complete only when one bounded live conversation proves:

```text
1. exact selected authenticated ChatGPT conversation
2. one new completed ordinary assistant turn
3. mechanical identity + provenance recorded
4. exactly one local-agent submission
5. same continuing local-agent relationship
6. optional context retrieval works if actually needed
7. governed action/evidence occurs if requested
8. terminal state remains semantically truthful
9. result is durably correlated
10. result is delivered to the same exact chat
11. rendered delivery is externally observed
12. delivered result does not itself cause accidental re-execution
13. relay returns to an eligible waiting/continuation state
14. one controlled restart case preserves or safely reconciles identity without duplicate work
```

Passing more unit tests cannot substitute for these lifecycle observations.

Likewise, one live success cannot substitute for the repository regression suite.

Both layers are required, but they prove different things.

---

## 18. Final current position

### PROVEN

- the repository implementation is green on the validated PR18 head;
- normal assistant prose reaches the Browser Loop without the old semantic instruction envelope;
- the local reasoning runtime can operate as a continuing conversation rather than a fresh task per turn;
- general browser tools remain isolated from the protected ChatGPT transport target;
- failed tool observations can return to reasoning instead of forcing false terminal failure;
- exact-chat/auth/Managed Chrome fundamentals have live evidence from this rebuild.

### INFERRED / architecture-enabled but not yet accepted end to end

- continuing conversational context should materially improve drift detection because the local coding agent can compare a new direction with prior task/session decisions rather than receiving each turn as an isolated task;
- bounded exact-chat context retrieval should further reduce drift when the local session lacks enough recent browser-side discussion.

These are reasonable consequences of the architecture, but they should be demonstrated with a real contradiction/continuation scenario before being called fully proven behavior.

### NOT PROVEN

- live ChatGPT content reconciliation: NOT PROVEN; bounded isolated rendered fixture reconciliation: PROVEN;
- arbitrary process-death recovery inside unresolved side-effect boundaries;
- live on-demand protected conversation read;
- full lifecycle truth across waiting/blocked/failed/timed-out/cancelled delivery paths.

### Required next posture

> R1 and R2 remain closed. The bounded R3 isolated-fixture operator path is runtime-proven; preserve the untouched production record and treat live-provider content acceptance as a separate lane.

That is the current R3 engineering gate.
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


## Clean R3 integration branch - 2026-08-16

### Status

`SPLIT_APPLIED / CLEAN_BRANCH_VALIDATION_PENDING`

- Clean branch: `r3/clean-recovery-integration-20260816`.
- Exact base: PR #18 head `68eff6f3708bca0198453d6ec9c25ccd862fdc61`.
- Combined PR #20 was classified `SPLIT_REQUIRED`.
- Independent browser capability/subagent, terminal re-entry, and unimplemented browser-state lifecycle commits are excluded.
- The clean branch contains the effective R3 and managed Chrome bootstrap lifecycle surfaces.
- Historical runtime proof remains attributable to implementation head `80cc5735f074fdff54ccec230539851d0e09cdd5`; it is not automatically transferred to the reconstructed clean branch.

### Next single gate

Run the clean-branch validation contract:

1. governance and module-registry checks;
2. focused recovery, relay, authority, runtime-state, shell, ManagedChrome, and ProviderChannel tests;
3. full `npm run check`;
4. copied-production-journal R3 acceptance;
5. rendered isolated-fixture R3 acceptance;
6. visible bootstrap retirement acceptance;
7. verify the production journal remains unchanged.

If any failure identifies a real dependency on excluded commits, classify it against the split falsifier before changing source.

## Clean-branch focused rendered proof - 2026-08-16

### Classification

`CORE_RENDERED_PASSED_WAITING_BLOCKED_CONFIGURATION`

- Clean proof head before this documentation update: `ba3eb77400d529a213ff6c0545294508d7516d54`.
- Preload transports relay start directly; BrowserSessionAuthority owns recovery-first/provider-readiness ordering.
- Rendered recovery evidence and Quarantine action: PROVEN.
- Preload -> IPC -> authority -> append-only reconciliation receipt: PROVEN.
- Restart projection: PROVEN.
- Historical instruction rows added: zero.
- Relay execution invoked for the reconciled historical record: false.
- Production journal unchanged: PROVEN.
- Live ChatGPT content proven: false; the acceptance used the isolated CDP-intercepted fixture.
- Final waiting_for_instruction: BLOCKED_CONFIGURATION because the configured provider/model did not pass its capability probe.

This is not an R3 recovery failure. The core rendered recovery path passed while the independent provider-readiness condition correctly prevented WAITING and execution. Full clean-branch validation remains the next gate.

## Clean integration validation closure - 2026-08-16

### Status

`CLEAN_BRANCH_VALIDATION_PASSED`

Validated implementation/documentation head before this closure record: `70568ebd7b6e43116c81a1f2c188af719d401d90`.

- Change governance: PASS (20 records; none active).
- Module registry: PASS (25 modules).
- Full `npm run check`: PASS.
- Copied-production-journal R3 acceptance: PASS.
- Rendered R3 core: `CORE_RENDERED_PASSED_WAITING_BLOCKED_CONFIGURATION`.
- Visible managed-Chrome bootstrap retirement: `VISIBLE_ACCEPTANCE_PASSED`; one provider page and zero bootstrap pages.
- Production journal SHA-256 remained `BC64FA793BE0C2B52459CAE47ABCDB560C91A698793C08E7F874963B806EF503` across the full validation.
- Production reconciliation and live-chat submission were not attempted.

### Integration decision

Clean PR #22 is the validated R3/bootstrap integration lane. Combined PR #20 is superseded by the audited split and must not be merged as the integration vehicle. Provider capability readiness remains an independent configuration gate; it correctly prevents WAITING and execution without invalidating the proven recovery path.
