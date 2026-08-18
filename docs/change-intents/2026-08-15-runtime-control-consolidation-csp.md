# Change Intent

## Change ID

`2026-08-15-runtime-control-consolidation-csp`

## Status

`in_progress`

## Requested outcome

Restore the previously agreed browser-owned instruction workflow and keep the rebuild control surface minimal. Ordinary users paste the exact supported chat URL and press one stateful `Start`/`Stop` control. Start demand-activates the internal runtime, opens that exact conversation in Access-owned managed Chrome, proves provider readiness, binds the exact target and enters `waiting_for_browser`. Local manual task composition, preparatory runtime controls and manual browser/target setup are not part of the normal workflow. Managed Chrome owns a persistent Access-specific profile and dynamically allocated CDP port by default so normal use does not require profile/port selection. Recovery actions are consolidated into one Reset dropdown without conflating layout reset with settings reset. Also remove known strict-CSP layout violations without adding `unsafe-inline`.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-runtime-control-consolidation-csp.md`
- `docs/REBUILD_REMOTE_COMPLETION_AUDIT_2026-08-14.md`
- `electron/index.html`
- `electron/preload.js`
- `electron/rebuild-renderer.js`
- `electron/rebuild-shell.js`
- `electron/rebuild-reset-actions.js`
- `electron/rebuild-settings.js`
- `electron/main.js`
- `src/system/managed-chrome.js`
- `test/managed-chrome-smoke.js`
- `test/rebuild-shell-smoke.js`
- `test/rebuild-agent-truth-observability-smoke.js`

## Intent

Browser conversation state owns the objective/instruction stream. The local agent does not ask the user to duplicate instructions in a local composer and does not begin a separate local planning workflow before browser instructions arrive. The normal path is `exact chat URL -> Start -> internal runtime activation if needed -> provider capability proof -> Access-owned managed Chrome/dynamic CDP -> exact URL open/verification -> relay WAITING -> browser instruction -> adaptive local execution -> result delivery -> WAITING`. The exact conversation URL is the durable conversation identity; transient CDP ports and target IDs are runtime evidence, not user-selected ownership. Access owns its managed Chrome endpoint and profile by default so the user does not manually resolve ports, enumerate tabs, select targets or choose a profile in the normal path. Recovery controls remain separate from normal Start and preserve persisted provider/browser/workspace settings unless their specific action says otherwise. Strict CSP remains `style-src 'self'`.

## Planned changes

1. Remove the local `Run task` composer, `Ctrl+Enter` instruction path and local task Stop control from the active rebuild UI/bindings. Remove the renderer-facing `agentRun` capability so the local window cannot reintroduce a competing manual instruction path. The Task view becomes browser-instruction/session evidence only.
2. Keep one Browser Loop `Start`/`Stop` control next to the exact Chat URL. `Start` performs the complete runtime/provider/browser/relay sequence and enters waiting-for-browser; `Stop` ends the loop.
3. Move recovery/global shutdown out of the normal start path. Keep Reset/Stop All only as recovery/diagnostic controls, not required preparatory clicks.
4. Consolidate the existing reset/recovery actions into one top-bar `Reset` dropdown so the user does not hunt across panels. The dropdown exposes reset browser session, reset runtime, reset layout, and Stop All Access resources. It delegates to the existing authoritative controls rather than duplicating lifecycle logic.
5. Keep `Reset layout` narrow: it resets only the rebuild layout storage/state and must not erase provider configuration, browser defaults, workspace choice, exact chat URL, or other persisted settings.
6. Remove the active manual target setup UI (`Start Chrome`, `Refresh tabs`, target dropdown, `Use selected tab`) from the normal Browser Loop surface. Underlying diagnostic APIs may remain for evidence/testing but are not normal user workflow.
7. Keep `Check once` as diagnostic verification only, not required for Start.
8. Preserve one advanced `Reset runtime` action as a deliberate local runtime reconstruction; normal Start demand-activates runtime automatically.
9. Give Managed Chrome a persistent Access-owned default profile when no override is configured. Keep `--remote-debugging-port=0`; discover the actual `DevToolsActivePort` dynamically. A custom profile remains an optional advanced override only, and Settings copy must state that leaving it blank uses the Access-owned profile.
10. Ensure no normal flow scans arbitrary existing browser tabs or asks the user to choose a CDP port/target/profile. Managed Chrome owns its dynamically resolved endpoint and the exact pasted chat URL is opened/validated directly.
11. Keep the existing CSP-safe CSSOM layout-variable patch and strict CSP unchanged.
12. Update source regressions so a future rebuild cannot reintroduce local manual instructions, mandatory manual browser-target setup, mandatory profile/port configuration, or reset controls that bypass the existing lifecycle owners.
13. Re-run isolated Windows `npm run check` and `start:trace`; verify Start enters waiting-for-browser from the pasted exact URL with no preparatory runtime/browser/profile/target clicks and inspect any remaining CSP producer separately.

## Why

The rebuild had reintroduced a local `Run task` composer and an advanced browser-target panel even though the accepted UX removed the local instruction path: browser owns conversation/intent/objectives; Start attaches the browser loop and the local agent waits for browser work. Requiring Start Chrome, Refresh tabs, target selection, runtime activation or a second local instruction duplicates authority and creates unnecessary port/profile/target conflict surface. The backend `startExactLoop()` already performs managed-browser startup, exact-chat opening, target selection and relay startup. Managed Chrome already requests an OS-assigned CDP port (`--remote-debugging-port=0`), but previously rejected a missing configured profile; that remaining setup requirement is now removed by an Access-owned default profile. Recovery controls had also become scattered across the top bar, Browser Loop panel and Runtime tab. A single Reset dropdown reduces recovery clicks while preserving action boundaries: layout reset remains a UI-layout operation only, and Stop All remains Access-owned lifecycle cleanup rather than a settings wipe. Live trace also proved startup CSP violations under strict `style-src 'self'`; the known `RebuildShell` element-inline layout mutation has already been replaced with same-origin stylesheet CSSOM mutation.

## Post-change update

Remote implementation is complete and remains `in_progress` pending isolated Windows validation and live Browser Loop acceptance.

- Browser conversation remains the normal instruction owner and Browser Loop remains exact Chat URL + one stateful Start/Stop control.
- A top-bar `Reset` dropdown now centralizes four existing recovery choices: `Reset browser session`, `Reset runtime`, `Reset layout`, and `Stop All Access resources`.
- The dropdown is implemented by `electron/rebuild-reset-actions.js`, which maps each choice to the existing authoritative control and calls that control. It does not contain independent runtime/browser/settings lifecycle logic.
- The former standalone Reset layout button, Reset browser-session action, Reset runtime action and Stop All button remain as hidden implementation owners so existing tested behavior is reused rather than duplicated.
- `Reset layout` continues to be owned solely by `RebuildShell.reset()`, which replaces only `access-agent.rebuild-layout.v1` state and does not call provider/browser/settings persistence APIs.
- Runtime tab copy now points recovery to the top-bar Reset menu.
- Source regression coverage now asserts that the dropdown contains the four recovery choices, delegates to the existing owners, and does not call runtime/browser/settings APIs directly.
- Managed Chrome continues to use Access-owned profile defaults and dynamic CDP allocation.
- Strict CSP remains unchanged and is retained: `style-src 'self'`, no `unsafe-inline`. The remaining startup CSP producer has been isolated by evidence on Windows and **resolved as a known, non-fatal dependency CSP incompatibility** (`@xterm/xterm` v6 terminal renderer). See the CSP closure (evidence finding) section in `docs/REBUILD_REMOTE_COMPLETION_AUDIT_2026-08-14.md`.

## Validation evidence

The exact-head isolated Windows repository validation on `f1f2893247cbe0a0ab031487fdc2c7f5b1bec32d` passed the full `npm run check`, including governance, 25-module registry status, Managed Chrome smoke, browser-session authority, browser relay, governed terminal, integration smoke, rebuild diagnostic contract, runtime truth/observability and adaptive continuation. That validation predates the reset-dropdown UI change.

Remote source inspection after the reset-dropdown mutation confirms `electron/rebuild-reset-actions.js` contains only the action-to-owner mapping and `target.click()` delegation; it contains no `runtimeStop`, `browserStop`, `browserRelayStop`, or `savePreferences` implementation path. The entrypoint loads the new reset dispatcher and the shell regression has been updated accordingly. This is source evidence only, not executed validation.

Required closure evidence is another isolated Windows `npm run check`, followed by the real `start:trace` Browser Loop acceptance proving: exact Chat URL + one Start requires no other runtime/browser/profile/target click; reset actions preserve unrelated settings; the agent enters waiting-for-browser; Stop returns to stopped; provider stays silent while idle; and remaining CSP warnings are attributed to their exact producer rather than solved by relaxing CSP. The CSP attribution requirement is now **satisfied by evidence**: the remaining producer is `@xterm/xterm` v6 terminal renderer, classified and closed as a known non-fatal dependency CSP incompatibility (strict CSP retained, no `unsafe-inline`).
