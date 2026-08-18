# LM Studio Provider Audit — 2026-08-07

## Scope

Branch: `feat/browser-capability-hardening`

Reference basis: official `lmstudio-ai/docs` material captured in `Letterblack0306/GPT-Knowledge`, covering authentication, server exposure, model loading, JIT/TTL/Auto-Evict, stateful chat, structured output, and tool calling.

Reviewed implementation:

- `src/llm/OpenAICompatibleProvider.js`
- `src/system/local-runtime-diagnostics.js`
- `electron/lm-studio-settings-bridge.js`
- `electron/main.js`
- `electron/preload.js`
- `src/agent/executive/UnifiedAgentService.js`

## Verdict

**PARTIAL / SINGLE-ENDPOINT BASIC INTEGRATION ONLY**

The current runtime can send deterministic, non-streaming OpenAI-compatible chat-completion requests with native tool definitions. It also supports model listing, provider health state, bounded reconnect, settings persistence, and a real completion-based connection test.

It does not yet represent the full LM Studio runtime contract and is not ready for the user's multi-machine LM Studio workflow without correction.

## Proven strengths

### OpenAI-compatible request path

The provider normalizes the configured URL, resolves `/v1/chat/completions`, sends messages and tools, parses `tool_calls`, and includes a bearer token when an API key is supplied.

### Deterministic agent defaults

Agent requests use `temperature: 0`, `stream: false`, and `tool_choice: auto` when tools are available.

### Bounded provider lifecycle

The runtime tracks configured/reachable/healthy states and retries provider health checks a bounded number of times.

### Real completion test

The settings bridge does more than fetch `/models`: it configures the provider and runs an actual agent completion request.

### Persistence verification

Saved base URL, model, CDP URL, and MCP command are read back and compared against the requested values.

## Findings

### P1 — Remote LM Studio endpoints are blocked by model discovery

`OpenAICompatibleProvider` accepts HTTP or HTTPS hosts, including LAN addresses. However, `LocalRuntimeDiagnostics.listModels()` calls `localUrl()`, which permits only loopback hosts.

Consequences:

- `http://192.168.x.x:<port>` can be used by the provider runtime but cannot be used by the UI Fetch Models path.
- A valid second-machine LM Studio server appears unsupported in Settings even though inference may work.
- The UI and runtime have contradictory endpoint policies.

Required correction:

- Separate the CDP loopback policy from the LM Studio endpoint policy.
- Permit explicitly configured LAN endpoints for LM Studio.
- Do not permit arbitrary public hosts by accident; use an explicit provider endpoint validator with configurable network scope.
- Display whether an endpoint is loopback, LAN, or remote.

### P1 — API-token support exists internally but is not configurable or persisted

The provider supports `Authorization: Bearer <token>`, but the Settings bridge and persisted preferences expose no LM Studio token field or secret-reference mechanism.

Consequences:

- Enabling LM Studio's Require Authentication breaks model discovery and normal configuration from the UI.
- The application encourages unauthenticated local/LAN server use.
- Multi-machine use cannot be secured correctly through the current UI.

Required correction:

- Add an optional API-token input or environment-variable/credential-store reference.
- Never store plaintext tokens in workspace files.
- Apply the token to `/v1/models`, health probes, chat completions, explicit load/unload, and other LM Studio requests.
- Redact tokens from logs, receipts, BirdEye reports, and renderer state.

### P1 — Health check does not prove the configured model is usable

`checkHealth()` marks the provider healthy when `/v1/models` returns successfully. It does not verify that:

- the selected model exists in the returned list;
- the model can load;
- chat completion works;
- tool calling works for that model.

The Settings Test Connection runs a completion, but provider startup/reconnect health uses only model listing.

Required correction:

Track separate health dimensions:

```json
{
  "reachable": true,
  "authenticated": true,
  "modelListed": true,
  "modelLoaded": null,
  "completionReady": true,
  "toolCallingReady": null
}
```

Use a lightweight completion probe only when explicitly testing or when runtime execution first requires it; do not repeatedly generate tokens during ordinary polling.

### P1 — Fetch Models cannot authenticate

`ide:models` accepts only `baseUrl`. `LocalRuntimeDiagnostics.listModels()` sends no Authorization header.

Even after an API key is configured in the provider, the settings model picker cannot use it.

Required correction:

Pass a provider profile or secret reference to model discovery and reuse one authenticated LM Studio client implementation instead of maintaining a separate unauthenticated fetch path.

### P1 — Multi-endpoint and failover routing are absent

The runtime stores one base URL and one model. There is no endpoint registry, upstream identity, health table, routing strategy, sticky session, or failover policy.

This does not satisfy the intended two-machine workflow.

Required correction:

Define a provider-pool contract:

