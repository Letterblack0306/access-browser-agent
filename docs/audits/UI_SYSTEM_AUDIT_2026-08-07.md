# Browser Dev UI System Audit — 2026-08-07

## Scope

Branch: `feat/browser-capability-hardening`

Authority:

- `GPT-Knowledge/letterblack-branding/industrial-dark-ui-system.md`
- `GPT-Knowledge/letterblack-branding/ui-screen-system.md`
- current Browser Dev runtime, preload, renderer, shell, settings, browser, diagnostics, evidence, Git, editor, and terminal contracts

This audit treats the UI as an operational instrument. A control existing in HTML is not evidence that its capability exists. A green transport state is not evidence that the current operation succeeded. Errors must remain visible where the operator can act on them.

## System principles applied

1. Runtime truth before visual optimism.
2. Configured, connected, healthy, active operation, waiting, completed, and failed are separate states.
3. Errors stay visible and are not overwritten by unrelated healthy state.
4. Missing capabilities are shown as unavailable instead of remaining deceptively clickable.
5. Primary navigation is compact and semantic; supporting modules remain reachable through grouped workflow surfaces.
6. Keyboard-visible focus and keyboard-operable resize/navigation behavior are part of the workbench contract.
7. Local asset references are validated; dead scripts/styles cannot silently remain in the shell.
8. Industrial Dark uses thin structural borders, dense spacing, restrained radius, red for active/critical signals, green for verified health, amber for waiting, and muted gray for inactive state.
9. Terminal, trace, evidence, Git diff, browser result, provider state, and runtime errors remain inspectable rather than being replaced by decorative success states.

## Findings and corrections

### UI-01 — Browser transport health masked browser action failure

Status: FIXED

The Browser / Agent summary previously preferred `BROWSER CONNECTED` over `browserResult`, allowing a failed target-selection operation to remain invisible while CDP itself was healthy.

Correction:

- Browser transport and Browser action are separate fields.
- Agent lifecycle and provider state remain separate fields.
- browser-action failures are preserved independently of CDP health.

### UI-02 — Workbench visual system was still VS Code-blue rather than Letterblack Industrial Dark

Status: FIXED

Correction:

- canonical near-black/charcoal surfaces applied;
- Letterblack red is the action/active/critical signal;
- verified healthy state is green;
- waiting state is amber;
- status bar is no longer a large blue decorative surface;
- panel/card density and border hierarchy were tightened.

### UI-03 — Navigation used text slugs rather than canonical semantic icons

Status: FIXED

Correction:

- primary workbench rail renders compact inline SVG icons using `currentColor`;
- text labels remain available through `title` and `aria-label`;
- active rail state is distinct from hover state;
- supporting modules remain grouped under Workspace Tools and Diagnostics instead of being deleted.

### UI-04 — Resize handles were keyboard-focusable but not keyboard-operable

Status: FIXED

Correction:

- left and bottom splitters respond to directional arrow keys;
- Shift provides a larger resize step;
- pointer cancellation is cleaned up;
- active rail state now maintains `aria-current`.

### UI-05 — Editor removed visible keyboard focus

Status: FIXED

Correction:

- editor now has a restrained visible focus boundary;
- editor, find UI, diff surfaces, tabs, and activity states use Industrial Dark surfaces;
- running, waiting, failed, and completed activity states have distinct semantic signals.

### UI-06 — Settings failures were only visible in global/footer provider state

Status: FIXED

Correction:

- Settings now has an inline provider status surface adjacent to provider actions;
- provider errors/waiting/ready state remain visible where configuration is performed.

### UI-07 — Unhandled renderer errors could exist only in DevTools/terminal

Status: FIXED

Correction:

- a persistent status-bar UI error surface captures uncaught renderer errors and unhandled promise rejections;
- the exact failure remains visible until dismissed;
- local surfaces such as agent notice, file state, Git state, browser result, MCP, and settings are included in the semantic truth observation layer.

### UI-08 — Shell referenced nonexistent local assets

Status: FIXED

`index.html` still referenced:

- `workspace-sync.css`
- `workspace-sync.js`
- `project-audit.css`
- `project-audit.js`

Those files do not exist on this branch.

Correction:

- stale references were removed rather than recreating duplicate owners;
- `test/ui-asset-contract-smoke.js` now verifies every local `./` script/style reference exists and is loaded only once;
- the asset-contract smoke is part of the full `npm run check` chain.

### UI-09 — Workspace Sync and Project Audit looked executable without runtime/preload contracts

Status: TRUTHFULLY BLOCKED IN UI

The renderer still has module templates, but the current preload contract exposes neither Workspace Sync operations nor Project Audit operations.

Correction:

- the modules are not silently deleted;
- their controls are disabled when the corresponding runtime API is absent;
- status becomes `UNAVAILABLE` with the concrete reason in the visible surface and tooltip.

Required future runtime work:

- restore or implement the authoritative Workspace Sync runtime/preload contract if this capability is still required;
- restore or implement the authoritative Project Audit runtime/preload contract if this capability is still required;
- only then re-enable the UI controls.

### UI-10 — Corrupt backup file remained inside the active Electron source tree

Status: FIXED

`electron/agent-event-store.js.corrupt-backup` had no runtime references and was removed. Recovery history belongs in Git, not beside active source under a misleading executable filename.

## Validation contract added/strengthened

The UI regression layer now checks:

- semantic Browser transport/action/lifecycle separation;
- Industrial Dark canonical tokens;
- semantic SVG primary navigation;
- visible keyboard focus;
- keyboard resizers and ARIA current state;
- missing capability truth surfaces;
- persistent unhandled UI error visibility;
- stale/missing local shell assets;
- editor state/focus semantics.

## Current verdict

The Browser Dev UI is now structurally aligned with the Letterblack Industrial Dark and state-truth principles at source level.

This is **not yet a runtime PASS for this audit batch** until the updated branch is pulled locally and the complete validation chain passes. Workspace Sync and Project Audit remain explicit runtime capability gaps; the UI now reports that truth instead of simulating availability.

## Required local validation

```powershell
git pull --ff-only origin feat/browser-capability-hardening
node --check .\electron\workbench-ux.js
node --check .\electron\shell-module-manager.js
node .\test\ui-asset-contract-smoke.js
node .\test\workbench-ux-smoke.js
node .\test\electron-shell-smoke.js
npm.cmd run check
npm.cmd start
```

Runtime review after the suite is green should be performed as a **whole cockpit review**, not one-button-at-a-time: navigation, orientation, provider/browser/agent truth, editor, terminal, Git, Workspace Tools, Diagnostics, error visibility, keyboard focus, resizing, and compactness should be inspected together.
