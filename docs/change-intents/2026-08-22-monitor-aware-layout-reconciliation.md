# Change Intent: Monitor-Aware Layout Reconciliation

## Change ID

`2026-08-22-monitor-aware-layout-reconciliation`

## Status

`completed`

## Requested outcome

Keep the local IDE pane geometry responsive when the Electron window moves between monitors or the viewport/device scale changes.

## Intent

Reconcile persisted left, right, and bottom pane dimensions against the current viewport instead of applying fixed bounds only at initial mount.

## Planned changes

- Add viewport-aware pane limits.
- Reconcile dimensions on window, visual viewport, and resolution changes.
- Preserve layout persistence and existing resizer behavior.
- Add focused source-contract coverage.

## Why

Persisted pixel dimensions can exceed the usable geometry after a display or scale transition, leaving the visual layout stale or misaligned.

## Target files

- `electron/rebuild-shell.js`
- `test/rebuild-shell-smoke.js`
- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-22-monitor-aware-layout-reconciliation.md`

## Post-change update

The shell now recalculates pane limits from the current viewport and applies them after display/viewport changes while preserving the user’s saved layout where valid.

## Validation evidence

- `node --check electron/rebuild-shell.js` — PASS
- `node test/rebuild-shell-smoke.js` — PASS
- `npm run check:rebuild` — PASS
- `npm run check` — PASS
- `git diff --check` — PASS
