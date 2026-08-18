# Change Intent

## Change ID

`2026-08-15-inline-live-toolcall-ui`

## Status

`in_progress`

## Requested outcome

Implement the approved live agent/tool-call presentation pattern from the supplied LBE runtime research prototype as a truthful inline runtime UI for Access Agent, while explicitly excluding every approval/authorization interaction from that prototype. Tool calls, command/file activity, observations, diffs/evidence references, status and completion should render in the chronological agent stream where they occur rather than as a separate approval workflow or permanent tool dashboard.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-inline-live-toolcall-ui.md`
- `docs/REBUILD_REMOTE_COMPLETION_AUDIT_2026-08-14.md`
- `electron/index.html`
- `electron/rebuild-renderer.js`
- `electron/rebuild-ui-stability.css`
- `test/rebuild-shell-smoke.js`
- `test/rebuild-agent-truth-observability-smoke.js`

## Intent

Use the supplied `LBE — Agent Runtime (Research Prototype)` as visual/interaction evidence for live runtime truth, not as semantic architecture authority. Preserve its useful traits: compact truthful status chrome, chronological user/agent stream, contextual inline tool cells, concise operation metadata, tool state, path/command/result summary, and evidence/diff affordances. Remove and forbid its approval overlay, approve/deny buttons, awaiting-authorization state, and local composer because Access Agent has no ordinary approval workflow and browser conversation owns instructions. The UI must render only observed runtime/tool events and receipts; it must never invent a deterministic plan or fake tool progress.

## Planned changes

1. Rework the Task view into a live browser-owned session stream rather than a local task composer.
2. Render real agent/runtime events inline as message/tool cells with source, operation/tool name, status, concise detail, correlation IDs and available evidence/diff references.
3. Keep the existing Execution Monitor and Complete Log as deeper evidence views; the Task stream is the compact human-readable projection.
4. Add source styling inspired by the supplied research prototype: dense dark stream, small agent/user/runtime markers, bordered inline tool cells, status pills and compact metadata.
5. Do not add approval, authorization, approve/deny, permission prompts, semantic Plan->Approve->Execute states or a replacement local composer.
6. Preserve browser-owned instruction flow: exact chat URL + Start -> WAITING -> browser instruction -> adaptive execution -> result -> WAITING.
7. Add negative regressions that reject approval UI/text and local instruction composer behavior, and positive regressions for inline tool-call rendering from real diagnostic/agent events.
8. Record this pattern in the canonical rebuild audit. A separate GPT-Knowledge update will store the durable cross-project reference.

## Why

The supplied prototype demonstrates the desired information density and chronology: runtime facts appear inline where they matter instead of being hidden behind a generic status dashboard. Its approval overlay is explicitly not part of Access Agent. Current rebuild runtime truth is concentrated in Execution Monitor/Complete Log; the main Task surface should show the same real tool-call activity in a compact live stream so the user can see what the adaptive agent is actually doing without introducing a second instruction channel or approval gate.

## Post-change update

Remote implementation is complete and remains `in_progress` pending isolated Windows validation and one real browser-owned tool-call trace.

- `rebuild-renderer.js` now derives a compact live session stream from actual diagnostic/runtime records.
- Meaningful agent/tool/provider/browser/loop/governance transitions render inline as contextual cells with actor, action/tool title, observed state, concise detail, source and available correlation IDs.
- Low-level status polling, renderer/preload plumbing, terminal byte/write/resize chatter and process-stream noise are filtered from the foreground stream while remaining available in Complete Log.
- The stream never creates approval/authorization state and does not expose `agentRun` or a local instruction path.
- Existing Execution Monitor and Complete Log remain the deeper evidence surfaces.
- `rebuild-ui-stability.css` now contains the dense inline card/actor/status styling derived from the supplied prototype without copying its approval overlay.
- `rebuild-shell-smoke` now locks the positive live-tool stream contract and rejects approval/authorization text/semantics in the active renderer/UI.
- A durable cross-project reference was added to `Letterblack0306/GPT-Knowledge` at `ui-engineering/inline-agent-runtime-toolcall-truth-ui.md`.

## Validation evidence

Pre-change evidence is the user-supplied LBE runtime research prototype and the current rebuild source. The prototype labels itself a research/design artifact and contains contextual `.tool-cell` blocks plus a separate `.approval` overlay. The implementation adopts the tool-cell/chronological-stream presentation while rejecting the approval overlay.

Remote source inspection confirms the renderer projection is evidence-driven and noise-filtered, with `renderLiveSessionStream()` fed by diagnostic records and `correlationSummary()`. Source regression coverage was updated, but execution is not yet claimed. Closure requires isolated Windows `npm run check`, followed by a browser-owned instruction producing real tool events that appear inline with no approval UI, no fabricated semantic plan and no duplicate local instruction channel.
