# Change Intent

## Change ID

`2026-08-16-scope-level-recovery-discovery`

## Status

`completed`

## Requested outcome

Fail closed before Browser Loop start when any unreconciled ambiguous durable instruction exists for the selected workspace + exact conversation, even when a newer assistant turn is currently visible.

## Target files

- `src/system/browser-transport-journal.js`
- `src/agent/executive/BrowserInstructionRelay.js`
- `test/browser-recovery-reconciliation-smoke.js`
- `test/browser-instruction-relay-smoke.js`
- `test/browser-scope-recovery-preflight-smoke.js`
- `scripts/live-recovery-reconciliation-acceptance.js`
- `package.json`
- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-16-scope-level-recovery-discovery.md`

## Intent

Preserve the append-only journal as recovery authority and extend recovery discovery from one currently visible assistant turn to the entire selected `{workspaceRoot, conversationId}` scope. Do not infer completion, replay historical work, rewrite instruction evidence, or change renderer/preload/main/BrowserSessionAuthority ownership.

## Planned changes

- Add a read-only journal query that returns unresolved ambiguous instruction recoveries for one workspace + conversation scope.
- Exclude records that already have an `instruction_reconciliation` receipt.
- Preserve all existing safe-baseline and delivery-response semantics; reconciled ambiguous records must not block.
- During Browser Loop start/recovery preflight, query scope-level unresolved recovery before allowing relay startup.
- Surface the same `INSTRUCTION_RECOVERY_REQUIRED` event/error shape for the discovered historical record so the existing recovery UI can reconcile it by key.
- Add focused regressions for: historical unresolved turn A + newer visible turn B; zero local submission while A is unresolved; successful start after A receives an explicit reconciliation receipt.
- Wire the new scope-recovery regression into the canonical `npm run check` path so future repository validation cannot pass without exercising this failure mode.
- Add a repository-owned CDP acceptance runner that performs the real Start -> recovery card -> disposition -> reason -> Continue flow and verifies the append-only reconciliation receipt plus zero newer instruction execution. Long acceptance logic must live in the repository rather than inline shell commands.

## Why

Fresh runtime evidence on 2026-08-16 proved that an unreconciled historical instruction remained durably ambiguous while Browser Loop Start could proceed because recovery preflight inspected only the currently visible assistant turn. The repaired design makes the durable journal the discovery authority for the selected workspace + exact conversation scope and fails closed before any newer turn can execute.

## Post-change update

Completed. The journal now discovers unresolved ambiguous recoveries across the selected workspace + conversation scope, and BrowserInstructionRelay checks that scope before current-turn processing. The repository regression is wired into `npm run check`. Fresh live runtime acceptance proved an older `delivery_unverified` record is surfaced before newer instruction execution. The repository-owned CDP acceptance runner then exercised the real renderer recovery card, Quarantine action, controlled input overlay, Continue action, reconciliation IPC/authority path, and append-only journal receipt with zero `browser_relay.instruction_received` events before or after reconciliation.

## Validation evidence

Focused validation passed on exact head `adeb5726e3a024f685153912c0f79d75c3f3239f`:

- `node --check src/system/browser-transport-journal.js` — PASS;
- `node --check src/agent/executive/BrowserInstructionRelay.js` — PASS;
- `node test/browser-scope-recovery-preflight-smoke.js` — PASS;
- `node test/browser-recovery-reconciliation-smoke.js` — PASS;
- `node test/browser-instruction-relay-smoke.js` — PASS.

Canonical `npm run check` passed on exact head `174f79f2b94eabb50c3a5982ec4aea5317ac6947`, including:

- `browser-recovery-reconciliation-smoke: PASS`;
- `browser-scope-recovery-preflight-smoke: PASS`.

Automated live reconciliation acceptance passed on exact head `bfb1103dfce46862c87f4a6b70f6e94e3bb953d9` for exact chat `https://chatgpt.com/c/6a7dd21e-47dc-83ed-a7a5-51e66d7bfed9` and historical journal key `8fc520a791a265c159c61164866b42d963d7665d749230467e0070316e33bbfd`:

- exact recovery card found with `state = delivery_unverified`;
- real `quarantined` renderer action selected through CDP;
- controlled recovery reason overlay completed through real Continue control;
- durable `instruction_reconciliation` receipt appended;
- `priorState = delivery_unverified`;
- `disposition = quarantined`;
- receipt ID `07a8664172e23ae34cfbd46e13caa75ccf36cb093f157b3fff64db3334f6dd92`;
- `INSTRUCTION_RECEIVED_BEFORE = 0`;
- `INSTRUCTION_RECEIVED_AFTER = 0`;
- `AUTOMATED_LIVE_RECOVERY_RECONCILIATION_PASS`.
