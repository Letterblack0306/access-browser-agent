# Change Intent

## Change ID

`2026-08-15-objective-budget-message-test-fix`

## Status

`completed`

## Requested outcome

Correct the first isolated Windows validation failure where `test/objective-classifier-smoke.js` rejects the runtime's correctly classified tool-budget blocker only because the assertion is case-sensitive.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-objective-budget-message-test-fix.md`
- `test/objective-classifier-smoke.js`

## Intent

Keep the runtime behavior unchanged and make the regression assertion verify the semantic blocker message without depending on capitalization.

## Planned changes

- Change the failing `/tool-call budget exhausted/u` assertion to a case-insensitive match.
- Do not alter `LiveAgentCore` or tool-budget semantics because the observed runtime result already reports `status=blocked` and `blocker=tool_budget` correctly.
- Re-run the full isolated Windows validation after pulling the new branch head.

## Why

The first real local `npm run check` reached `check:agent-led` and failed only because the actual reason begins with `Tool-call` while the regular expression expects lowercase `tool-call`. This is a validation-contract defect, not evidence of incorrect agent behavior.

## Post-change update

- Updated only `test/objective-classifier-smoke.js`.
- Changed the blocker reason assertion from `/tool-call budget exhausted/u` to `/tool-call budget exhausted/iu`.
- Left `LiveAgentCore`, tool-budget classification, blocker semantics, and runtime behavior unchanged.

## Validation evidence

- The isolated Windows run on head `f670fc0d78ea607d403091b216b6965c3a4ce668` reached `check:agent-led` and showed `status=blocked`, `blocker=tool_budget`, and actual reason `Tool-call budget exhausted (1) before the agent produced a supported final result.`
- Source review confirms the failing test differed from the runtime text only by capitalization.
- The patched assertion now checks the same semantic phrase case-insensitively.
- Full `npm run check` must be re-run on the updated branch head; this record does not claim that broader suite has passed yet.
