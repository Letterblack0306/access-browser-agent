# Change Intent — Browser Conversation Turn Transport

## Change ID

`2026-08-16-browser-conversation-turn-transport`

## Status

`in_progress`

## Requested outcome

Remove the ordinary-agent semantic envelope gate from the Browser Loop. A new completed assistant-authored turn in the selected exact chat must be transported as natural-language input to the local reasoning agent without requiring `OBJECTIVE:`, `ACCESS AGENT INSTRUCTION`, keyword classification, command detection, or another semantic state machine.

Keep one explicit structured bypass only: `TYPE: quick_command` may remain a deterministic transport contract because it intentionally bypasses local reasoning and requests one exact governed terminal operation.

The local reasoning agent must also have an optional read-only tool for bounded recent context from the currently selected protected Browser Loop conversation.

Before any additional flow repair, record the current end-to-end position, mistakes, proven corrections, unresolved connecting areas, and a reference-driven research gate so the next test answers one explicit architecture question instead of extending an open-ended trial-and-error loop.

## Target files

- `src/agent/executive/BrowserInstructionRelay.js`
- `src/browser/provider-channel.js`
- `electron/browser-session-authority.js`
- `src/agent/executive/LiveToolContext.js`
- `test/browser-instruction-relay-smoke.js`
- `test/provider-channel-smoke.js`
- `test/agent-runtime-resilience-smoke.js`
- `test/rebuild-loop-lifecycle-smoke.js`
- `docs/BROWSER_CONVERSATION_TRANSPORT_CONTRACT_2026-08-16.md`
- `docs/CURRENT_POSITION_AND_RESEARCH_GATE_2026-08-16.md`
- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-16-browser-conversation-turn-transport.md`

## Intent

Make the Browser Loop a real agent-to-agent conversation boundary rather than a semantic command parser.

The normal path is:

```text
exact selected ChatGPT conversation
  -> completed assistant-authored turn + mechanical provenance
  -> transport identity / ordering / dedupe / recovery
  -> local reasoning agent session
  -> agent interprets natural language and uses governed tools
  -> agent may request bounded read-only conversation context if needed
  -> result transport back to the same exact chat
```

The bridge owns transport, integrity, identity, ordering, recovery, delivery, and governance boundaries. The reasoning agent owns semantic interpretation.

The only structured inbound exception is an explicit non-reasoning bypass:

```text
TYPE: quick_command + exact COMMAND
  -> deterministic quick-command parser
  -> GovernedTerminal
