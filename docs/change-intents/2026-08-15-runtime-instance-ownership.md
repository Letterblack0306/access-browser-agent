# Change Intent

## Change ID

`2026-08-15-runtime-instance-ownership`

## Status

`in_progress`

## Requested outcome

Remove the hidden machine-global startup blocker exposed by live `start:trace`: a new Access Agent runtime must not silently exit merely because another Access Agent/Electron process already owns the legacy application-level single-instance lock. Runtime ownership must be explicit and evidence-backed, while bridge/CDP ports remain dynamically allocated and workspace/browser state remain isolated.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-runtime-instance-ownership.md`
- `docs/REBUILD_REMOTE_COMPLETION_AUDIT_2026-08-14.md`
- `electron/main.js`
- `electron/rebuild-main.js`
- `test/rebuild-phase0-contract-smoke.js`
- `test/rebuild-agent-truth-observability-smoke.js`

## Intent

The legacy `app.requestSingleInstanceLock()` is application-global and currently causes a second Access Agent process to call `app.quit()` before `createWindow()`. This conflicts with the machine-adaptive runtime contract: dynamic workspace-bridge/CDP endpoints already prevent fixed-port collisions, and a separate local runtime should not be blocked merely because another stale or independent Access Agent process exists. The active rebuild wrapper therefore owns independent runtime-instance startup and neutralizes the legacy lock only while loading the compatibility main implementation. Preserve isolation through per-process dynamic bridge ports, Access-owned browser session identity, workspace-root/state-root scoping, and existing deterministic governance. Add explicit startup diagnostics identifying runtime instance/process ownership.

## Planned changes

1. Keep the historical single-instance implementation in the compatibility main untouched, but prevent it from controlling the active rebuild by temporarily neutralizing `requestSingleInstanceLock()` only around `require('./main.js')`, then restore Electron's original method immediately.
2. Emit explicit runtime-instance startup diagnostics from the rebuild wrapper, including pid, workspace cwd and dynamically selected bridge port, without exposing secrets.
3. Keep `window-all-closed` application shutdown behavior unchanged for each process.
4. Add source regression proving the active rebuild owns independent startup and does not inherit the legacy global startup blocker.
5. Re-run isolated `npm run check`, then `start:trace`; acceptance requires `browser_window_created` after `app_ready` instead of immediate clean exit.

## Why

Live trace on validated head `1c5b4d233283e783cc81e0a6d6535a2f9d054373` proved machine discovery succeeded (`pwsh` resolved from PATH and bridge port `63576` dynamically selected), but the process emitted `before_quit`/`will_quit` before any window creation and exited 0. Source inspection found `if (!app.requestSingleInstanceLock()) app.quit();` in `electron/main.js`, followed by a `second-instance` handler. This means another process can silently prevent the rebuilt runtime from launching even though its network/browser endpoints are independently owned.

## Post-change update

Source implementation is complete and pending isolated Windows validation.

- `electron/rebuild-main.js` now records `runtime-instance / instance_ownership` with pid, cwd, selected bridge port and `singleInstancePolicy: independent_rebuild_runtime`.
- Only while the legacy compatibility main is synchronously loaded, the wrapper makes `app.requestSingleInstanceLock()` return true; Electron's original method is restored in a `finally` block immediately after loading.
- This keeps the active rebuild independent without permanently monkey-patching Electron or deleting compatibility behavior that may still be relevant outside the rebuild entrypoint.
- Existing dynamic workspace-bridge ownership, dynamic managed-Chrome CDP ownership, Access-owned Chrome profile, workspace/state-root isolation and governance remain unchanged.
- `rebuild-phase0-contract-smoke` now guards this active-rebuild ownership contract.

## Validation evidence

Pre-change runtime evidence: diagnostic session `b6d64a2c-dd54-443c-aca0-2a4f782c0085` resolved `C:\\Program Files\\PowerShell\\7\\pwsh.exe`, selected loopback bridge port `63576`, then emitted `before_quit` and `will_quit`, with no `browser_window_created`; foreground launcher recorded exit code 0. Source inspection binds that behavior to the legacy single-instance lock in `electron/main.js`.

Required closure evidence remains exact-head `npm run check`, followed by `start:trace` proving a window is actually created and remains alive even when another Access Agent process owns the legacy application lock.
