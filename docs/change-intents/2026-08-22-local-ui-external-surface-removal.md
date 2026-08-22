# Change Intent: Local UI External Surface Removal

## Task

Keep the Access Browser Agent UI focused on the local IDE, local agent, and browser workflow by removing external BirdEye/workspace-handoff UI surfaces and updating stale UI tests to the current rebuild architecture.

## Target files

- `electron/index.html`
- `electron/main.js`
- `electron/preload.js`
- `electron/rebuild-renderer.js`
- `electron/renderer.js`
- `src/system/ui-id-registry.js`
- `electron/birdeye-status-view.js`
- related UI smoke tests

## Implementation

- Removed BirdEye controls, renderer bindings, preload methods, IPC handlers, and UI registry IDs.
- Removed the obsolete BirdEye UI view.
- Preserved the backend handoff service and backend state coverage.
- Updated standalone UI tests to validate the current rebuild shell, runtime health, execution trace, and IDE-reference surface.

## Validation

- `npm run check:rebuild` — PASS
- `npm run check` — PASS
- Standalone runtime-controls, trace, Electron-shell, workbench-UX, and external-surface smoke tests — PASS
- BirdEye backend state smoke — PASS
- `git diff --check` — PASS

## Status

Implementation complete. Live visual interaction remains unproven because the Windows Computer Use native pipe was unavailable; local Electron launch itself was observed with window title `Access Agent — Rebuild` and a responding process.
