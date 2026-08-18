# Change Intent

## Change ID

`2026-08-16-general-browser-tools-evals`

## Status

`in_progress`

## Requested outcome

Add a separate governed general-browser capability for the adaptive local agent so it can open and inspect ordinary HTTP/HTTPS sites, navigate owned browsing tabs, read bounded page snapshots, and perform explicit click/type/scroll actions without converting the existing ChatGPT `ProviderChannel` transport into a generic browser. Add deterministic eval-style scenarios, informed by `openai/evals`, that measure tool exposure, target isolation, navigation restrictions, snapshot evidence, and interaction behavior.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-16-general-browser-tools-evals.md`
- `src/browser/browser-tool-runtime.js`
- `src/agent/executive/LiveToolContext.js`
- `electron/browser-session-authority.js`
- `test/browser-tool-runtime-smoke.js`
- `test/browser-tool-evals.js`
- `package.json`

## Intent

Preserve the current exact-chat transport boundary while adding a distinct browser-use surface for ordinary web research. Generic browsing must use the same Access-owned Managed Chrome/CDP backend but operate only on targets created and owned by the browser-tool runtime. It must never silently attach to, navigate, or reuse the ChatGPT relay target. The reasoning agent receives browser actions as ordinary registered tools and remains responsible for deciding when they are useful; there is no semantic browser workflow machine.

## Planned changes

1. Add a dependency-free `BrowserToolRuntime` over `chrome-remote-interface` with dynamic endpoint acquisition from Managed Chrome.
2. Support provider-compatible `browserOpen`, `browserTabs`, `browserNavigate`, `browserSnapshot`, `browserClick`, `browserType`, `browserScroll`, and `browserClose` tools for runtime-owned page targets.
3. Restrict URLs to HTTP/HTTPS and reject `file:`, `javascript:`, `data:`, browser-internal schemes, malformed URLs, and credential-bearing URLs.
4. Keep target ownership explicit. `browserTabs` may report visible page metadata, but mutating/interactive operations are accepted only for targets created by this browser runtime. This prevents collision with the exact ChatGPT transport target.
5. Bind ownership to both target ID and the Managed Chrome CDP endpoint generation so browser restart/target-ID reuse invalidates stale ownership rather than silently reattaching.
6. Make `browserSnapshot` return bounded page text plus a bounded interactive-element inventory with generated page-local references; do not return raw full HTML by default.
7. Make click/type/scroll actions verify target ownership and element presence/visibility before dispatch. Type clears and inserts text without implicitly submitting the form. Click blocks explicit form-submit controls, downloads, and file pickers, and reports action dispatch without claiming downstream success until a subsequent observation.
8. Register the browser tools in `LiveToolContext` with a lazy runtime accessor. `BrowserSessionAuthority`, which already owns the real Managed Chrome instance, installs the shared `BrowserToolRuntime` after browser authority construction so the agent and exact-chat relay share Chrome/CDP infrastructure without sharing target ownership.
9. Add deterministic smoke coverage using a fake CDP surface for protocol rejection, ownership isolation, browser-generation invalidation, navigation, snapshots, click/type/scroll, and close behavior.
10. Add an eval-style scenario runner patterned after the `openai/evals` separation of cases, execution, grading, and aggregate score. It will evaluate this local browser-tool contract without adding a Python/OpenAI-API runtime dependency to the Electron application.
11. Add `npm run eval:browser` and include the browser runtime smoke in the standard agent-led/check path.

## Why

The active rebuild currently has strong browser transport machinery but `ProviderChannel` deliberately accepts only supported chat conversation URLs and the reasoning agent's registered tool set contains no general browser actions. That means the product can use ChatGPT as an instruction/result transport but cannot independently visit an arbitrary website to research, inspect, or interact with it. `openai/evals` is relevant as an evaluation framework for tool-using agents, not as a browser-control library; its useful pattern here is to create explicit task cases and graders so browsing capability is regression-tested instead of assumed.

## Source implementation update

Source implementation is complete on `feat/general-browser-tools-evals-20260816` and is under draft review in PR #16.

- `BrowserToolRuntime` is separate from `ProviderChannel`; the existing supported-chat URL restriction was not removed.
- General browser operations are exposed to the reasoning agent as eight ordinary tool adapters and return observations through the existing tool loop.
- General browser mutations/interactions require runtime-owned targets. Existing/unowned page targets remain observable through `browserTabs` but cannot be navigated, clicked, typed into, scrolled, or closed by the general browser tools.
- Ownership is bound to the CDP endpoint observed when the target is created. A Managed Chrome restart or endpoint generation change invalidates the old ownership before attach/action.
- Page snapshots are bounded and generate temporary page-local refs. Raw full HTML is not the default observation surface.
- Click/type behavior intentionally does not claim downstream success: click reports action dispatch with `downstreamOutcome: UNVERIFIED`; type never presses Enter and reports `submitted: false`.
- Explicit form-submit controls, downloads, file pickers, password inputs, hidden inputs, file inputs, non-HTTP(S) navigation, and credential-bearing URLs are blocked in the browser-tool layer.
- Deterministic fake-CDP smoke coverage and a machine-readable eval-style aggregate runner are committed and wired into `check:agent-led`; `npm run eval:browser` is available as the focused eval entrypoint.

## Validation requirements

- Syntax checks for the new browser runtime and modified integration files.
- Deterministic fake-CDP smoke tests pass.
- Eval-style browser scenarios produce a machine-readable score and fail the process when required cases fail.
- `LiveToolContext` exposes the browser tools through a lazy runtime accessor and returns explicit UNAVAILABLE evidence if the browser authority has not installed the runtime yet.
- Existing `ProviderChannel` chat-only URL restriction remains unchanged.
- Existing exact-chat relay target cannot be navigated through the generic browser runtime.
- Browser restart/CDP generation change invalidates previously owned targets.
- Full repository `npm run check` still requires local/CI execution and must not be represented as passed until runtime evidence exists.

## Current validation evidence

Connector-side diff review confirms the feature branch is based on the exact PR #15 rebuild head and changes only the declared browser/eval/governance files. GitHub did create one Actions run for the current feature head, but it concluded `startup_failure` before creating any jobs; its workflow record points to a deleted workflow path named `BuildFailed`. Therefore it is not evidence that repository tests executed or failed. A separate temporary checkout attempt also could not run because the execution environment could not resolve `github.com`. `npm run check`, `npm run eval:browser`, and real Managed Chrome/provider browsing remain **unverified runtime claims** rather than passes.


## Post-change update


Local isolated-worktree validation was performed against exact PR #16 head `8784866fcac9f286fbbd0d8eb0d80054b5f52f7c`.


- `package.json` / `package-lock.json` drift was discovered because `npm ci` initially failed with missing declared dependencies.
- `npm install` regenerated `package-lock.json`; a subsequent clean `npm ci` completed successfully with 393 packages installed.
- `test/browser-tool-runtime-smoke.js` passed.
- `npm run eval:browser` passed all 6/6 cases with aggregate score `1`.
- The eval explicitly proved an unowned ChatGPT transport target is rejected with `BROWSER_TARGET_NOT_OWNED`.
- The eval proved owned browser navigation/close preserves the transport target.
- Interaction evidence remains intentionally conservative: click reports downstream outcome `UNVERIFIED`; type reports `submitted: false`.
- Dependency audit reported 15 vulnerabilities (12 moderate, 3 high). No automatic or force audit remediation was performed.
- Full repository `npm run check` was executed after governance completion. It progressed through governance, module status, workspace sync, workspace contract checks, and into `check:agent-led`, then stopped at the pre-existing `test/agent-runtime-resilience-smoke.js` assertion expecting `waiting_for_dependency` while the unchanged current runtime continued after a failed tool observation and returned `completed`. This test and `LiveAgentCore` are unchanged between PR base `0bf53e30208dc415cd0ac2b6da33252dacfc76c2` and PR head, so this is recorded as an out-of-scope pre-existing blocker rather than a browser-tool regression.


## Validation evidence


Proven locally in detached worktree `G:\Developments\46_Accecc_Browser_Agent\Browser Agent_PR16_VALIDATE` at PR head `8784866fcac9f286fbbd0d8eb0d80054b5f52f7c`:


- `npm ci`: PASS after regenerating the stale lockfile.
- `node test/browser-tool-runtime-smoke.js`: PASS.
- `npm run eval:browser`: PASS, 6 passed / 0 failed / score 1.0.
- URL policy: PASS.
- Browser tool manifest exposure: PASS.
- Transport-target isolation: PASS (`BROWSER_TARGET_NOT_OWNED`).
- Open/snapshot evidence: PASS.
- Interaction non-overclaim behavior: PASS.
- Owned navigation/close preserving transport: PASS.
- Full repository `npm run check`: BLOCKED by pre-existing out-of-scope resilience-test mismatch. Browser smoke and eval coverage passed before that blocker.
