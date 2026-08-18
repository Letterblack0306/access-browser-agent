# Change Intent

## Change ID

`2026-08-17-innosetup-installer-packaging`

## Status

`in_progress`

## Requested outcome

Package the Access Browser Agent Electron application into a distributable Windows setup using `electron-builder` for the packaged executable output and the existing Inno Setup scaffold (`installer/BrowserAgent.iss`) as the declared single installer definition. Produce a real setup EXE, compile it with Inno Setup `ISCC.exe`, and record install-smoke runtime evidence against the canonical R4 branch.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-17-innosetup-installer-packaging.md`
- `package.json` (add `electron-builder` devDependency, `dist`/packaging script, and `build` configuration block)
- `electron-builder.yml` (or equivalent declared packaging config block in `package.json`)
- `installer/BrowserAgent.iss`
- `installer/README.md`
- `installer/assets/.gitkeep`

## Intent

Keep the canonical R4 source of truth (`refactor/browser-conversation-turn-transport-20260816` at `f46ed1cf1175c587debcb35cde8c43775cd90321`) intact and set the installer packaging on its side without altering application runtime behaviour. `electron-builder` produces the packaged `.exe` output; Inno Setup compiles that output and the `installer/BrowserAgent.iss` scaffold into the final setup file. The `.iss` `[Files]`/`[Icons]`/`[Run]` sections must be pointed at the real packaged EXE location once `electron-builder` output is proven. No runtime code changes are authorized by this change.

## Planned changes

1. Add `electron-builder` as a devDependency and a `dist` script that produces the packaged app output (the actual EXE for the app, plus the portable/win dir as packaged output).
2. Declare a `build` configuration block (or `electron-builder.yml`) with app metadata, `files`, `directories.output`, and Windows `target`/`icon` placeholders.
3. Merge the `installer/` scaffold (README, `BrowserAgent.iss`, `assets/.gitkeep`) from the `feat/innosetup-installer-20260817` point into the canonical branch so the Inno Setup definition is governed here.
4. Update `installer/BrowserAgent.iss` to reference the real `electron-builder` output path for `[Files]`/`[Icons]`/`[Run]` once the EXE location is proven at runtime.
5. Compile the setup with `ISCC.exe` and run a silent install smoke test in a clean location, capturing runtime evidence.

## Non-goals

- No change to Electron runtime entry point, browser transport, agent loop, provider behaviour, or any source under `src/`, `electron/`, `scripts/` other than the packaging scripts referenced above.
- No change to `main` target (`electron/rebuild-main.js`).
- No automatic security/remediation of unrelated dependency audit findings.

## Key constraints

- The canonical R4 runtime (`Browser Agent_R3_CANONICAL` @ `f46ed1c`) remains the source of truth; the packaging change must not alter its identity or start behaviour.
- No installer artifact is claimable as "built" until an EXE is actually generated and the `.iss` references the proven EXE path at runtime.
- `ISCC.exe` must be confirmed present before claiming a compiled setup exists.
- Full repository `npm run check` still requires local execution and must not be represented as passed until runtime evidence exists.

## Current validation evidence

The canonical branch at `f46ed1cf1175c587debcb35cde8c43775cd90321` is clean, has governance present, and `package.json` declares `"main": "electron/rebuild-main.js"` with `electron` as a dependency. The installer scaffold commits exist on `feat/innosetup-installer-20260817` at `640f792` (README) and `d641389` (`.iss`), but the `.iss` still has `[Files]`/`[Icons]`/`[Run]` sections commented out and contains no resolved EXE path. No `electron-builder`/`electron-forge` tooling, no `dist`/`release`/`out` output directory, and no `ISCC.exe` in standard Inno Setup install locations have been proven so far.

## Why
The canonical R4 runtime is already validated at commit f46ed1cf1175c587debcb35cde8c43775cd90321, but the repository does not yet have a proven distributable Windows installer path. Packaging must therefore be added as a bounded release-layer change without modifying the validated runtime behavior. electron-builder is used only to create the packaged application directory, and Inno Setup remains the single declared installer definition that turns that proven package output into the final setup executable.
## Post-change update

Packaging step executed against canonical R4 head `f46ed1cf1175c587debcb35cde8c43775cd90321` on `Browser Agent_R3_CANONICAL`:

- Added `electron-builder` as a devDependency; moved `electron` from `dependencies` to `devDependencies` (electron-builder requires this); added `author` field.
- Added `build` config block (productName `Access Browser Agent`, `directories.output=release`, `files` for electron/src/scripts/skills/docs, win x64 `dir` target) and `npmRebuild:false`.
- Added `dist` (`electron-builder --dir`) and `dist:installer` (`electron-builder`) scripts.
- `npm install` resolved 298 packages; `electron-builder@25.1.8` installed successfully.
- `npm run dist` completed (background, due to 30s runner ceiling): produced `release\win-unpacked\Access Browser Agent.exe` (~201 MB) and `resources\app.asar` (~144 MB).
- Native rebuild of `node-pty` was skipped via `npmRebuild:false` because (a) the worktree path contains a space (`Browser Agent_R3_CANONICAL`) which node-gyp cannot handle, and (b) no Visual Studio/MSVC build tools are installed on this host. This means the packaged app ships the prebuilt `node-pty` binary, not an Electron-ABI rebuild — a runtime compatibility risk to validate.
- Packaged executable launch test: `Access Browser Agent.exe` started and remained alive for 8s (PID 227064), then was terminated — confirms the packaged app boots.
- Merged `installer/` scaffold from `feat/innosetup-installer-20260817` into canonical: `installer/BrowserAgent.iss`, `installer/README.md`, `installer/assets/.gitkeep`.
- Updated `installer/BrowserAgent.iss` to reference the real packaged EXE path (`..\release\win-unpacked\*`), populated `[Files]`/`[Icons]`/`[Run]`, and set installer name `Browser_Agent_Setup` (`Browser Agent Setup.exe`) per confirmed decision.

## Validation evidence

- Packaged EXE path proven: `release\win-unpacked\Access Browser Agent.exe` (210,896,896 bytes).
- `app.asar` present (144,376,773 bytes); `app.asar.unpacked` created for native modules.
- `electron-builder` reported "default Electron icon is used" and "signing is skipped" (no signing config) — expected, not a failure.
- **BLOCKED**: `ISCC.exe` not found in standard Inno Setup install locations, so the `.iss` has not been compiled and no setup EXE has been generated. The install smoke test (silent install + launch) is pending ISCC availability.