```

Hard boundaries retained:

- exact provider and conversation identity;
- assistant-message provenance;
- generation-complete observation before turn capture;
- technical duplicate protection and durable recovery journal;
- selected-target continuity;
- workspace/governance enforcement for tool execution;
- result delivery evidence;
- protected ChatGPT target remains separate from general browser-tool ownership.

Transport must not decide whether ordinary conversational prose is actionable, corrective, redundant, complete, contextual, or semantically new.

A second rule now governs the remaining work:

> **Research before repair. A test is justified only when it resolves one named uncertainty, has an authoritative observable, a falsifier, and a defined interpretation for pass, fail, or inconclusive.**

## Planned changes

1. Replace ordinary envelope-gated instruction capture in `BrowserInstructionRelay` with natural assistant-turn transport.
2. Preserve deterministic parsing only for explicit `TYPE: quick_command` execution.
3. Prefer stable provider message/turn identity for technical dedupe, with bounded fallback identity when a provider message ID is unavailable.
4. Continue the current local agent session for normal Browser Loop turns instead of forcing `newSession:true` per message.
5. Add bounded read-only recent conversation access for the current exact protected Browser Loop conversation.
6. Expose that context through `browserConversationRead` without navigation, typing, arbitrary target selection, or model-supplied JavaScript.
7. Preserve exact-chat identity, durable recovery, delivery evidence, general-browser isolation, and workspace governance.
8. Update focused relay/provider tests and rebuild lifecycle tests so they validate `assistant_turn` transport and continuing-session semantics rather than the removed ordinary instruction-envelope contract.
9. Keep the already-validated adaptive-tool-failure resilience expectation aligned with the current runtime: failed tool observations return to reasoning rather than forcing `waiting_for_dependency` when the agent can continue.
10. Maintain `docs/CURRENT_POSITION_AND_RESEARCH_GATE_2026-08-16.md` as the current architecture/evidence ledger for this milestone: proven behavior, mistakes, corrections, remaining flows, connecting areas, relevant external precedents, and the exact questions that must be answered before another implementation change.
11. Use references as comparison evidence, not copy targets: GPT-Knowledge, current Access source/runtime, OpenAI Codex, GitHub Agentic Workflows, Hermes Agent, Agent Zero, Agent Factory, current Cursor agent behavior, and Railly's agentic-second-brain postmortem.
12. Validate the exact branch head locally, then run only bounded acceptance cases whose question and falsifier are defined in the current-position document.

## Why

The live repository showed a boundary mismatch. `TaskStateRouterBridge` was already correctly transport-only and explicitly refused to classify conversational prose, but `BrowserInstructionRelay` still required an `ACCESS AGENT INSTRUCTION` envelope and extracted `OBJECTIVE:` before allowing normal prose to reach the reasoning runtime.

That duplicated reasoning in the transport layer and made the browser-side agent behave like a command formatter rather than a reasoning participant in a continuing conversation.

The canonical architecture is:

> Agents reason; bridges transport. Governance constrains authority without becoming a second reasoning engine.

Technical duplicate protection, target identity, authentication, ordering, recovery, and exact governed quick-command execution remain deterministic because those are transport/integrity boundaries rather than semantic reasoning.

The project also exposed a process failure: too many investigations were framed as “run another test and see what fails next.” That can find local defects, but it does not prove that the correct boundary is being tested. Several failures in this branch were stale test contracts or command/governance mistakes, not product defects. The remaining work therefore needs a connection map, comparable real-world failure cases, explicit source-of-truth ownership, and a falsifiable question before execution.

## Post-change update

Implementation is present on the active branch and the repository validation is green, but the change remains `in_progress` because live flow acceptance is only partial.

Implemented and locally validated:

- ordinary assistant prose is no longer required to match the `ACCESS AGENT INSTRUCTION` / `OBJECTIVE:` grammar before reaching the local reasoning runtime;
- `TYPE: quick_command` remains the explicit non-reasoning bypass;
- ordinary Browser Loop turns continue the local reasoning session rather than forcing a fresh session;
- provider message/turn identity is used for technical duplicate protection where available;
- bounded read-only protected conversation context is available through `browserConversationRead`;
- the ChatGPT transport target remains isolated from general browser navigation and interaction tools;
- focused relay/provider tests cover natural turns, message identity, conversation reads, quick-command bypass, and recovery behavior;
- the stale adaptive-tool-failure resilience test was ported from the already-validated resilience branch so failed tool observations return to the reasoning loop;
- `test/rebuild-loop-lifecycle-smoke.js` was corrected from the obsolete `inbound: instruction` assumption to the actual `assistant_turn` / continuing-session contract;
- full `npm run check` passed on exact head `15c2c3720e234ebedbfacbbeb092f8a6b121cbad`;
- a real runtime diagnostic later recorded `browser_relay.instruction_received` for ordinary assistant-authored prose with a stable turn identity, proving that the live inbound path no longer requires the old envelope;
- `docs/BROWSER_CONVERSATION_TRANSPORT_CONTRACT_2026-08-16.md` records the transport contract;
- `docs/CURRENT_POSITION_AND_RESEARCH_GATE_2026-08-16.md` records the wider architecture position and research-first acceptance method.

Governance-order deviation: the first implementation commits on this branch were created before this change intent was registered. That deviation remains explicitly recorded and is not represented as pre-authorization.

## Validation evidence

Repository proof as of 2026-08-16:

- exact PR head `15c2c3720e234ebedbfacbbeb092f8a6b121cbad` was fetched and checked out locally;
- `rebuild-loop-lifecycle-smoke: PASS`;
- change governance passed with 17 records;
- workspace clone sync passed;
- workspace path guard, reader, and bridge contract checks passed;
- all `check:agent-led` checks passed;
- `agent-runtime-resilience-smoke: PASS`;
- general browser evals passed 6/6;
- local runtime diagnostics, preferences, Managed Chrome, ProviderChannel, BrowserSessionAuthority, BrowserInstructionRelay, machine environment, governed terminal, workspace Git status, skill catalog, workbench layout, module registry, UI ID registry, implementation executor, and integration smoke passed;
- all `check:rebuild` checks completed successfully, including rebuild loop lifecycle, runtime state, shell, settings, diagnostic contract, agent-truth observability, and adaptive continuation;
- the full `npm run check` command exited successfully on that exact head.

Live runtime proof after repository validation:

- Access runtime produced `browser_relay.instruction_received` for a normal assistant-authored conversational paragraph rather than an instruction envelope;
- the event carried a stable `turn-*` instruction/transport identity and `providerId: chatgpt`;
- local agent state showed a continuing agent session rather than a new isolated session per browser turn;
- this establishes live natural-turn ingress and continuing-session behavior.

Still **not fully proven** and deliberately not to be repaired by guessing:

1. same-chat result delivery and rendered acceptance for a newly bounded natural turn;
2. absence of accidental self-trigger / feedback loops after the local result is posted back into the selected ChatGPT conversation;
3. live use of `browserConversationRead` by the reasoning agent when the current turn is insufficient;
4. restart/crash continuity across transport turn identity, local agent session identity, selected chat identity, durable journal state, and any provider-side message identity changes;
5. stale-target and stale-session handoff behavior when the browser, renderer, provider session, or local agent session is replaced;
6. lifecycle truth for non-complete outcomes (`waiting_for_dependency`, blocked, failed, timed out, cancelled) through local runtime -> relay -> result store -> browser delivery -> next turn;
7. exact capability-preflight behavior when required provider, browser, MCP, or workspace tools are unavailable or policy-blocked;
8. terminology cleanup (`instruction`, `agent_instruction`, `pendingInstructions`) so logs and docs no longer suggest that the removed semantic envelope is still the architecture.

The next code change must be preceded by the research question and bounded acceptance case recorded in `docs/CURRENT_POSITION_AND_RESEARCH_GATE_2026-08-16.md`.