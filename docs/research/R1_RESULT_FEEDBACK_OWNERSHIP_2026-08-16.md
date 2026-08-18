# R1 — Result Feedback Ownership

**Branch:** `refactor/browser-conversation-turn-transport-20260816`  
**Source head analyzed:** `46cef45b19921b692724e8f6b733248e27b7447b`  
**Initial base-relay implementation head:** `7afd6ccf6ec44ee9679bcc01793505c5a661d375`  
**Active observable-runtime repair head:** `a3d60f624ea3132e0cee0c024d08d0ae5e2427a8`  
**Automated live-acceptance head:** `7002f8aa86e17f758e5bc34db0f9c92e4cb6a2f1`  
**Source classification before repair:** `DISPROVEN`  
**Repository-level implementation status:** `PROVEN`  
**Live end-to-end R1 status:** `PROVEN`

## Question

After Access posts a local-agent result into the selected ChatGPT conversation, what mechanical identity prevents the assistant response caused by that submission from becoming an unintended new Access task?

The pre-fix source provided no such causal ownership link.

## Proven pre-fix flow

```text
assistant turn A
  -> relay executes A
  -> local result R
  -> R is journaled against A
  -> ProviderChannel.send(R)
  -> R is submitted to the exact ChatGPT composer
  -> submission is confirmed
  -> ChatGPT generates assistant turn B
  -> snapshot(B) exposes a new assistant message identity
  -> B receives a new transportKey
  -> no journal ownership record exists for B
  -> B is eligible for normal local execution
```

This was not a duplicate-suppression defect. A genuinely new provider assistant response correctly receives a new message identity. The missing runtime contract was mechanical **causal turn ownership**.

## Required ownership contract

```text
independent user/browser-side turn
  -> assistant response
  -> eligible assistant_turn

Access-owned result submission
  -> rendered user-side result R
  -> durable deliveryResponse.state = pending
  -> first direct completed assistant response B
  -> delivery_response
  -> consume mechanically
  -> do not re-delegate automatically
```

Transport must not infer ownership from response wording, keywords, or text equality.

## Important implementation correction discovered during live acceptance

The first R1 correction was implemented and regression-tested in the base `BrowserInstructionRelay`, but the active rebuild runtime replaces that class with `ObservableBrowserInstructionRelay`, whose `_deliverPending()` override owned the real delivery path.

That override initially bypassed the new delivery-response ownership transition. It also attempted to verify the outbound Access result against the latest assistant-authored message even though Access submits the result through the ChatGPT composer as a user-side conversation turn.

This meant the original base-class regression was insufficient to prove the active runtime.

The active observable-runtime repair therefore changed the live path to:

```text
Access result R submitted through exact composer
  -> verify R in bounded exact-chat conversation history as role:user
  -> mark source turn delivered
  -> persist deliveryResponse.state = pending
  -> observe first new assistant B
  -> consume B as delivery_response
  -> zero local re-execution
  -> stable waiting
```

If submission is accepted but rendered delivery cannot be proven, the observable relay now fails closed rather than continuing inbound polling across an ambiguous side-effect boundary.

## Acceptance-journal isolation

The first automated UI acceptance attempt was blocked by an older production journal entry left in durable state `executing` for `turn-a51547a0194bf764`.

That was correctly classified as recovery/configuration contamination rather than an R1 product failure. The relay refused automatic replay with `INSTRUCTION_RECOVERY_REQUIRED`.

For bounded acceptance, the test process now uses an explicit temporary transport-journal override while retaining the real `access-agent` userData and authenticated Managed Chrome profile. This isolates test transport history without deleting or rewriting the production recovery evidence.

## Repository validation

On exact clean detached head `a3d60f624ea3132e0cee0c024d08d0ae5e2427a8`:

- `node --check src/browser/observable-browser-runtime.js` — PASS;
- `node --check test/rebuild-agent-truth-observability-smoke.js` — PASS;
- `node test/rebuild-agent-truth-observability-smoke.js` — PASS;
- full `npm run check` — PASS;
- change governance — PASS (17 records, active none);
- module registry — OK (25 modules);
- workspace clone sync — PASS;
- workspace contract, agent-led, browser/provider, runtime, integration, and rebuild checks all passed;
- general browser evals remained 6/6.

Therefore the R1 correction is **PROVEN at repository level at the actual active runtime owner**, not merely at the base relay abstraction.

## Live bounded acceptance

Automated live acceptance ran on exact head:

`7002f8aa86e17f758e5bc34db0f9c92e4cb6a2f1`

Target conversation:

`https://chatgpt.com/c/6a7dd21e-47dc-83ed-a7a5-51e66d7bfed9`

Observed result:

```text
R1 LIVE FEEDBACK ACCEPTANCE: PASS
localSubmissionCount = 1
resultSentCount = 1
deliveryResponseConsumedCount = 1
relay.lifecycle = waiting_for_instruction
relay.pendingResult = false
delivery.state = rendered_verified
delivery.evidenceLevel = RENDERED_DELIVERY_VERIFIED
```

The live run therefore proved:

```text
one controlled browser-side user probe
  -> assistant A
  -> exactly one local submission
  -> exactly one Access result R
  -> R rendered in the same exact ChatGPT conversation
  -> assistant B generated by R
  -> B consumed as delivery_response
  -> zero second local submission
  -> relay returns to stable waiting_for_instruction
```

The live acceptance used a nonce-tagged no-side-effect probe and a unique temporary transport journal. Pass/fail was determined by diagnostic identities/counts and durable lifecycle state, not by semantic interpretation of assistant wording.

## Final R1 classification

**PROVEN — live end-to-end.**

R1 result-feedback ownership is closed for this milestone.

The proof covers the exact causal boundary:

```text
assistant A -> local execution once -> result R -> rendered same-chat delivery -> assistant B -> mechanical delivery_response consumption -> no re-execution -> stable waiting
```

Do not reopen R1 unless new evidence falsifies one of those invariants.

## Separate deferred findings

- Restart/recovery reconciliation for genuinely ambiguous historical `executing` or unresolved delivery-response state belongs to the restart/recovery lane, not R1.
- Production currently passes `pinnedSkills: []`, causing all available skill bodies to be loaded into every task. Selective skill routing is separate from R1 and must remain separately scoped.
