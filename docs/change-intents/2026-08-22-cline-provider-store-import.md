# Cline provider-store import

## Change ID

`2026-08-22-cline-provider-store-import`

## Status

in_progress

## Requested outcome

Reuse an existing Cline login from the standard local Cline provider store without exposing or mutating that store.

## Intent

Add a read-only, schema-limited import path for `providers.cline.settings.auth` in Cline's provider store. Keep Access Agent's own preferences and OAuth flow authoritative for Access Agent writes and logout.

## Planned changes

- Add a small provider-store reader with an environment override and the platform default path.
- Load existing Cline credentials only when Access Agent preferences do not already contain credentials.
- Preserve explicit Access Agent logout and never write to Cline's provider store.
- Add focused tests for path resolution, valid import, malformed input, and no-token logging.

## Why

The existing UI auth session reads only Access Agent's own preferences directory, while the installed Cline client stores provider credentials at the user-level `providers.json` path.

## Target files

- `src/llm/ClineProviderStore.js`
- `src/llm/ClineAuthSession.js`
- `test/cline-provider-store-smoke.js`
- `package.json`
- `docs/change-intents/2026-08-22-cline-provider-store-import.md`
- `docs/CHANGE_INDEX.md`

## Post-change update

Implemented. Access Agent now performs a read-only fallback import from the configured Cline provider store when its own preferences do not contain Cline credentials. Access Agent OAuth login, refresh, persistence, and logout remain app-owned; the Cline provider store is never written or cleared.

## Validation evidence

- `node test/cline-provider-store-smoke.js`
- `node test/cline-provider-smoke.js`
- `npm run check:agent-led`
- `npm run check:rebuild`
- `npm run check`
- `git diff --check`
