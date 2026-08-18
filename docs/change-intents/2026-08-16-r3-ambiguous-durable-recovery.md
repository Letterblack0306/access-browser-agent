# Change Intent

## Change ID

2026-08-16-r3-ambiguous-durable-recovery

## Status

completed

## Requested outcome

Allow an operator to inspect and explicitly reconcile an ambiguous durable Browser Loop record without deleting original journal evidence, guessing completion, or causing local re-execution or duplicate delivery.

## Target files

- docs/CHANGE_INDEX.md
- docs/change-intents/2026-08-16-r3-ambiguous-durable-recovery.md
- docs/research/R3_AMBIGUOUS_DURABLE_RECOVERY_AUTHORITY_2026-08-16.md
- src/system/browser-transport-journal.js
- src/agent/executive/BrowserInstructionRelay.js
- electron/browser-session-authority.js
- electron/main.js
- electron/preload.js
- electron/rebuild-runtime-state.js
- electron/rebuild-renderer.js
- electron/index.html
- test/browser-recovery-reconciliation-smoke.js
- test/browser-instruction-relay-smoke.js
- test/browser-session-authority-smoke.js
- test/rebuild-runtime-state-smoke.js
- test/rebuild-shell-smoke.js
- scripts/r3-live-recovery-acceptance.js
- package.json

## Intent

Extend the active journal, relay, BrowserSessionAuthority, IPC, preload, runtime projection, and rendered Problems surface with one evidence-backed reconciliation path. Preserve agent reasoning while keeping retry, replay prevention, workspace identity, and side-effect ambiguity deterministic.

## Planned changes

Add append-only instruction reconciliation receipts linked to one exact journal key.

Derive reconciliation state without deleting or rewriting the original instruction events.

Expose the exact ambiguous record, workspace, conversation, state, timestamps, hashes, available evidence, and missing evidence.

Support explicit abandoned, quarantined, and proven_complete dispositions backed by structured artifact identity and SHA-256.

Reject proven_complete when correlated evidence references are absent.

Reject wrong-workspace, wrong-conversation, wrong-key, repeated conflicting, or unsupported reconciliation.

Keep automatic execution and delivery blocked until the journal projection proves a permitted disposition.

Add BrowserSessionAuthority and IPC/preload methods for read and reconcile actions.

Project blocked recovery into Problems instead of opening an empty Problems surface.

Render exact evidence and operator actions without inferring semantic completion from text.

Add focused source, state, IPC, restart, wrong-target, and no-replay regressions.

Add an isolated acceptance harness using ACCESS_AGENT_TRANSPORT_JOURNAL_FILE before any production-journal action.

## Why

Production evidence contains turn-a51547a0194bf764 with only observed to executing. The record was written for workspace G:\Developments\46_Accecc_Browser_Agent\Browser Agent and has no durable result or delivery evidence. Current source correctly fails closed, but recovery events use blocked status, the runtime projection does not create a Problems entry for that event, and no reconciliation read or action API exists.

The original evidence must remain intact. Manual JSONL deletion would erase the exact ambiguity R3 must handle and would not create an auditable recovery decision.

## Post-change update

Implemented append-only recovery receipts, fail-closed relay continuation, scope-bound authority APIs, IPC/preload, rendered Problems evidence/actions, focused regressions, and an isolated copied-production-journal acceptance harness. The bounded R3 change is runtime-proven against the isolated rendered fixture; live ChatGPT content behavior is outside this acceptance.

## Validation evidence

Focused recovery, relay, authority, runtime-state, and shell regressions pass. Full npm run check passes. Isolated acceptance against a production-journal copy appended one quarantined receipt, preserved the source journal byte-for-byte, and reconstructed the receipt after restart. Isolated rendered fixture acceptance is runtime-proven; live ChatGPT content behavior remains a separate unproven lane.

Focused proof status:

- PASS: unresolved executing remains blocked;

- PASS: original production journal remains byte-for-byte unchanged;

- PASS: one accepted action appends one correlated reconciliation receipt;

- PASS: proven_complete without structured artifact identity and SHA-256 is rejected;

- PASS: conflicting second dispositions are rejected;

- PASS: repeated identical requests are deterministic;

