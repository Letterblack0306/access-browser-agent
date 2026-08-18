# Change Intent

## Change ID

`2026-08-15-diagnostic-correlation-merge-fix`

## Status

`completed`

## Requested outcome

Fix the second isolated Windows validation failure where an explicit `undefined` correlation field from a diagnostic producer erases the inherited AsyncLocal `operationId` before persistence.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-diagnostic-correlation-merge-fix.md`
- `src/system/runtime-diagnostic-bus.js`
- `test/rebuild-agent-truth-observability-smoke.js`

## Intent

Preserve inherited runtime correlation unless a producer supplies a concrete replacement value. Do not special-case ToolRegistry; fix the correlation merge at the shared diagnostic bus boundary.

## Planned changes

- Compact/filter explicit producer correlation before merging it over inherited AsyncLocal correlation.
- Preserve valid explicit correlation overrides while preventing `undefined`, `null`, or empty values from erasing inherited IDs.
- Extend the observability smoke contract to prove a tool diagnostic inherits the surrounding `operationId` while adding its own `toolCallId`.
- Re-run the full isolated Windows validation after pulling the corrected branch head.

## Why

The second real local `npm run check` passed governance, module ownership, workspace contracts, agent-led behavior, integration, and most rebuild validation, then failed because the persisted tool diagnostic lacked the surrounding operation ID. Source inspection shows `ToolRegistry` supplies `operationId: undefined`, and `emitDiagnostic` spread that over the inherited correlation before compaction. This is a shared observability defect because any producer with undefined correlation keys could erase inherited context.

## Post-change update

- Updated `runtime-diagnostic-bus.js` so inherited and explicit correlations are independently compacted before merge.
- Undefined, null, and empty explicit values therefore no longer erase inherited operation/session/instruction correlation.
- Concrete explicit correlation values still override inherited values normally.
- Added an explicit regression assertion proving `operationId: undefined` preserves the inherited operation ID while adding a tool-call ID.
- The existing ToolRegistry observability assertion remains in place and now exercises the corrected shared merge behavior.

## Validation evidence

- The isolated Windows validation at head `726de3d75db9884afce93797d64fd153f22460c3` passed governance, module status, workspace contracts, the full agent-led suite, integration smoke, and rebuild checks through `rebuild-diagnostic-contract-smoke` before failing specifically on missing ToolRegistry `operationId` correlation.
- Source inspection identified the merge defect in `emitDiagnostic`: producer correlation containing `operationId: undefined` overrode AsyncLocal inherited correlation before compaction.
- The source fix is intentionally at the shared diagnostic bus boundary rather than in ToolRegistry, so all diagnostic producers receive the same correlation-preservation semantics.
- Full `npm run check` after this fix remains pending the next isolated Windows fast-forward/validation run; this change does not claim that rerun has passed yet.
