# Change Intent: Local UI External Surface Removal

## Change ID

`2026-08-22-local-ui-external-surface-removal`

## Status

`completed`

## Requested outcome

Keep the user-facing product focused on the local IDE, local agent, and managed browser workflow.

## Intent

Remove external BirdEye/workspace-handoff UI surfaces while preserving backend state coverage and the existing local runtime architecture.

## Planned changes

- Remove external UI controls, bindings, preload methods, IPC handlers, and registry IDs.
- Preserve backend handoff state and authority behavior.
- Align standalone UI smoke tests with the current rebuild architecture.

## Why

The product outcome is the working local IDE/agent/browser experience; external workspace UI nodes were outside that scope and created stale UI contracts.

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

## Post-change update

The external UI surface removal and the focused UI smoke-contract alignment are complete. The working product path remains local and runtime-backed.

## Validation evidence

- `npm run acceptance:ui` with `ACCESS_AGENT_ACCEPTANCE_STEP_TIMEOUT_MS=120000` — PASS (all 8 steps)
- Exact ChatGPT target verification — PASS
- LM Studio capability probe for `qwen/qwen3-vl-8b` — PASS during acceptance
- Pixel-level visual interaction remains unproven because the Windows Computer Use native pipe was unavailable; local Electron launch was observed with a responding `Access Agent — Rebuild` window.
- `npm run check:rebuild` — PASS
- `npm run check` — PASS
- `git diff --check` — PASS

Implementation commit: `82093575de2fbc888de08b05de66672c604f6f65`
