# Browser isolation and AX hardening

## Change ID

`2026-08-22-browser-isolation-ax-hardening`

## Status

completed

## Requested outcome

Give ordinary agent browser tabs a CDP browser context separate from the persistent relay profile and expose bounded accessibility evidence in browser snapshots.

## Intent

Keep the exact provider relay target in the managed persistent profile while creating general browser-tool targets inside an Access-owned CDP browser context. Add bounded AX-tree projection without raw page HTML or screenshots by default.

## Planned changes

- Create and dispose one owned CDP browser context for the general browser runtime.
- Bind all general browser targets to that context and invalidate it on browser-generation changes.
- Add bounded AX-tree projection to `browserSnapshot` when CDP Accessibility is available.
- Add deterministic regression coverage for context ownership, AX projection, optional-host fallback, and post-create navigation.

## Why

The current general browser runtime creates ordinary tabs in the browser's default persistent context and only enforces logical target ownership. The runtime also exposes DOM-derived snapshots without a native accessibility projection.

## Target files

- `src/browser/browser-tool-runtime.js`
- `test/browser-tool-runtime-smoke.js`
- `docs/CURRENT_STATUS.md`
- `docs/change-intents/2026-08-22-browser-isolation-ax-hardening.md`
- `docs/CHANGE_INDEX.md`

## Post-change update

Bounded AX projection and an opt-in strict CDP-context path are implemented. Live Managed Chrome acceptance proves ordinary HTTPS target creation, explicit Page navigation, readiness/settlement, and AX retrieval. The host rejects optional CDP browser-context creation with `Not allowed`; the runtime now records that as an explicit optional-isolation fallback and continues with logical ownership. Strict isolation remains host-blocked.

## Validation evidence

- `node test/browser-tool-runtime-smoke.js` — PASS
- `npm run check` — PASS
- Live managed Chrome `Target.createBrowserContext` probe — BLOCKED by host response `Not allowed`
- Live Managed Chrome `BrowserToolRuntime.open` + `snapshot` probe — PASS (`https://example.com/`, AX `available`, 15 nodes)
- `git diff --check` — PASS