- user-defined endpoint IDs and URLs;
- per-endpoint token reference;
- model inventory and health;
- selected routing mode: manual, round-robin, least-busy, model-aware, or sticky-session;
- bounded failover with no automatic replay after uncertain side effects;
- upstream endpoint recorded in every completion/tool receipt.

### P2 — No explicit model lifecycle controls

The integration does not use LM Studio REST operations for model load/unload or expose:

- context length;
- eval batch size;
- Flash Attention;
- KV-cache GPU placement;
- MoE expert count;
- `echo_load_config`;
- instance ID and load time.

Required correction:

Treat model loading as an optional advanced provider capability. Do not hardcode hardware values. Let the user or profile choose settings and persist the effective `load_config` returned by LM Studio as runtime evidence.

### P2 — JIT, TTL, and Auto-Evict are unmanaged

The client sends no `ttl`, does not know whether JIT loading is enabled, and cannot distinguish cold-load latency from provider failure.

Required correction:

- Support optional TTL in provider profiles.
- Record cold-load versus warm-request timing.
- Expose JIT/Auto-Evict status as server capability when discoverable.
- Avoid aggressive health timeouts that classify model loading as connection failure.
- For multi-endpoint routing, prefer warm compatible endpoints when policy allows.

### P2 — Stateful LM Studio chat is unused

The implementation uses `/v1/chat/completions` and maintains message history in the application. It does not use `/api/v1/chat`, `response_id`, or `previous_response_id`.

This is not inherently wrong; application-owned state is often preferable for evidence and portability. However, the policy should be explicit.

Recommended policy:

- Keep agent execution state application-owned by default.
- Treat LM Studio stateful chat as an optional adapter mode.
- Never mix local message-history replay and `previous_response_id` continuation without a clear ownership rule.
- Persist response lineage if stateful mode is enabled.

### P2 — Structured output is not used for control-plane records

The provider parses free-form chat-completion messages and tool calls. It does not request JSON-schema output for terminal result summaries, dependency records, or other structured control-plane messages.

Recommended use:

- Keep native tool calling for actions.
- Use structured output selectively for final agent result envelopes, dependency reports, and classifier output.
- Validate parsed results against the schema and retain the raw response for diagnostics.
- Do not assume all small models support strict structured output.

### P2 — Malformed tool arguments silently become `{}`

`safeParseArgs()` catches malformed JSON and returns an empty object. This removes evidence that the model produced invalid tool-call arguments and may turn a parse defect into a misleading tool validation failure.

Required correction:

Return an explicit parse result:

```json
{
  "ok": false,
  "code": "TOOL_ARGUMENTS_INVALID_JSON",
  "raw": "..."
}
```

Do not execute the tool when arguments could not be parsed. Emit a correction message to the model and permit only a bounded retry.

### P2 — Test Connection does not enforce its stated READY contract

The readiness prompt requests exactly `READY`, but the bridge only checks whether the completion returned `ok !== false`. It does not verify the response content.

Required correction:

- Inspect the returned summary/content.
- Require the normalized response to equal `READY`, or change the UI text so it truthfully reports only that a completion completed.
- Keep provider identity separate from health state.

### P2 — Endpoint capability and API family are conflated

The provider name is generic OpenAI-compatible, while settings are LM Studio-specific. The runtime does not expose which capabilities are actually available:

- OpenAI-compatible chat only;
- LM Studio REST model management;
- authentication;
- structured output;
- tool calling;
- stateful chat;
- MCP integrations.

Required correction:

Probe and store a capability manifest per endpoint rather than assuming every OpenAI-compatible server has LM Studio-specific features.

## Recommended implementation order

1. Unify authenticated model discovery and provider requests.
2. Replace loopback-only LM Studio validation with explicit loopback/LAN/remote policy.
3. Add secure token configuration and redaction.
4. Improve selected-model and completion health truth.
5. Reject malformed tool arguments explicitly.
6. Add endpoint profiles and multi-endpoint routing.
7. Add optional LM Studio model lifecycle/JIT/TTL support.
8. Add selective structured-output envelopes.
9. Consider optional stateful-chat adapter only after state ownership is documented.

## Acceptance evidence

A future PASS requires:

- loopback LM Studio model fetch and completion;
- authenticated model fetch and completion;
- LAN endpoint fetch and completion;
- selected model missing test;
- cold JIT load test with bounded timeout;
- malformed tool-call argument test;
- exact readiness-response test;
- two-endpoint routing and bounded failover test;
- upstream identity in receipts;
- full `npm run check` pass;
- BirdEye report from the exact tested branch and commit.

Until then, the correct status is:

**single-endpoint OpenAI-compatible LM Studio integration present; secure LAN, lifecycle-aware, and multi-endpoint operation not yet proven.**
