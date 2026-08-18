# Change Intent

## Change ID

`2026-08-16-recovery-renderer-input`

## Status

`completed`

## Requested outcome

Replace the unsupported renderer `window.prompt()` recovery input path with a controlled in-renderer input surface so operator reconciliation can reach the existing BrowserSessionAuthority and append-only journal contract without changing recovery semantics.

## Target files

- `electron/rebuild-renderer.js`
- `test/recovery-renderer-input-smoke.js`

## Intent

Repair only the renderer-side collection of reconciliation reason/evidence. Preserve the existing preload API, IPC channel, BrowserSessionAuthority reconciliation method, journal append-only semantics, recovery dispositions, and exact target/workspace scoping.

## Planned changes

- Remove renderer use of `window.prompt()` from `reconcileRecoveryAction()`.
- Add a controlled DOM-based `requestRecoveryInput(...)` helper owned by the renderer.
- Require a non-empty reconciliation reason before IPC.
- Preserve the `proven_complete` evidence JSON path and reject malformed JSON before IPC.
- Preserve the existing `api.browserRecoveryReconcile({key,disposition,reason,operator:'local-operator',evidenceRefs})` payload unchanged.
- Add focused regression coverage for Abandon success, blank/cancel no-op behavior, malformed proven-complete evidence rejection, and absence of `window.prompt()`.

## Why

Live runtime diagnostics proved that a recovery action click reached the renderer but failed before IPC with `Error: prompt() is not supported.`. Preload exposure, the matching `ide:browser-recovery-reconcile` main-process handler, BrowserSessionAuthority reconciliation, and journal append semantics were independently proven present. The defect therefore belonged to renderer input collection.

## Post-change update

Completed. The renderer no longer uses unsupported prompt APIs. Recovery reason/evidence collection is owned by a controlled DOM overlay. Focused regression proves blank/cancel behavior and malformed completion evidence fail safely before IPC. Automated live acceptance then exercised the real renderer Quarantine button, controlled input overlay, Continue control, existing preload/IPC/BrowserSessionAuthority reconciliation path, and production append-only journal receipt without manual UI interaction.

Governance-order deviation: the renderer repair and initial focused regression commits were authored after direct runtime proof but before this dedicated change intent was registered. This document records that deviation explicitly rather than retroactively claiming the pre-change registration order was followed.

## Validation evidence

Focused validation passed on exact head `1761eb1b53885be54b10e3e6261aa6babcc2372d`:

- `node --check electron/rebuild-renderer.js` — PASS;
- `node test/recovery-renderer-input-smoke.js` — PASS;
- `node test/browser-recovery-reconciliation-smoke.js` — PASS.

The focused regression proves:

- renderer source does not use unsupported `window.prompt()`;
- Abandon with a reason invokes reconciliation once with `disposition = abandoned` and empty `evidenceRefs`;
- blank reason and cancel invoke zero reconciliation calls;
- malformed `proven_complete` evidence JSON is rejected before IPC.

Canonical repository validation later passed on exact head `174f79f2b94eabb50c3a5982ec4aea5317ac6947`.

Automated live reconciliation acceptance passed on exact head `bfb1103dfce46862c87f4a6b70f6e94e3bb953d9` using the real Access Agent renderer over CDP:

- recovery card found for key `8fc520a791a265c159c61164866b42d963d7665d749230467e0070316e33bbfd`;
- real Quarantine button exercised;
- controlled `Reconcile durable recovery` overlay exercised;
- real Continue control exercised;
- append-only reconciliation receipt written with `priorState = delivery_unverified` and `disposition = quarantined`;
- receipt ID `07a8664172e23ae34cfbd46e13caa75ccf36cb093f157b3fff64db3334f6dd92`;
- zero Browser Loop instruction execution before or after reconciliation;
- `AUTOMATED_LIVE_RECOVERY_RECONCILIATION_PASS`.
