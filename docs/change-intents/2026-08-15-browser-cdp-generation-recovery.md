# Change Intent

## Change ID

`2026-08-15-browser-cdp-generation-recovery`

## Status

`in_progress`

## Requested outcome

Recover current-generation Managed Chrome CDP deterministically, make verified backend readiness authoritative over the initial launcher handle, and preserve exact supported-chat adapter identity through relay attachment.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-browser-cdp-generation-recovery.md`
- `src/system/managed-chrome.js`
- `src/browser/provider-channel.js`
- `electron/browser-session-authority.js`
- `test/managed-chrome-smoke.js`
- `test/provider-channel-smoke.js`
- `test/browser-session-authority-smoke.js`

## Intent

Keep one-click browser ownership fail-closed without confusing launcher-process lifetime with browser-backend health. Managed Chrome must distinguish stale pre-launch `DevToolsActivePort` state from the current Access-owned generation, verify `/json/version`, and use the verified endpoint as the browser-ready predicate. Exact-chat verification and relay snapshotting must evaluate the same target/provider identity correctly; a malformed snapshot probe must never manufacture a provider mismatch after the same target has just passed exact-chat inspection.

## Why

The live Browser Loop first reached a visible Chrome window but failed with `CHROME_EXITED_BEFORE_CDP`; later corrections proved a live current-generation CDP endpoint and exact ChatGPT conversation, but relay start still failed with `TARGET_PROVIDER_MISMATCH`. Source inspection now shows the concrete cause of the relay failure: `ProviderChannel.snapshot()` builds a malformed Runtime.evaluate expression in which the `visible` arrow function is not closed before the snapshot body. The outer IIFE therefore does not return the intended `{ text, url, ... }` snapshot object; `evaluateValue()` falls back to `{}`, so `snapshot.url` is empty and the subsequent provider check deterministically throws `TARGET_PROVIDER_MISMATCH`. This is distinct from browser startup and target selection and must be fixed at the provider-channel owner.

## Evidence before change

- Earlier live Windows trace on `1c5b4d233283e783cc81e0a6d6535a2f9d054373` showed stale `DevToolsActivePort` handling could yield `CDP_UNAVAILABLE`, followed by stale target/provider errors.
- The managed-browser lifecycle correction later produced a live CDP endpoint and exact ChatGPT target in the normal Browser Loop path.
- Live trace on 2026-08-15 showed `ensure_browser success`, `refresh_targets success`, then `browser_relay.failed: Selected target no longer matches the configured chat adapter.` for the exact ChatGPT conversation.
- `ProviderChannel.inspectTarget()` closes its `visible` helper before evaluating URL/provider identity and succeeds on that target.
- `ProviderChannel.snapshot()` currently emits `const visible=e=>{...` and then immediately declares `const stop=...` without closing `visible`; the intended snapshot object is returned from the helper rather than the outer IIFE.
- Existing `provider-channel-smoke.js` mocks `Runtime.evaluate()` by returning a canned value and therefore does not validate the generated expression shape; this allowed the malformed expression to escape source tests.
- Direct Chrome launch with the same executable/profile/dynamic-CDP arguments and later product runtime both proved the browser backend itself can be healthy.

## Planned changes

1. Preserve stale `DevToolsActivePort` cleanup before spawn and current-generation endpoint verification behavior already implemented.
2. Keep launcher exit metadata separate from backend endpoint state.
3. Keep browser-start failure invalidation of relay target continuity.
4. Correct `ProviderChannel.snapshot()` so the `visible` helper is closed before snapshot logic and the outer IIFE returns the intended snapshot object.
5. On adapter mismatch, attach bounded diagnostic details (`targetId`, expected provider, observed URL/provider) without capturing conversation content.
6. Strengthen provider-channel regression coverage so the generated snapshot expression is inspected for the helper boundary instead of accepting any canned `Runtime.evaluate()` response.
7. Preserve the browser-session authority regression that rebinds the freshly revalidated target before relay start.
8. Re-run the full isolated Windows repository check, then one real Browser Loop acceptance run.

## Non-goals

- Do not add another browser backend or silently fall back to another browser/profile.
- Do not hardcode a CDP port.
- Do not weaken exact conversation identity or adapter checks.
- Do not turn the terminal/loop into a debugging subsystem.
- Do not treat the separate renderer CSP warning as fixed by this provider-channel patch.

## Acceptance criteria

- Browser readiness remains based on a verified current-generation CDP endpoint.
- `snapshot()` returns the evaluated exact-chat URL/provider data instead of an empty fallback caused by malformed probe source.
- A correct ChatGPT target no longer produces `TARGET_PROVIDER_MISMATCH` solely because of the snapshot expression.
- A genuinely wrong provider URL still fails closed as `TARGET_PROVIDER_MISMATCH`.
- Regression coverage inspects the generated snapshot expression boundary and preserves real mismatch rejection.
- Full `npm run check` passes on the exact resulting head before another live Browser Loop run.
- Live Browser Loop reaches relay `WAITING` or yields a new, specifically evidenced failure after this correction.

## Post-change update

Implementation is in progress. Browser backend/current-target continuity corrections are already present; this update adds the newly proven provider snapshot-expression defect to the same browser recovery boundary.

## Validation evidence

Previous exact-head repository validation passed at `f1f2893247cbe0a0ab031487fdc2c7f5b1bec32d`. Later live Browser Loop evidence proved managed Chrome CDP and exact-chat opening but reproduced `TARGET_PROVIDER_MISMATCH` at relay start. The provider snapshot fix still requires exact-head source/test validation and a new live Browser Loop run. The CSP inline-style warning remains a separate unresolved observation.
