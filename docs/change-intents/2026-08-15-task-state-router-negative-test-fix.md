# Change Intent

## Change ID

`2026-08-15-task-state-router-negative-test-fix`

## Status

`completed`

## Requested outcome

Correct the third isolated Windows validation failure where `test/rebuild-agent-truth-observability-smoke.js` rejects the legitimate class name `TaskStateRouterBridge` while intending to forbid the removed semantic `TaskStateRouter` dependency and task-state classification behavior.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-task-state-router-negative-test-fix.md`
- `test/rebuild-agent-truth-observability-smoke.js`

## Intent

Keep the active browser instruction bridge unchanged. Narrow the negative source assertion so it forbids importing/instantiating the historical `TaskStateRouter` semantic controller and its task-state classifications, without rejecting the transport-only `TaskStateRouterBridge` class name.

## Planned changes

- Replace the broad `doesNotMatch(/TaskStateRouter/u)` assertion with precise negative checks for a `TaskStateRouter` import/require or `new TaskStateRouter(...)` construction.
- Preserve the existing negative checks for semantic task-state labels such as `task_complete`, `level_complete`, and `needs_decision`.
- Do not modify `electron/task-state-router-bridge.js` because the observed source already transports structured instructions directly to the reasoning runtime and contains no semantic router dependency.
- Re-run the full isolated Windows validation after pulling the corrected branch head.

## Why

The third local `npm run check` passed governance, module maintenance, workspace contracts, agent-led behavior, integration, diagnostics, and earlier rebuild tests, then failed because the regex `/TaskStateRouter/u` matched the valid identifier `TaskStateRouterBridge`. The source shown by the failure contains no import or construction of the historical semantic router. This is a test precision defect, not evidence that semantic routing was reintroduced.

## Post-change update

- Left `electron/task-state-router-bridge.js` unchanged.
- Replaced the broad substring ban on `TaskStateRouter` with precise negative checks for requiring/importing that historical semantic router and constructing it with `new TaskStateRouter(...)`.
- Preserved the existing negative assertion for semantic lifecycle labels `task_complete`, `level_complete`, and `needs_decision`.
- The valid transport class name `TaskStateRouterBridge` can now exist without causing a false test failure.

## Validation evidence

- The failing local validation output showed the asserted source in full. It contains the legitimate class `TaskStateRouterBridge`, forwards structured input directly to `runtime.run(input)`, and explicitly states it does not classify prose or infer task lifecycle.
- Source review found no `require(...)`/import of the historical `TaskStateRouter`, no `new TaskStateRouter(...)`, and no `task_complete`, `level_complete`, or `needs_decision` classifications in the bridge.
- The regression now tests those actual forbidden semantic-router patterns rather than an ambiguous substring.
- Full `npm run check` remains to be rerun on the isolated Windows checkout after fast-forwarding to the new remote head; this record does not claim that rerun has passed yet.
