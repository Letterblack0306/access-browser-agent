# Change Intent

## Change ID

`2026-08-23-stop-lifecycle-smoke-owner`

## Status

`completed` (owner declaration; behavior was already passing in `npm run check`)

## Purpose

Declare an authoritative owner for `test/agent-runtime-adapter-stop-lifecycle-smoke.js`, which the chain-break module audit flagged as `REFERENCED_NO_OWNER_PROVEN` (only mention was a passing reference in `docs/research/R2_SESSION_TURN_IDENTITY_ACROSS_RESTART_2026-08-16.md`).

## What the test does

A 29-line focused regression for `AgentRuntimeAdapter.stop()`. It proves:

- A `completed` durable session is preserved: `stop()` returns `{ok:true, skipped:true, status:'completed', sessionId}` and does NOT call the underlying service `stop()` (zero `service.stop` invocations).
- A `running` session still delegates exactly once: `stop('session-running')` calls `service.stop('session-running')` exactly one time and returns the authoritative `stopped` result.

This is the boundary contract between the local agent runtime's stop signal and the durable session model: completed sessions must not be re-terminalized; running sessions must use the authoritative stop path exactly once.

## Target files

- `electron/agent-runtime-adapter.js` (the module under test)
- `test/agent-runtime-adapter-stop-lifecycle-smoke.js` (the focused regression)

## Owner

`agent-runtime-adapter` runtime boundary owner (the test enforces the runtime's authoritative stop discipline).

## Validation evidence

- `node test/agent-runtime-adapter-stop-lifecycle-smoke.js` — PASS, observed in the full `npm run check` chain.
- This test is part of `npm run check:agent-led`.

## Why a smoke was needed

The original test surface for `AgentRuntimeAdapter.stop()` only covered the happy path (running session → stop called). The boundary case (what happens to a session that already reached a terminal state?) was unproven until this focused regression landed. Without it, a future change that calls `service.stop()` on a completed session would silently corrupt the durable session state. The smoke makes the boundary explicit and pinned.

## Reference history

- The test was first observed in the chain-break audit at head `f4c6f85` with the entry `agent-runtime-adapter-stop-lifecycle-smoke: PASS` recorded in the R2 session-turn-identity research log.
- This owner doc registers the test as a pinned regression so its removal or rename would fail the governance validator.
