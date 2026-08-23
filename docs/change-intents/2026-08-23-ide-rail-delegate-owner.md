# Workbench activity-rail delegate owner — 2026-08-23

## Source

`chain-break-audit.js` module audit run at HEAD `f4c6f85` flagged `electron/rebuild-ide-reference.js` as `REFERENCED_NO_OWNER_PROVEN` — the module was wired and tested (39 buttons, 14 static refs, 3 tests) but had no declared owner in `package.json`, `docs/MODULE_REGISTRY.md`, or any change-intent doc.

## Decision

Wire the module as a renderer-side event-delegation owner. Add a contract to `RUNTIME_MODULES` in `src/system/module-registry.js` with `electron/rebuild-shell.js` as the parent. Regenerate `docs/MODULE_REGISTRY.md` via `npm run module:tree`.

The contract name is `ide-rail-delegate`. The behavior is binding the 6 glyph buttons to the center/right tab clicks; success is the two-way update; failure is the no-side-effects path when markup is missing.

## Source-code evidence

The module at `electron/rebuild-ide-reference.js:24-31` registers a single click listener on the activity rail and dispatches synthetic clicks to selectors from the frozen `targets` map. The same module at `:33-42` registers a document-level click listener for center/right tab clicks that re-syncs the rail. Both paths are local DOM mutations; no IPC, no provider, no runtime, no browser, no file system.

The HTML loads the script between `rebuild-renderer.js` (which mounts the workbench) and `rebuild-reset-actions.js` (which wires the dropdown). This load order is correct: shell markup must exist before the delegate attaches, and the Reset dropdown can coexist because it operates on a different DOM region.

## Test contracts

- `test/electron-shell-smoke.js:28` asserts the index.html references `rebuild-ide-reference.css`. The smoke must continue to pass.
- `test/workbench-ux-smoke.js:10-21` reads `rebuild-ide-reference.js` and asserts it contains `data-ide-activity-rail`, `data-ide-target`, `aria-pressed`. The smoke must continue to pass.

The `npm run check:module-registry` check now asserts the new contract is present in the registry, and `npm run module:tree` regenerates `docs/MODULE_REGISTRY.md` to include the new module.

## Validation

- `node --check src/system/module-registry.js` — syntax.
- `npm run check:module-registry` — registry contract complete.
- `npm run module:tree` — regenerate `docs/MODULE_REGISTRY.md`.
- `npm run check` — full pipeline green.

## Companion cleanup in this same change

The module audit also flagged `electron/modules/project-audit.js` as `REFERENCED_NO_OWNER_PROVEN`. On inspection, the file is **0 bytes** and the audit log at `docs/audits/UI_SYSTEM_AUDIT_2026-08-07.md:111-115` explicitly states that the file "does not exist on this branch" — meaning the 0-byte stub violates the documented contract that the file should not exist at all.

`scripts/register-electron-audit-sync.cjs` was the only producer of a `project-audit` module in the workbench layout, and `test/electron-shell-smoke.js:38-39` has a `retained` allow-list that explicitly excludes `project-audit` — so adding it back would break the smoke.

Both files were deleted as part of this triage: the 0-byte stub file and the orphan script that would re-add it. The audit's "does not exist" contract is now satisfied.

The `RAIL_ICON_PATHS['project-audit']` entry in `electron/shell-module-manager.js` becomes a dead string key after the script deletion, but it is harmless: the icon lookup falls through to a default path when no module with id `project-audit` is registered, and the test contract ensures none ever will be.
