# Browser screenshot storage

## Change ID

`2026-08-22-browser-screenshot-storage`

## Status

completed

## Requested outcome

Keep the existing opt-in screenshot evidence feature and make its default storage location deterministic and app-owned.

## Intent

Store browser evidence outside the repository and workspace, under Electron's `userData/diagnostics/browser-evidence` directory, with the existing privacy metadata and SHA-256 references preserved.

## Planned changes

- Define and export the browser-evidence directory name and resolver.
- Use the resolver from the Electron rebuild runtime.
- Add regression coverage for the default path contract.
- Document the screenshot opt-in flag and default location.

## Why

The screenshot feature existed, but its default location was only implied by an inline path construction in the Electron entrypoint.

## Target files

- `src/browser/observable-browser-runtime.js`
- `electron/rebuild-main.js`
- `test/rebuild-agent-truth-observability-smoke.js`
- `docs/CURRENT_STATUS.md`
- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-22-browser-screenshot-storage.md`

## Post-change update

Implemented. Screenshot capture remains opt-in through `ACCESS_AGENT_CAPTURE_BROWSER_SCREENSHOT=1`; the default app-owned root is resolved as Electron `app.getPath('userData')/diagnostics/browser-evidence`.

## Validation evidence

- `node test/rebuild-agent-truth-observability-smoke.js` — PASS
- `npm run check` — PASS
- `git diff --check` — PASS