- PASS: wrong workspace, conversation, or key is rejected;

- PASS: restart reconstructs the same reconciliation projection;

- PASS: focused relay case invokes zero historical submissions after reconciliation;

- PASS: Problems projection retains backend recovery evidence;

- PASS: BrowserInstructionRelay and BrowserSessionAuthority regressions;

- PASS: rebuild runtime-state and shell/UI regressions;

- PASS: full npm run check;

- PASS: isolated restart acceptance against a copied journal;

- PASS: isolated rendered Problems action through IPC and authority;

- UNCHANGED SAFETY BOUNDARY: production-journal reconciliation was not attempted and remains unauthorized.
## Rendered acceptance investigation update - 2026-08-16

### Evidence boundary

- PROVEN: the committed R3 backend, journal, relay, authority, IPC/preload, Problems projection, focused regressions, full repository check, and copied-production-journal acceptance at commit 78d749fefe9f64810bdb207ea1020530bd3bc9a6;

- PROVEN: the production journal remained unchanged; production reconciliation was not attempted;

- PROVEN DURING THE RENDERED INVESTIGATION: a real Electron renderer and real preload/IPC/authority/journal path detected an isolated synthetic durable executing record and produced the expected recovery-required failure before execution;

- TEST_HARNESS_FAILURE: early rendered runs failed because the harness attempted to recreate a production assistant turn whose durable record contains only rawSha256, not recoverable raw text; later fixture and command-transport errors were harness defects, not product failures;

- BLOCKED_CONFIGURATION: the configured Nvidia provider returned ResourceExhausted: Worker local total request limit reached (16/16), preventing the final post-reconciliation waiting_for_instruction observation;

- DISCOVERED PRODUCT ORDERING ISSUE: provider capability readiness was evaluated before local durable recovery visibility. A local uncommitted candidate now performs a read-only recovery preflight so an unresolved local side-effect boundary can be shown even when the provider is unavailable;

- REGRESSION_PASSED FOR THE CANDIDATE ORDERING FIX: BrowserSessionAuthority and BrowserInstructionRelay focused smoke tests pass;

- NOT YET PROVEN: one rendered Quarantine action completing through UI -> preload -> IPC -> authority -> append-only receipt, followed by restart -> waiting_for_instruction and zero historical submission.

### Do not repeat

- do not attempt to reconstruct the preserved production turn from rawSha256;

- do not mutate or reconcile the production journal;

- do not classify provider-capacity failure as an R3 journal/receipt failure;

- do not bypass provider readiness merely to force a green result;

- do not rerun already-passed backend, copied-journal, or startup investigations unless relevant source changes.

### Completed bounded proof

The isolated rendered fixture exercised the real Quarantine action, durable receipt, restart projection, zero historical replay, and waiting_for_instruction. Live ChatGPT content behavior remains outside this proof.

## Final bounded R3 acceptance - 2026-08-16

### Classification

`RUNTIME_PROVEN_ISOLATED_FIXTURE`

- Real Access Electron renderer: PROVEN.
- Rendered Problems evidence and Quarantine action: PROVEN.
- Preload -> IPC -> BrowserSessionAuthority -> append-only receipt: PROVEN.
- Restart reconciliation projection: PROVEN.
- Post-restart waiting_for_instruction: PROVEN.
- Historical instruction rows added: zero.
- Relay execution invoked for the reconciled historical record: false.
- Production journal unchanged: PROVEN.
- Full npm run check after the recovery-readiness ordering fix: PASS.
- Copied-production-journal acceptance rerun: PASS.

### Important boundary

The selected target used the preserved conversation URL for exact scope identity, but CDP Fetch interception served a synthetic local ChatGPT-shaped page with known assistant text. The live ChatGPT conversation was not read, submitted to, or mutated. Therefore this proves the bounded R3 operator recovery path in the real Access application against an isolated fixture; it does not prove live ChatGPT content behavior.

### Closure

The bounded R3 ambiguous durable recovery authority contract is complete at RUNTIME_PROVEN_ISOLATED_FIXTURE. Live-provider content acceptance is a separate lane and must not be inferred from this result. Production-journal reconciliation remains unattempted and unauthorized.
