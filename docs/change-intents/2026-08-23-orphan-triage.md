# Orphan file triage — 2026-08-23

Source: `chain-break-audit.js` ownership audit run at HEAD `f4c6f85`.
Status of each file was `UNOWNED_STATIC` (no static, module-registry, dynamic, or `package.json` script reference).

This is a triage marker only. **No files were deleted or modified** by the triage action.
Each flagged file has had a `// CRITICAL_TRIAGE:` header comment added pointing back to this doc.

## Behavior verification scope (later)

Each file below must be exercised against the current runtime before any decision to keep, wire up, or delete.
The behavior check should determine whether the file still:

- imports the production modules it was originally written against;
- asserts behavior that is still part of the current contract;
- has a future owner in mind, or is dead code from a finished phase.

## Files

### Scripts (7)

- `scripts/r1-live-feedback-acceptance.js`
- `scripts/r2-live-restart-identity-acceptance.js`
- `scripts/r3-production-start-acceptance.js`
- `scripts/r4-live-conversation-context-isolated.js`
- `scripts/register-electron-audit-sync.cjs`
- `scripts/tmp-registry-audit.js`
- `scripts/ui-state-driven-acceptance-isolated.js`

### Tests (14)

- `test/action-feedback-smoke.js`
- `test/agent-runtime-no-progress-smoke.js`
- `test/agent-session-fresh-runtime-smoke.js`
- `test/agent-workflow-view-patch-smoke.js`
- `test/birdeye-request-client-smoke.js`
- `test/birdeye-status-state-smoke.js`
- `test/birdeye-ui-status-smoke.js`
- `test/live-agent-provider-context-compaction-smoke.js`
- `test/live-lean.js`
- `test/lm-studio-provider-hardening-smoke.js`
- `test/lm-studio-settings-smoke.js`
- `test/rendered-delivery-envelope-identity-smoke.js`
- `test/runtime-controls-ui-smoke.js`
- `test/trace-ui-smoke.js`

## Files audited as `UNOWNED_STATIC` but later confirmed owned (NOT marked)

The audit's "no static reference" check understates these because ownership comes from a dynamic
or non-`package.json` reference. They are NOT in the critical list above.

- `test/browser-authority-liveness-smoke.js` — dynamic reference from `electron/browser-session-authority.js`.
- `test/provider-candidate-readiness-authority-smoke.js` — static reference from `electron/rebuild-settings.js`.
- `test/runtime-view-state-smoke.js` — dynamic reference from `electron/runtime-view-state.js`.

## Resolved during this triage cycle

- `electron/modules/project-audit.js` was a 0-byte stub. Deleted. The audit at `docs/audits/UI_SYSTEM_AUDIT_2026-08-07.md:111-115` explicitly states the file "does not exist on this branch", and the 0-byte stub violated that contract. Now absent.
- `scripts/register-electron-audit-sync.cjs` was the only producer of a `project-audit` workbench module. Deleted. With the module's stub gone, the script has nothing to register.

Both deletions were executed as part of `docs/change-intents/2026-08-23-ide-rail-delegate-owner.md`. The workbench layout's `retained` allow-list at `test/electron-shell-smoke.js:38-39` excludes `project-audit` and the audit pipeline (`npm run check`) remains green.

## Workflow

When a behavior check is performed on a flagged file, update this doc with:

- date checked
- behavior observed (PASS / FAIL / DEAD-CODE)
- decision (KEEP + WIRE / KEEP AS-IS / DELETE)
- owner and target commit, if KEEP + WIRE

Do not delete or modify behavior of a flagged file without first recording the check result here.
