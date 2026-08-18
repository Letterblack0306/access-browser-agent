# Change Intent

## Change ID

`2026-08-15-execution-status-domain-boundary`

## Status

`in_progress`

## Requested outcome

Repair the browser-owned task startup failure caused by a cross-domain `observed` state being supplied as an `ExecutionEventSchema` execution status, without expanding the execution-status vocabulary.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-execution-status-domain-boundary.md`
- `src/agent/executive/LiveAgentCore.js`
- `test/agent-led-smoke.js`
- `test/execution-event-schema-smoke.js`

## Intent

Keep execution lifecycle status, tool-result observation state, browser transport/recovery state, and diagnostics as separate domains. A tool call that returns a non-success observation may remain useful evidence for the reasoning loop, but that observation label must not be copied into `ExecutionEventSchema.status`.

## Planned changes

1. Trace every active call site from browser-owned instruction execution through `LiveAgentCore.step()` -> `emitExecutionEvent()` -> `AgentExecutive._appendExecutionEvent()` -> `AgentEventStore.appendExecution()` -> `createExecutionEvent()` -> `validateExecutionEvent()`.
2. Correct the `execution.tool.completed` producer so its execution status remains in the execution lifecycle domain while the tool outcome remains in `outputSummary.observation`/error evidence.
3. Preserve `ExecutionEventSchema` rejection of `observed`, browser journal states such as `executing`/`result_queued`/`delivering`, and unrelated diagnostic states.
4. Add regression coverage that executes the adaptive failed-tool observation path and proves no cross-domain state reaches execution-event status.
5. Run targeted agent/execution schema tests and full repository validation before any live browser retest.

## Why

Two independent live browser-owned instructions failed immediately with `Unsupported execution event status: observed`. Current source shows `LiveAgentCore.step()` emits `execution.tool.completed` with `status: result?.ok === true ? 'completed' : 'observed'`. `observed` is not an execution lifecycle status and is correctly rejected by `ExecutionEventSchema`. The non-success tool outcome is already represented separately in tool output (`observation`, error, code) and remains available to the reasoning model, so the execution event must describe lifecycle completion rather than copy the observation-domain label.

## Post-change update

Pending implementation.

## Validation evidence

Pending targeted tests, full repository validation, and one real browser-owned instruction on the exact validated revision.
