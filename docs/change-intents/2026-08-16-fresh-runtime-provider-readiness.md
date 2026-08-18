# Change Intent

## Change ID

`2026-08-16-fresh-runtime-provider-readiness`

## Status

`completed`

## Requested outcome

Allow Browser Loop Start on a freshly launched, correctly configured runtime to perform the provider capability probe through the main-process authority after durable-recovery preflight, instead of requiring process-local cached readiness created only by Settings.

## Target files

- `electron/browser-session-authority.js`
- `test/browser-session-authority-smoke.js`
- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-16-fresh-runtime-provider-readiness.md`

`electron/main.js` was inspected as a planned target but is not changed. Source inspection proved `AgentRuntimeAdapter` already registers itself as `global.__accessAgentRuntimeAdapter`, and `BrowserSessionAuthority._assertAgentReady()` already reads provider status from that canonical main-process runtime owner. Adding a second injected callback path through `main.js` would duplicate authority rather than repair the existing seam.

## Intent

Preserve BrowserSessionAuthority as the relay-start owner and preserve recovery-first ordering while making capability readiness demand-driven on the real Browser Start path.

## Planned changes

- Keep the initial cached readiness observation.
- If cached readiness is unverified, validate browser/target identity and run the existing durable `recoveryOnly` preflight first.
- If recovery is clear, call `providerReadiness()` once on the same canonical `AgentRuntimeAdapter` already used for provider status.
- Re-read the provider status through `_assertAgentReady()` after the probe.
- Start the relay only when the refreshed provider state is `agent_ready`.
- Preserve cached-ready behavior without an additional probe.
- Add focused regression coverage for successful fresh-runtime probing, failed/unverified probing, cached readiness, and recovery taking precedence with zero provider contact.

Implementation head before validation: `30ccc2763351906f6a9c9cd3730cc98260e32a72`.

## Why

Runtime evidence from a fresh configured process showed valid persisted Cline OAuth and model selection, but provider readiness began unverified. The previous Browser Start path required cached `agentReady=true`; when readiness was unverified it performed a read-only durable recovery preflight and then threw the original readiness error without invoking the existing provider capability probe. This made a freshly restarted, correctly configured runtime unable to reach the provider/tool-schema validation path through Browser Start.

## Constraints preserved

- Readiness logic remains in the main-process runtime authority, not preload or renderer.
- The provider capability probe is not bypassed.
- Unresolved durable recovery is surfaced before provider probing.
- Exact target validation and transport ownership remain intact.
- No background readiness retry was added.
- At most one explicit readiness probe is performed per Browser Start action when cached readiness is unverified.

## Post-change update

A freshly launched Access Agent process with persisted provider/model/auth configuration no longer requires a prior Settings readiness action before Browser Loop Start. Browser Start preserves durable-recovery precedence, performs one demand-driven capability probe when cached readiness is unverified, re-checks provider readiness, and starts the relay only after the provider becomes `agent_ready`.

The earlier local synchronization failure that left the validation worktree on `bb5ab31` remains classified `TEST_HARNESS_FAILURE`; it never executed the source regression and required no source patch.

## Validation evidence

Repository validation was proven on exact head `a9f11460db082e0edc5b1c3395fba2a295492b19`.

Focused validation:

- remote-tracking ref and local validation worktree both resolved to exact `a9f11460db082e0edc5b1c3395fba2a295492b19`;
- validation worktree was clean;
- `node --check electron/browser-session-authority.js` passed;
- `node test/browser-session-authority-smoke.js` passed.

The focused smoke proved:

- fresh unverified readiness -> recovery-only preflight -> one readiness probe -> refreshed `agent_ready` -> relay start;
- cached `agent_ready` -> no additional readiness probe;
- probe remains unverified -> fail closed with relay stopped;
- unresolved durable recovery -> recovery takes precedence and no provider probe occurs.

Full `npm run check` on the same exact head passed, including workspace governance, module registry, workspace contracts, agent-led adaptive tests, browser evals 6/6, Cline provider smoke, Managed Chrome, ProviderChannel, BrowserSessionAuthority, BrowserInstructionRelay, governed terminal, integration, rebuild lifecycle/state/settings/diagnostics/observability/adaptive-continuation, and browser recovery reconciliation.

Fresh-process UI acceptance passed on exact head `780f48a55617528a63e4fdaf07c4b7a30612b1d3`:

- repository-owned acceptance runner launched a new Electron process;
- renderer CDP and runtime API became ready;
- persisted exact ChatGPT conversation was selected without a Settings readiness action;
- real `loopStart` control was clicked;
- Browser Loop Start reached the authoritative ready condition in 18.422 seconds: runtime active, managed browser ready, relay running in `waiting_for_instruction`, exact target present;
- `checkTarget` preserved target identity;
- Loop Stop, Stop All, and final clean-state checks all passed;
- acceptance exited 0.

Final read-only diagnostic correlation used the latest acceptance diagnostic file:

`C:\Users\prave\AppData\Roaming\access-agent\diagnostics\access-agent-2026-08-16T14-16-23-095Z-a23e4783.jsonl`

The latest acceptance session contained exactly one record with:

- `source = provider-readiness`
- `action = capability_probe`

`CAPABILITY PROBE COUNT = 1`.

This directly closes the prior inference gap: the fresh-process Browser Start acceptance itself performed the provider capability probe, and that same acceptance subsequently reached the Browser Loop `waiting_for_instruction` state.

## Result classification

- focused readiness behavior: `PROVEN`;
- full repository regression safety: `PROVEN`;
- fresh-process Browser Start / UI waiting state: `PROVEN`;
- provider capability-probe occurrence in the fresh acceptance session: `PROVEN`;
- change outcome: `COMPLETED / LIVE PROVEN`.