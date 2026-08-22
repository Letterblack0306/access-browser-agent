# Access Browser Agent Current Status

Updated: 2026-08-22
Source head: `main` (see `git rev-parse HEAD` for the exact published commit)

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

General browser hardening now uses a separate Access-owned Managed Chrome process/profile for agent browsing, distinct from the persistent provider relay browser. Managed Chrome live acceptance proves distinct endpoints/profiles, ordinary HTTPS target creation, explicit navigation, and bounded AX snapshot retrieval. The host still rejects `Target.createBrowserContext` with `Not allowed`; process/profile isolation now provides the product boundary and optional CDP context isolation remains an extra host-dependent hardening path.

Opt-in browser screenshots remain enabled with `ACCESS_AGENT_CAPTURE_BROWSER_SCREENSHOT=1`. Their deterministic default location is Electron `app.getPath('userData')/diagnostics/browser-evidence`, alongside correlated minimized DOM evidence and SHA-256 references; screenshots remain disabled by default.

The native Windows PTY manager now has a live `pwsh.exe` create/write/exit round-trip proof. Durable agent recovery now fails closed when a restart leaves an execution step without a terminal event: new work is blocked until an explicit operator reconciliation. This removes silent replay risk, but exactly-once external side effects remain dependent on the external tool's idempotency/transaction contract and are not claimed here.

Untracked `section_09.md` is preserved and is not part of this change.
## Visual input and image verification

The local browser agent now exposes explicit `browserScreenshot` and `browserCompareScreenshots` tools. Screenshot artifacts remain app-owned, are addressed by evidence ID, and are SHA-256 verified before controlled resolution. Provider/model readiness includes an explicit `imageInput` capability and text-only adapters fail closed with `VISUAL_INPUT_UNAVAILABLE` for image-bearing messages.

Current visual capability status: READY for governed screenshot capture and comparison. Provider-native IMAGE_READ is OPEN as the next acceptance gate, not a blocker for this implementation phase. The provider request must contain actual image content before the system may claim IMAGE_READ or visual reasoning.

Next visual acceptance gate: `IMAGE_READ_PROVIDER_NATIVE`.

Falsifier: a provider request contains no actual image content while the system claims IMAGE_READ capability.
