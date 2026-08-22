# Access Browser Agent Current Status

Updated: 2026-08-22
Source head: pending focused Cline provider-store import commit

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

The Cline provider-store import smoke and full source checks pass. Live authenticated Cline model use still requires an authenticated provider and a successful live model readiness check.

Untracked `section_09.md` is preserved and is not part of this change.
