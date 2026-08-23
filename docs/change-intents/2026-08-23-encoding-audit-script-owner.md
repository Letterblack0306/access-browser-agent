# Change Intent

## Change ID

`2026-08-23-encoding-audit-script-owner`

## Status

`completed` (owner declaration; behavior was already wired through `run-encoding-audit.bat`)

## Purpose

Declare an authoritative owner for `scripts/audit-encoding.js`, which the chain-break module audit flagged as `REFERENCED_NO_OWNER_PROVEN` (only reference was `scripts/run-encoding-audit.bat`).

## What the script does

A 40+ line workspace encoding auditor. It walks a target directory tree (or `process.cwd()` by default) up to depth 20, skipping `.git`, `node_modules`, `dist`, `build`, `.pytest_cache`, `AppData`, `Downloads`, `.vscode`, `.idea`, and reads every text/JS/JSON/Markdown/PS1/log/yml/yaml file under 2 MB. Each line is tested against a mojibake regex (`\uFFFD`, C1 control bytes, and known Windows-codepage artifact patterns). Hits are returned as JSON `{file, line, snippet}` for downstream consumption.

It is a one-shot diagnostic utility, not part of `npm run check` and not loaded by the renderer. It is **not dead code** — the `.bat` wrapper at `scripts/run-encoding-audit.bat` invokes it as a Windows-only maintenance task to scan a drive for encoding damage and dump the JSON report to `G:\temp\encoding-audit-G.json`.

## Target files

- `scripts/audit-encoding.js` (the diagnostic script)
- `scripts/run-encoding-audit.bat` (the Windows wrapper that invokes it)

## Owner

Windows encoding-audit wrapper owner: the `.bat` file is the canonical entry point for ad-hoc encoding checks outside the npm check chain.

## Why it is not in `package.json` or `docs/MODULE_REGISTRY.md`

The script is intentionally out-of-band:
- It is a **manual maintenance** tool, not a CI gate. Running it on every `npm run check` would slow the pipeline for no benefit (the regex is heuristic and would produce false positives on legitimate UTF-8 boundary bytes).
- It is **Windows-specific** by way of the `.bat` wrapper. A POSIX shell wrapper would require `find -print0` and `xargs -0`, which is a separate implementation.
- The script's outputs are JSON written to `G:\temp\`, which is operator-supplied output state, not repository state. There is no contract to assert on every build.

For these reasons, the audit's `REFERENCED_NO_OWNER_PROVEN` flag is a false positive in the strictest sense: the owner exists (the `.bat` wrapper) and is intentional. This doc registers the owner relationship so the audit's static reference scan picks it up.

## Validation evidence

- The `.bat` wrapper's command line is:
  `node "G:\Developments\46_Accecc_Browser_Agent\Browser Agent\scripts\audit-encoding.js" "G:\." > "G:\temp\encoding-audit-G.json" 2>&1`
- Running the script standalone (`node scripts/audit-encoding.js`) produces the documented JSON structure.

## Reference history

- The script was first observed in the chain-break audit at head `f4c6f85` with only the `.bat` reference.
- This owner doc pins the script as a manual maintenance utility with the `.bat` wrapper as its declared invocation entry point.
