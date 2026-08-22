# Access Browser Agent Current Status

Updated: 2026-08-22
Source head: `ff07f1f83b94a867ee6ce7b13c4287281e4c2d29`

## Product state

The local Electron rebuild is the active UI surface. It retains the local IDE, agent/task, execution, editor, Browser Loop, runtime, terminal, settings, provider, managed Chrome, and local MCP controls.

External BirdEye/workspace-handoff UI has been removed from the product surface. The backend handoff service remains preserved for separate future cleanup or diagnosis.

## Validation

- `npm run check:rebuild`: PASS
- `npm run check`: PASS
- `npm run acceptance:ui` with `ACCESS_AGENT_ACCEPTANCE_STEP_TIMEOUT_MS=120000`: PASS (all 8 steps)
- Standalone current UI smoke tests: PASS
- External UI-surface removal smoke: PASS
- BirdEye backend state smoke: PASS
- `git diff --check`: PASS

## Boundary

Runtime, provider, browser, and durable recovery authority remain unchanged. No second UI state store, router, or runtime was introduced.

Live Electron/CDP acceptance is now proven: the saved exact ChatGPT target was verified, the LM Studio capability probe passed, relay start/check/stop completed, and final cleanup returned the runtime to a clean state. Pixel-level visual interaction remains outside this proof because the Windows Computer Use native pipe was unavailable. Local Electron launch was observed successfully with a responding `Access Agent — Rebuild` window.

Monitor-aware layout reconciliation is implemented: persisted pane dimensions are recalculated against the current viewport after window, visual-viewport, and display-resolution changes.

Cline auth integration now supports a read-only fallback import from `providers.cline.settings.auth` in the standard user provider store (`%USERPROFILE%\\.cline\\data\\settings\\providers.json`). `CLINE_PROVIDERS_PATH` overrides the default. Access Agent never writes or clears that external file; live Cline sign-in, refresh, and logout remain owned by Access Agent preferences.

The Cline provider-store import smoke and full source checks pass. Live Cline readiness is now proven on the configured authenticated provider: completion, tool-calling, and structured JSON output all passed the product probe.

General browser hardening now requests an Access-owned CDP browser context when strict isolation is enabled and projects a bounded native AX tree in browser snapshots. The active managed Chrome host rejects CDP target/context creation with `Not allowed`, so strict browser-context isolation and live AX acceptance remain host-blocked; normal browsing preserves logical target ownership with strict isolation disabled by default on unsupported hosts.

The existing durable runtime reconstruction regressions pass, but arbitrary process-death exactly-once recovery is not proven. The bounded native Windows PTY probe did not complete within the timeout, so the AttachConsole owner-map issue remains host/runtime-blocked.

Untracked `section_09.md` is preserved and is not part of this change.
