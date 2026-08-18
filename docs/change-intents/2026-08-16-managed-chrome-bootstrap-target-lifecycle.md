# Change Intent

## Change ID

`2026-08-16-managed-chrome-bootstrap-target-lifecycle`

## Status

`completed`

## Requested outcome

Remove the Access-owned startup page after an exact supported provider target is verified, without closing user-created blank pages or inferring ownership from URL, title, or ordering alone.

## Target files

- `src/system/managed-chrome.js`
- `src/browser/provider-channel.js`
- `electron/browser-session-authority.js`
- `electron/main.js`
- `electron/rebuild-main.js`
- `test/managed-chrome-smoke.js`
- `test/provider-channel-smoke.js`
- `test/browser-session-authority-smoke.js`
- `scripts/managed-chrome-bootstrap-acceptance.js`
- `package.json`
- `docs/CURRENT_POSITION_AND_RESEARCH_GATE_2026-08-16.md`
- `docs/research/PR20_SCOPE_AND_STACK_INTEGRATION_AUDIT_2026-08-16.md`

## Intent

Make the launcher-created bootstrap page explicit lifecycle state owned by exact CDP target identity and managed-browser generation.

## Planned changes

- Generate a current-generation bootstrap marker.
- Claim exactly one matching page as the owned bootstrap `targetId`.
- Retire only that claimed target after a different supported provider target is verified.
- Clear ownership after retirement or managed-browser stop.
- Preserve unrelated user-created `about:blank` pages.
- Apply the same authority to exact-chat creation and existing-target selection.
- Add focused and visible acceptance coverage.

## Why

Managed Chrome launched every generation with a bootstrap page, while the runtime did not retain or retire that page's exact CDP target identity. Provider creation and existing-target selection therefore left the bootstrap page visible. URL-only cleanup would risk deleting a user-owned blank page.

## Post-change update

Implemented exact current-generation bootstrap ownership, exact-target retirement after provider verification, ownership clearing, user-blank preservation, active rebuild integration, focused tests, and a non-submitting visible acceptance.

## Validation evidence

At historical implementation head `80cc5735f074fdff54ccec230539851d0e09cdd5`:

- focused ManagedChrome, ProviderChannel, and BrowserSessionAuthority tests passed;
- full `npm run check` passed;
- visible managed Chrome acceptance retained one exact provider page and zero owned bootstrap pages;
- relay start count was zero;
- submission attempt count was zero;
- issue #21 was closed as completed.

The clean PR #18-based integration branch must rerun the same proof before merge readiness is claimed.

## Safety boundary

Never close a tab merely because its URL is `about:blank`. The only removable bootstrap page is the exact target claimed for the current managed-browser generation.
