# Change Intent

## Change ID

`2026-08-16-provider-tool-schema-array-items`

## Status

`in_progress`

## Requested outcome

Make the declared `applyPatch` function schema acceptable to strict provider tool-schema validators by defining the item schema for its `edits` array.

## Target files

- `src/agent/executive/LiveToolContext.js`
- `test/live-tool-context-patch-smoke.js`
- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-16-provider-tool-schema-array-items.md`

## Intent

Correct the proven schema incompatibility without changing tool authority, mutation governance, patch execution semantics, or Browser Loop transport ownership.

## Planned changes

- Declare `edits.items` as an object containing positive integer `startLine` and `endLine` fields plus string `text`.
- Require the three public edit fields and reject undeclared edit properties at the provider schema boundary.
- Require at least one edit, matching the existing executor's `PATCH_EMPTY` contract.
- Add focused regression coverage for the provider-facing OpenAI tool declaration.
- Run focused validation, the repository check suite, and the isolated-journal live-provider acceptance.

## Why

Runtime diagnostics repeatedly show Google AI Studio rejecting `function_declarations[3]` with `parameters.properties[edits].items: missing field`. The fourth registered function is `applyPatch`, and its current `edits` schema is only `{ type: 'array' }`. The selected provider therefore rejects the tool set before generation begins.

## Constraints

- Do not bypass or weaken provider-readiness checks.
- Do not change patch execution authority or governance.
- Do not change protected ChatGPT transport ownership.
- Do not interpret secondary provider rate-limit evidence as proof that the schema is valid.
- Do not claim live-provider compatibility until runtime acceptance passes.

## Post-change update

Pending implementation.

## Validation evidence

Pending implementation.
