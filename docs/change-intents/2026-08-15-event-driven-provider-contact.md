# Change Intent

## Change ID

`2026-08-15-event-driven-provider-contact`

## Status

`in_progress`

## Requested outcome

Make optional model-provider connectivity event-driven instead of background-driven. Access Agent must not repeatedly contact LM Studio or another saved provider while idle. A provider is contacted only when an explicit user/runtime action needs that provider, and an unreachable provider produces one bounded failure for that action before remaining silent until the next meaningful action.

## Intent

Enforce a passive-by-default provider lifecycle. Saved provider configuration may be loaded and installed in memory, but it must not cause network activity by itself. Provider contact is permitted only when a concrete user or runtime action requires it, and each such action owns one bounded attempt sequence. Failure is surfaced once as runtime evidence and then remains quiet until another meaningful action explicitly needs the provider.

## Runtime contract

- App boot loads saved provider configuration passively and performs **zero provider network requests**.
- Passive provider configuration/install performs **zero model-list or health network requests**.
- `Discover` performs one model-discovery request for that click. If unreachable, record one failure and stop; do not schedule retries.
- `Use` / capability verification installs the requested provider passively, then performs readiness work. If the first readiness completion cannot connect, stop that readiness attempt immediately; do not run further capability probes.
- An agent operation that actually requires the selected provider may initiate a fresh readiness attempt when capability is not yet verified. An unreachable provider is returned as visible evidence for that operation; no background retry follows.
- A later explicit action is a new opportunity to connect. Previous failure must not permanently suppress a future user/runtime attempt.
- No heartbeat, retry timer, model polling, health polling, or exponential reconnect loop is permitted for an idle/offline optional provider.
- Provider failures in Complete Log must correspond to a concrete user/runtime action, not passive UI status polling.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-event-driven-provider-contact.md`
- `docs/REBUILD_REMOTE_COMPLETION_AUDIT_2026-08-14.md`
- `electron/agent-runtime-adapter.js`
- `electron/rebuild-settings.js`
- `test/rebuild-agent-truth-observability-smoke.js`

## Why

The live Windows diagnostic session `access-agent-2026-08-15T01-07-04-928Z-f5eb31a9.jsonl` proved that application startup called `OpenAICompatibleProvider.listModels()` against saved LM Studio URL `127.0.0.1:1234`, resulting in `ECONNREFUSED`. Source inspection showed `createConfiguredAgentRuntime()` calls `updateProviderSettings()` on boot, and the previous `updateProviderSettings()` performed model discovery followed by `checkHealth()` for normal configuration. This contradicted the rebuild contract that saved provider state is passive and produced repeated failures unrelated to a user action.

## Planned changes

1. Make normal `updateProviderSettings()` install/update provider state without network I/O.
2. Keep `discoverOnly` as the explicit one-request model-discovery path.
3. Remove settings-page pre-readiness health checks that duplicate connectivity work before the actual capability test.
4. When an agent operation needs a provider whose capability is unverified, run the bounded readiness probe on demand; if initial completion connectivity fails, return a blocked provider observation for that operation.
5. Add source regressions proving passive configuration does not call model listing/health checks and settings actions do not perform a redundant health gate before readiness.
6. Update the canonical rebuild audit with the event-driven provider-contact rule.
7. Require isolated Windows `npm run check` plus live trace verification after pull.

## Non-goals

- Do not add automatic reconnect timers.
- Do not change provider URLs or credentials.
- Do not weaken the requirement that a selected model prove real tool-call capability before agent execution.
- Do not redesign the current UI.

## Post-change update

Remote implementation is complete and remains `in_progress` only because isolated Windows execution has not yet revalidated the new head.

- Normal provider configuration now installs the provider and returns `contactState: not_checked` without calling model listing or `checkHealth()`.
- `discoverOnly` remains the only configuration path that performs model discovery, with one list operation for that explicit action.
- Settings `Test`/`Use` no longer make a redundant health request before readiness; they configure passively and then call the capability probe.
- `AgentRuntimeAdapter.run()` now performs a fresh bounded readiness attempt when a real agent operation needs an unverified provider. If the first completion cannot connect, the existing readiness logic stops before tool/structured probes and the operation returns a visible provider precondition observation.
- No retry timer, provider heartbeat, model polling or idle reconnect loop was added.
- The canonical rebuild audit and PR #15 body now state the same event-driven provider-contact contract.

## Validation evidence

Remote source re-open confirmed the new control flow: passive configuration returns `contactState: not_checked`; discovery is isolated under `discoverOnly`; agent execution calls readiness on demand; settings no longer gate Test/Use on `configured.provider.healthy`.

`test/rebuild-agent-truth-observability-smoke.js` now asserts those source contracts. This is not runtime proof. Required closure evidence is an isolated Windows `npm run check` followed by `start:trace` proving idle boot is silent, one offline Discover click produces one discovery failure, and a later provider-dependent action is allowed one new bounded attempt without background retries between actions.

## Superseding decision (2026-08-25): eager discovery retained

Operator arbitration between two competing implementations resolved in favor of commit `e5dbdf1`: the `discoverOnly: true` path performs its one bounded model-discovery request immediately on that explicit click and returns fully resolved health fields (`contactState: listError ? 'failed' : 'checked'`, plus `reachable`, `healthy`, `failureReason`, `modelCount`) instead of a passive `not_checked` placeholder.

- The passive `contactState: 'not_checked'` return value is retired from the `discoverOnly` default path.
- The event-driven rules that remain in force: no heartbeat/retry/polling loops, no background reconnect, one bounded attempt per explicit action, no redundant health gate before readiness.
- `test/rebuild-agent-truth-observability-smoke.js` now asserts `contactState:listError ? 'failed' : 'checked'` in place of the retired `not_checked` assertion.
- Known residual gap outside this decision: the non-discover-only configuration path (invoked at boot via `createConfiguredAgentRuntime()`) still performs model listing, which predates this change intent and remains tracked separately.
