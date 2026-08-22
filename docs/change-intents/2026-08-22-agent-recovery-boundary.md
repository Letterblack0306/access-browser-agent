# Agent recovery boundary

## Change ID

`2026-08-22-agent-recovery-boundary`

## Status

completed

## Requested outcome

Prevent silent replay of agent work after a process restart leaves a side-effecting execution step without a durable terminal result.

## Intent

Make interrupted agent execution visible and fail closed at the durable session boundary without pretending arbitrary external side effects are exactly-once.

## Planned changes

- Project an explicit recovery-required state for unmatched execution starts.
- Reject new instructions and resume until an operator records a reconciliation disposition.
- Add a regression proving reconstruction, blocking, reconciliation, and subsequent execution.

## Why

Existing reconstruction preserved durable context but did not distinguish a clean waiting state from a process death between tool execution and its terminal event. That ambiguity could permit silent replay.

## Target files

- `src/agent/executive/AgentSessionState.js`
- `src/agent/executive/AgentExecutive.js`
- `src/agent/executive/AgentSessionRuntime.js`
- `test/agent-recovery-boundary-smoke.js`
- `package.json`
- `docs/CURRENT_STATUS.md`
- `docs/CHANGE_INDEX.md`

## Post-change update

On reconstruction, an unmatched `step.started` event creates an explicit `recovery_required` state. New instructions and resume are rejected with `AGENT_RECOVERY_REQUIRED` until an operator records a reconciliation disposition. This prevents automatic replay. It does not claim exactly-once behavior for arbitrary external side effects whose transaction/idempotency semantics are outside this runtime.

## Validation evidence

- `node test/agent-recovery-boundary-smoke.js` — PASS
- `node test/agent-runtime-resilience-smoke.js` — PASS
- `npm run check` — PASS
- `git diff --check` — PASS
