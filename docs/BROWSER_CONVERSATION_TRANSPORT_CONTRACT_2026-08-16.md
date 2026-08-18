# Browser Conversation Transport Contract — 2026-08-16

## Status

Active architecture contract for the Browser Loop refactor on `refactor/browser-conversation-turn-transport-20260816`.

## Core rule

> **Agents reason; bridges transport. Governance constrains authority without becoming a second reasoning engine.**

The Browser Loop is a conversation link between a browser-side reasoning agent and the local reasoning agent. Ordinary reasoning work must not depend on a magic text pattern before the local agent can receive it.

## Normal conversation path

```text
selected exact ChatGPT conversation
  -> provider adapter observes latest completed assistant-authored turn
  -> verify exact conversation + assistant provenance + generation state
  -> derive mechanical turn identity
  -> transport journal handles ordering / dedupe / crash recovery
  -> local reasoning agent receives the assistant text unchanged
  -> current local agent session continues
  -> local agent may call browserConversationRead if more chat context is needed
  -> governed tools execute
  -> result is delivered to the same exact conversation
```

The transport does **not** need to understand the meaning of the assistant text. The local agent decides whether the turn is a task, continuation, correction, question, context, or no-op.

## What was removed from the ordinary path

The following pattern is no longer required for normal agent reasoning:

```text
=== ACCESS AGENT INSTRUCTION START ===
VERSION: 1
INSTRUCTION ID: ...
WORKSPACE: ...
OBJECTIVE:
...
=== ACCESS AGENT INSTRUCTION END ===
```

A normal assistant message such as:

```text
Inspect why provider readiness is hanging. Verify the current repository and runtime evidence first, then fix the root cause.
```

is sufficient transport input. The relay forwards the natural assistant text to the local reasoning agent without regex-extracting an `OBJECTIVE:`.

## Explicit quick-command exception

Structured parsing remains only for the intentional non-reasoning bypass:

```text
=== ACCESS AGENT INSTRUCTION START ===
VERSION: 1
INSTRUCTION ID: cmd-123
WORKSPACE: G:\\Example
TYPE: quick_command
COMMAND: git status
=== ACCESS AGENT INSTRUCTION END ===
```

Why this remains structured:

- it explicitly says not to ask the local reasoning agent to reinterpret the operation;
- the exact command must be preserved;
- the workspace binding is mechanical;
- the operation still passes through governed terminal policy;
- deterministic parsing is part of the transport/control contract, not semantic task reasoning.

No other ordinary agent request gets privileged meaning from this envelope.

## Conversation context tool

The local reasoning agent has a dedicated read-only context tool:

`browserConversationRead`

Purpose:

- use when the current assistant turn references earlier discussion or lacks enough context;
- return a bounded recent sequence of `user` and `assistant` turns from the currently selected exact Browser Loop conversation;
- preserve message index / provider message identity when available.

Hard restrictions:

- no arbitrary target ID from the model;
- no navigation;
- no typing;
- no click/action surface;
- no arbitrary JavaScript evaluation supplied by the model;
- no general browser ownership of the protected ChatGPT transport target.

The tool is context retrieval, not command detection.

## Mechanical turn identity

The relay must distinguish message identity from semantic meaning.

Preferred identity source:

1. provider message ID when available;
2. assistant message index within the observed conversation;
3. content hash only as part of the fallback identity.

Two distinct assistant messages that happen to contain identical text must not automatically collapse into one instruction solely because their text matches.

## Startup baseline

When attaching to an existing conversation for the first time, the relay may record the latest already-present assistant turn as historical baseline rather than executing arbitrary old conversation content.

After the loop is established, a new assistant turn is eligible for exactly-once transport according to the durable journal. A turn that arrived while the loop was stopped remains governed by journal/recovery evidence rather than semantic guessing.

## Session continuity

Browser Loop turns belong to one continuing reasoning relationship. Normal assistant turns therefore use the current local agent session rather than forcing `newSession:true` for every message.

A new session should occur only for an actual session boundary owned by the agent/session runtime, not because another browser message arrived.

## Responsibilities by layer

### ProviderChannel

Owns:

- supported provider adapter;
- exact-chat URL observation;
- assistant-message provenance;
- generation/composer state;
- bounded read-only conversation extraction;
- delivery through the provider composer.

Does not own:

- deciding whether prose is actionable;
- deciding whether prose is a task versus context;
- semantic deduplication;
- planning or completion judgment.

### BrowserInstructionRelay

Owns:

- selected target binding;
- latest completed assistant-turn transport;
- technical turn identity;
- ordering;
- durable journal / recovery state;
- exactly-once execution/delivery protection around ambiguous side-effect boundaries;
- explicit `quick_command` detection only.

Does not own:

- ordinary instruction grammar;
- `OBJECTIVE:` extraction;
- keyword task routing;
- plan adaptation;
- semantic lifecycle interpretation.

### TaskStateRouterBridge

Transport-only bridge into the local agent runtime. It must not become a semantic router.

### Local reasoning agent

Owns:

- natural-language interpretation;
- deciding whether work is needed;
- deciding whether additional conversation context is required;
- workspace/browser/tool selection;
- plan adaptation;
- validation and completion reasoning.

### Governance/tool runtimes

Own deterministic authority and execution boundaries. They may allow/deny operations mechanically but do not reinterpret user intent.

## Anti-regression rule

A future change must not restore any of the following to the normal Browser Loop path unless a non-semantic integrity/security requirement is demonstrated with runtime evidence:

- mandatory `ACCESS AGENT INSTRUCTION` wrapper for reasoning turns;
- `OBJECTIVE:` requirement;
- keyword/regex task classifier;
- command detector that decides ordinary prose is executable;
- semantic dedupe based on text equivalence;
- task-state router that decides conversational meaning before the local agent sees the turn;
- forced fresh local session per browser message.

Review question:

> Is this logic protecting identity, ordering, authority or recovery, or is it deciding meaning that the receiving reasoning agent can decide itself?

If it is deciding meaning, it belongs with the reasoning agent, not the transport layer.

## Acceptance requirements

A release claim for this contract requires evidence for all of the following:

1. exact authenticated Browser Loop target selected;
2. loop reaches `waiting_for_instruction` / waiting-for-turn state;
3. a plain natural-language assistant turn with no envelope is observed;
4. that exact text reaches the local reasoning agent exactly once;
5. local agent session continuity is preserved across a subsequent natural turn;
6. local agent can request `browserConversationRead` and obtain bounded recent context from the same exact conversation;
7. general browser tools still cannot control the protected ChatGPT target;
8. explicit `quick_command` still bypasses local reasoning and preserves exact governed command evidence;
9. crash/restart recovery does not replay ambiguous work;
10. result delivery returns to the same exact conversation and is observed by the browser-side agent;
11. full repository checks pass on the exact tested head.
