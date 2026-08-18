# Change Intent

## Change ID

`2026-08-15-diagnostic-noise-coalescing`

## Status

`in_progress`

## Requested outcome

Stop diagnostic/log flooding. High-frequency unchanged polling, terminal byte/resize IPC, diagnostic self-reads, and repeated identical pass/fail records must not append endlessly. Preserve failures, state transitions, correlation/evidence, and enough suppressed-count metadata to diagnose recurrence.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-diagnostic-noise-coalescing.md`
- `electron/preload.js`
- `electron/rebuild-main.js`
- `src/system/runtime-diagnostic-log.js`
- `src/system/runtime-diagnostic-bus.js`
- `test/runtime-diagnostic-log-smoke.js`
- `test/rebuild-agent-truth-observability-smoke.js`
- `package.json`

## Intent

Diagnostics are evidence, not a packet capture. Polling APIs may continue for UI freshness, but unchanged success traffic must not become log traffic. Repeated identical failures must be coalesced while preserving first occurrence, recurrence count and later state changes.

## Planned changes

1. Mark high-frequency observation IPC as quiet in preload: `ide:status`, diagnostic reads/session lookup, module-registry status, agent status/receipts/trace, workspace-sync status, terminal write/resize, and similar polling/byte transport. Quiet IPC emits nothing on success but still emits classified failures.
2. Keep user-triggered/mutating/browser/provider actions fully logged at start/success/failure.
3. Add bounded duplicate coalescing to `RuntimeDiagnosticLog`: identical records within a short window are suppressed; when the signature changes or the window elapses, emit a compact recurrence summary rather than every duplicate.
4. Return an explicit handled/suppressed marker from the sink and make the diagnostic bus avoid broadcasting that marker, so wrapper fallbacks do not re-write it and the UI does not receive a fake duplicate row.
5. Never coalesce fatal/error state transitions across different signatures/correlation identities.
6. Add regression coverage proving unchanged polling does not flood, repeated identical failures coalesce, and changed state/correlation still writes new evidence.

## Why

Live runs show Complete Log and trace flooding with repeated pass/fail and observation events even when nothing changes. `electron/preload.js` currently logs both `start` and `success` for every IPC invocation, including the 2.5-second `ide:status` poll and diagnostic log reads. `RuntimeDiagnosticLog` appends every producer record without duplicate suppression. The rebuild wrapper also previously treated an unhandled `null` emission as a failed sink and attempted a second direct write. This obscures meaningful browser/provider/agent evidence.

## Post-change update

Implementation in progress.

## Validation evidence

Required closure: isolated `npm run check` plus a traced idle window proving local UI polling still works while diagnostic sequence growth remains bounded and any real failure/state transition appears immediately.
