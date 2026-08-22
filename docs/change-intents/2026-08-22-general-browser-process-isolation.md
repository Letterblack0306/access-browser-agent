# General browser process isolation

## Change ID

`2026-08-22-general-browser-process-isolation`

## Status

completed

## Requested outcome

Keep general agent browser tabs out of the persistent provider relay browser even when the host rejects CDP browser-context creation.

## Intent

Use one Access-owned Managed Chrome process/profile for provider relay identity and a separate Access-owned Managed Chrome process/profile for general browser tools. Preserve the existing logical target ownership and optional CDP context hardening inside the general process.

## Planned changes

- Let `BrowserSessionAuthority` use a dedicated general-browser Managed Chrome owner.
- Keep relay startup, target selection, and ChatGPT identity on the existing managed browser.
- Stop both owned browser processes during application shutdown and authority stop.
- Add regression coverage proving the general endpoint owner is distinct from the relay owner.

## Why

The active Chrome 151 host rejects `Target.createBrowserContext` with `Not allowed`. A separate process/profile provides a product-owned isolation boundary without relying on that host capability.

## Target files

- `electron/browser-session-authority.js`
- `electron/main.js`
- `test/browser-session-authority-smoke.js`
- `docs/CURRENT_STATUS.md`
- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-22-general-browser-process-isolation.md`

## Post-change update

Implemented. Relay identity remains on the configured persistent Managed Chrome profile. General browser tools now use a separate Access-owned Managed Chrome process/profile, so host rejection of CDP browser-context creation cannot place general tabs in the relay browser.

## Validation evidence

- `node test/browser-session-authority-smoke.js` — PASS
- `npm run check` — PASS
- Live two-process Managed Chrome probe — PASS; relay and general endpoints/profiles were distinct
- `git diff --check` — PASS
