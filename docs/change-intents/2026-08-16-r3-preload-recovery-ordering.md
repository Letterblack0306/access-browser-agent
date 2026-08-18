# Change Intent

## Change ID

`2026-08-16-r3-preload-recovery-ordering`

## Status

`completed`

## Requested outcome

Allow the real renderer/preload path to surface unresolved durable recovery before provider-readiness failure, while preserving the authority-owned requirement that the relay cannot enter WAITING unless the provider/model is agent-ready.

## Target files

- `electron/preload.js`
- `test/rebuild-shell-smoke.js`
- `docs/CURRENT_POSITION_AND_RESEARCH_GATE_2026-08-16.md`
- `docs/research/R3_AMBIGUOUS_DURABLE_RECOVERY_AUTHORITY_2026-08-16.md`

## Intent

Remove the duplicate provider-readiness decision from preload. Preload transports `ide:browser-relay-start`; BrowserSessionAuthority remains the single owner that evaluates readiness, performs read-only durable recovery preflight when readiness is unavailable, blocks unresolved recovery first, and otherwise rethrows provider readiness without starting the relay.

## Planned changes

- Replace the preload readiness wrapper with direct IPC transport.
- Update the shell contract test to prohibit a preload-owned readiness gate.
- Retain BrowserSessionAuthority focused coverage for provider-blocked recovery preflight.
- Rerun the rendered isolated fixture under the currently exhausted provider configuration.
- Record the exact classification and close this intent only after full validation.

## Why

The clean-branch rendered acceptance proved preload calls `ide:provider-readiness` and throws before invoking `ide:browser-relay-start`. This makes local durable recovery invisible whenever provider capacity is unavailable, bypassing the recovery-first ordering already implemented in BrowserSessionAuthority.

## Post-change update

Preload now transports `ide:browser-relay-start` directly. `BrowserSessionAuthority` remains the sole owner of recovery-first/provider-readiness ordering. The shell contract verifies the production owner in `electron/main.js`; the initial assertion against the rebuild wrapper was classified as a stale test target and corrected without changing runtime behavior.

## Validation evidence

- Governance: PASS (20 records; none active).
- `rebuild-shell-smoke`: PASS.
- `browser-session-authority-smoke`: PASS.
- Rendered isolated-fixture acceptance: `CORE_RENDERED_PASSED_WAITING_BLOCKED_CONFIGURATION`.
- Rendered evidence, Quarantine action, IPC receipt, restart projection, zero historical replay, and unchanged production journal: PROVEN.
- Final `waiting_for_instruction`: `BLOCKED_CONFIGURATION`, because the configured provider/model did not pass capability readiness.
- Relay execution invoked for the reconciled historical record: false.
- Live ChatGPT content: not exercised or claimed.

## Safety boundary

This change must not bypass provider readiness or allow WAITING/execution when provider capability is unavailable. It changes only which owner evaluates readiness and ensures local recovery evidence is considered first.
