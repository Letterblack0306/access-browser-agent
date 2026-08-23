# Change Intent

## Change ID

`2026-08-23-ui-asset-contract-smoke-owner`

## Status

`completed` (owner declaration; behavior was already passing in `npm run check`)

## Purpose

Declare an authoritative owner for `test/ui-asset-contract-smoke.js`, which the chain-break module audit flagged as `REFERENCED_NO_OWNER_PROVEN` (only mention was a passing reference in `docs/audits/UI_SYSTEM_AUDIT_2026-08-07.md`).

## What the test does

A 30-line workbench asset-contract regression. It reads `electron/index.html`, extracts every local `./` script and stylesheet reference, and asserts:

- Every local `./...` reference exists on disk (no missing assets).
- No local asset is loaded twice (no duplicate `<script src="./X.js">` or `<link href="./X.css">` tags).
- At least one local asset is referenced (sanity that the assertion is meaningful).

This is the workbench's only automated guard against broken `<script src="./missing.js">` paths and duplicate load ordering. Without it, a typo in a script path would silently leave a feature half-loaded, and a duplicate load could double-initialize state.

## Target files

- `electron/index.html` (the asset surface under contract)
- `test/ui-asset-contract-smoke.js` (the contract enforcement)

## Owner

Workbench asset-contract owner: the rebuild workbench guarantees that `index.html` references resolve to existing files and are loaded exactly once.

## Validation evidence

- `node test/ui-asset-contract-smoke.js` — PASS, observed in the full `npm run check` chain (`check:rebuild`).
- This test is part of the `check:rebuild` smoke set, which runs after every rebuild-trace pass.
- The audit log at `docs/audits/UI_SYSTEM_AUDIT_2026-08-07.md:121` records the assertion's original purpose: "stale references were removed rather than recreating duplicate owners; `test/ui-asset-contract-smoke.js` now verifies every local `./` script/style reference exists and is loaded only once; the asset-contract smoke is part of the full `npm run check` chain."

## Why a smoke was needed

The original workbench had a window where stale script references accumulated (referenced but not loaded) and the test was the contract that broke that pattern. Without it, dead UI shells and hidden legacy scripts would silently survive removal, as documented in earlier orphan-triage audits.

## Reference history

- The test was first observed in the UI_SYSTEM_AUDIT_2026-08-07 audit at line 121.
- It has been part of the `check:rebuild` chain since the audit was written.
- This owner doc pins the test so that any future removal of the asset-contract guarantee would require a governance-aware justification.
