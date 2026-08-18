# Change Intent

## Change ID

`2026-08-15-machine-capability-discovery`

## Status

`in_progress`

## Requested outcome

Make Access Agent machine-adaptive before live browser acceptance. The runtime must observe the active host/workspace environment and dynamically resolve executable capabilities instead of treating a baked command allowlist, one development-machine path, or the currently registered tool list as the complete capability universe. Registered tools remain the current callable adapters; deterministic workspace/governance boundaries remain authoritative.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-machine-capability-discovery.md`
- `docs/REBUILD_REMOTE_COMPLETION_AUDIT_2026-08-14.md`
- `electron/rebuild-main.js`
- `electron/main.js`
- `src/system/machine-environment.js`
- `src/system/governed-terminal.js`
- `src/system/managed-chrome.js`
- `src/system/module-registry.js`
- `src/agent/executive/LiveToolContext.js`
- `src/loop/implementation-executor.js`
- `test/machine-environment-smoke.js`
- `test/governed-terminal-smoke.js`
- `test/managed-chrome-smoke.js`
- `test/live-tool-context-patch-smoke.js`
- `test/rebuild-agent-truth-observability-smoke.js`
- `test/implementation-executor-smoke.js`
- `package.json`

## Intent

Separate capability discovery from execution authority. The agent should understand the machine it is actually running on (platform, architecture, shell identity, PATH/PATHEXT and requested executable availability) and may discover relevant installed executables on demand. A tool registry entry means "callable adapter currently exposed to the model", not "the machine is incapable of everything else". Execution still occurs only through governed runtime adapters; workspace containment, change governance, exact-argv execution, blocked general shell interpreters, and evidence receipts remain hard boundaries. Product infrastructure such as managed Chrome and the interactive terminal should also resolve from the host rather than assuming one Windows installation path or `pwsh.exe` exists.

## Planned changes

1. Add a dependency-free `MachineEnvironment` helper that reports platform/architecture/shell/PATH metadata and resolves requested bare executable names against the live process environment without background polling.
2. Replace the product-level static executable allowlist in `GovernedTerminal` with per-request executable discovery. Keep explicit shell/interpreter denial for arbitrary command-string composition (`cmd`, PowerShell, `bash`, `sh`, WSL) while allowing discovered literal executables such as `python`, `dotnet`, `cargo`, `cmake`, `ffmpeg`, etc. to execute through the governed terminal.
3. Keep LBE execution governance by creating the local executor with the exact requested/discovered executable as the bounded per-request allowed command rather than maintaining a global hard-coded capability list.
4. Add an `inspectEnvironment` non-mutating agent tool for explicit, bounded machine-capability discovery. It may resolve a requested list of executable names; it must not recursively enumerate the machine or poll in the background.
5. Preserve the existing reasoning rule to discover real state before declaring something unavailable. The new environment adapter gives that reasoning loop a concrete discovery path; registered tools remain current callable adapters, not a complete machine inventory.
6. Register the machine-environment helper in the static module capability registry and update the LiveToolContext/governed-terminal ownership contracts without adding a new semantic workflow owner.
7. Remove the same fixed-list coupling from browser `quick_command`; it must use the same dynamic `GovernedTerminal` resolution and must not rewrite package-manager names into machine-specific `.cmd` suffixes before discovery.
8. Remove the same fixed-list default from `ImplementationExecutor`; caller-level narrowing remains available only when explicitly supplied. Its validation command path must also use the governed terminal instead of hard-coding `npm.cmd` on Windows.
9. Make the active rebuild's interactive terminal resolve an available host shell before loading the underlying main runtime instead of relying on its legacy fallback assumptions. This terminal is a user/runtime surface; it does not grant the reasoning model direct unrestricted shell authority.
10. Make Managed Chrome resolve a configured executable override first, then discover supported Chrome/Chromium installations from the current host/PATH and common platform locations; no single `C:\Program Files` path is canonical product behavior.
11. Unless explicitly overridden, select a currently free loopback workspace-bridge port before loading the active main runtime instead of binding product behavior to the legacy `7726` default.
12. Add regression coverage proving dynamic executable resolution, shell denial, workspace cwd, no shell composition, environment evidence, exposure of `inspectEnvironment`, no static quick-command/implementation-executor allowlist, host-aware managed-browser executable discovery, and active rebuild shell/bridge discovery.
13. Preserve provider/browser-conversation semantics and the no-approval contract unchanged.

## Why

Current `LiveToolContext` previously seeded `GovernedTerminal` with `DEFAULT_ALLOWED_COMMANDS` containing mainly Node/package-manager/Git executables. Source audit found the same assumption in browser `quick_command` and `ImplementationExecutor`, plus further host assumptions behind the active rebuild: Managed Chrome defaulted to one Windows Chrome path, the underlying main runtime defaulted its interactive terminal to `pwsh.exe` on Windows, and its workspace bridge defaulted to port `7726`. The first isolated validation confirmed the hidden executor coupling: `ImplementationExecutor` passed an empty compatibility default as an explicitly narrowed allowlist and therefore blocked `node`. These turn development-machine details into product architecture. Cline and the canonical GPT-Knowledge runtime architecture instead treat tools as extensible action adapters and resolve terminal/shell behavior from the active environment. The correction must expand machine awareness without granting the model unrestricted filesystem/shell authority.

## Post-change update

Implementation is complete in source and pending isolated Windows validation.

- `MachineEnvironment` observes platform/architecture, PATH/PATHEXT and requested executable availability on demand; its default snapshot avoids hostname/home/Node-installation-path disclosure.
- `GovernedTerminal` no longer uses a baked product-wide executable list. It discovers the requested executable, bounds LBE to that exact executable for the request, revalidates executable identity, executes literal argv in the active workspace, and records the resolved executable in the receipt.
- Direct `cmd`/PowerShell/pwsh/bash/sh/WSL-style model calls remain denied. Windows `.cmd`/`.bat` files use an internal wrapper adapter only after literal parsing/discovery and reject wrapper-expansion metacharacters.
- `LiveToolContext` exposes bounded `inspectEnvironment`; the tool registry remains a list of current action adapters, not a complete host inventory.
- Browser `quick_command` shares dynamic `GovernedTerminal` discovery and no longer appends `.cmd` or supplies the old static allowlist.
- `ImplementationExecutor` no longer converts the compatibility empty default into an explicit deny-all caller allowlist; narrowing is opt-in only, and validation commands flow through the same machine-aware governed terminal.
- Managed Chrome resolves explicit override -> live PATH -> supported platform locations, while its Access-owned profile and OS-assigned CDP port remain unchanged.
- Active rebuild bootstrap resolves the installed interactive shell and writes that resolved identity into the legacy terminal configuration before loading main runtime.
- Active rebuild bootstrap selects a free loopback workspace-bridge port unless `ACCESS_AGENT_IDE_BRIDGE_PORT` is explicitly provided.
- Environment discovery is action-driven; there is no background machine inventory or capability polling.
- Provider contact, browser conversation semantics, no-approval behavior and workspace mutation governance were not relaxed by this change.

## Validation evidence

Pre-change evidence established the fixed executable list, npm-family `.cmd` rewriting, hard-coded Chrome installation fallback, interactive-shell fallback and fixed internal bridge port. The first isolated Windows validation reached and passed MachineEnvironment/GovernedTerminal smokes but failed `ImplementationExecutor` with `COMMAND_NOT_ALLOWLISTED` for `node`, proving one remaining caller-level coupling. Cline SDK/terminal references and GPT-Knowledge support extensible tools plus host-derived shell/environment identity; a durable GPT-Knowledge reference exists at `ai-agents/machine-capability-discovery-and-governed-execution.md`.

Source regressions cover synthetic execution of an executable outside the old static list, absence/discovery evidence, explicit narrowing, shell denial, workspace cwd, receipt identity, environment adapter exposure, host-aware Chrome discovery and source guards against restoring the old quick-command/static-machine assumptions. Required closure remains: exact-head `npm run check`, followed only if green by a bounded local host-capability inspection and then Browser Loop live acceptance.
