# Change Intent

## Change ID

`2026-08-15-ui-stability-runtime-truth`

## Status

`completed`

## Requested outcome

Keep the approved fresh rebuild UI layout while reducing chaotic cursor/status flicker, removing CSP-triggering inline style mutations, and making agent/tool/runtime truth visible as a live evidence stream.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-ui-stability-runtime-truth.md`
- `electron/rebuild-renderer.js`
- `electron/rebuild-ui-stability.css`
- `test/rebuild-agent-truth-observability-smoke.js`

## Intent

Stabilize the current UI without redesigning it. Runtime activity must be driven by real diagnostic/runtime events, not a simulated semantic workflow. Cursor animation and unchanged status polling must not create distracting visual churn.

## Planned changes

- Disable the continuously blinking xterm cursor.
- Deduplicate unchanged status snapshots so the health poll does not rerender the full workbench when no runtime state changed.
- Replace CSP-blocked inline style mutations and inline style attributes in rebuild-renderer output with classes/data attributes backed by a self-hosted stylesheet.
- Project real diagnostic records into the Execution Monitor as compact evidence rows for agent, tool, terminal, provider, browser, loop, governance, and workspace activity.
- Preserve exact runtime source/action/phase and correlation identifiers where available; do not invent thinking/reading/writing states.
- Add regression assertions for no cursor blink, no delivery-meter `.style.width`, CSP-safe generated empty-state markup, and runtime-truth rendering from diagnostic records.
- Re-run the full isolated Windows validation after the user fast-forwards the corrected branch.

## Why

The live `start:trace` run showed the application booting successfully but produced repeated CSP violations after status polling and a visually chaotic cursor. The user also supplied an HTML interaction reference demonstrating the desired presentation pattern: compact state/action plus visible tool/runtime evidence and diffs. The reference is presentation guidance only; production state must remain grounded in actual runtime evidence.

## Post-change update

Implemented without redesigning the approved rebuild layout.

- xterm now starts with `cursorBlink:false`; the supplemental stylesheet also removes cursor-layer animation.
- status polling is reduced to 2.5 seconds and unchanged status snapshots are fingerprinted so they do not trigger full workbench rerenders.
- delivery progress now uses `data-progress` buckets rather than a dynamic inline `style.width` mutation.
- generated empty/file states no longer contain inline style attributes; layout styling is supplied by `electron/rebuild-ui-stability.css`, loaded as a same-origin stylesheet from the renderer.
- the Execution Monitor now projects actual diagnostic/runtime records for agent, tool, terminal, provider, browser, loop, governance, and workspace categories, including correlation IDs when present.
- agent execution trace events and live diagnostics are displayed separately; no simulated thinking/reading/writing state machine was introduced.
- regression coverage was extended in `test/rebuild-agent-truth-observability-smoke.js` for cursor stability, CSP-safe generated markup, delivery progress, status dedupe, and runtime-truth rendering contracts.

## Validation evidence

- Re-opened the modified renderer, stylesheet, and regression test from the rebuild branch after mutation and confirmed the intended source contracts are present.
- Exact full `npm run check` and live `start:trace` validation remain to be run in the isolated Windows checkout after fast-forwarding this new branch head; do not treat this source inspection as runtime proof.
