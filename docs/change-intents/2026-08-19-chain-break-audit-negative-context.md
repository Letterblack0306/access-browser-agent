# Change Intent

## Change ID

`2026-08-19-chain-break-audit-negative-context`

## Status

`completed`

## Requested outcome

Restore the `chain-break-audit.js` scan-check for `TaskStateRouter`/`TaskStateController` unreachability so it distinguishes a `doesNotMatch(...)` absence-assertion (evidence FOR unreachability) from a real dependency reference, instead of blanket-allowlisting the negative-regression test file.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-19-chain-break-audit-negative-context.md`
- `chain-break-audit.js`

## Intent

The `checkTaskStateRouterUnreachable` check exists to prove that dead-file `TaskStateRouter`/`TaskStateController` definitions are not imported or string-referenced by any active source. A test that asserts the string is absent (via `doesNotMatch(...)`) is evidence for unreachability and must not count as a dependency hit. The committed version dropped that per-match negative-context discrimination and instead hardcoded `test/rebuild-agent-truth-observability-smoke.js` into the allowlist as a blanket workaround, which can silently mask a genuine new reference to the dead router. This change restores the structural, per-match context check.

## Evidence before change

- Committed `chain-break-audit.js` allowlists `'test/rebuild-agent-truth-observability-smoke.js'` inside `checkTaskStateRouterUnreachable` with no per-match `doesNotMatch(...)` window check.
- The allowlist contains a duplicated `'src/system/module-registry.js'` entry.
- The negative-coverage detail string reads `this guards failure path` instead of `the guard's failure path`.
- The reference `TaskStateRouter(?!Bridge)` scans for positive usage but cannot tell whether a matched occurrence sits inside an absence assertion without examining the preceding characters.

## Planned changes

1. Replace the `ALLOWLISTED_FILES` hardcode approach in `checkTaskStateRouterUnreachable` with the reduced allowlist (dead-file definitions + static registry declaration only, deduplicated).
2. Re-add the per-match `isInsideAbsenceAssertion` window check so a reference inside a `doesNotMatch(...)` assertion is not counted as a dependency hit, while reporting the exact `file:index` of any real hit.
3. Fix the negative-coverage detail text to `the guard's failure path`.

## Why

A verification step that cannot structurally fail (because a file is always allowlisted regardless of its content) silently stops verifying anything. Keeping detection in the check logic rather than baking a test filename into the allowlist preserves the audit's purpose: catching a real new dependency on the dead router while not false-flagging negative-regression assertions.

## Acceptance criteria

- `chain-break-audit.js` parses (`node --check`).
- `checkTaskStateRouterUnreachable` passes for a fixture whose only router mention is inside a `doesNotMatch(...)` assertion and reports `PASS`.
- `checkTaskStateRouterUnreachable` fails for a fixture with a real `require('../src/system/task-state/TaskStateRouter')` in `electron/main.js` and reports `FAIL`.
- `checkTaskStateRouterUnreachable` still passes when only `TaskStateRouterBridge` is referenced.
- `node scripts/change-governance-check.js` still passes.
- Live `node chain-break-audit.js .` reports 0 failures against the current repo head.

## Post-change update

Replaced the blanket test-file allowlist in `checkTaskStateRouterUnreachable` with a reduced allowlist (dead-file definitions + static registry declaration only) and restored the per-match `isInsideAbsenceAssertion` negative-context window check so a reference inside a `doesNotMatch(...)` assertion is recognized as evidence for unreachability rather than a dependency hit. Also fixed the negative-coverage detail text to `the guard's failure path`. The audit now loads cleanly with all six exports present.

## Validation evidence

- `node --check chain-break-audit.js` → passes.
- `node chain-break-audit.js .` → 4 checks, 0 failed (all PASS: provenance.verifiedAssistant-derived, provenance-guard-negative-coverage, no-inbound-OBJECTIVE-parsing, task-state-router-unreachable).
- `require('./chain-break-audit.js')` exports all six functions.
- `node scripts/change-governance-check.js` → PASS (26 change records).
- No other source/test phase applies; this change is isolated to `chain-break-audit.js` and the governance documents.