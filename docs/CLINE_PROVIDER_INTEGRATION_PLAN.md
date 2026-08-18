# Cline Provider Integration Plan

## Status

Implementation plan for making Access Agent provider-neutral while preserving its existing runtime, tool, browser, evidence, and UI authorities.

This plan does **not** declare Cline integration implemented. It defines the staged evaluation and acceptance criteria required before any Cline-backed provider/auth/model path can be treated as active.

## Source hierarchy

Use these sources in this order:

1. current `main` source/runtime — active project truth;
2. GPT-Knowledge:
   - `ai-agents/cline-runtime-reuse-for-governed-agent-infrastructure.md`;
   - `ai-agents/provider-neutral-agent-auth-and-model-routing.md`;
   - `ai-agents/agent-reasoning-transport-boundary.md`;
   - `project-engineering/project-feature-implementation-plan.md`;
3. pinned Cline SDK/package source and official documentation for the exact version being evaluated;
4. model/provider prior knowledge only after live verification.

Do not copy Cline product UX or architecture wholesale merely because the SDK is reusable.

---

# 1. Problem statement

The current Access implementation is strongly centered on an OpenAI-compatible local provider path, especially LM Studio.

LM Studio must remain supported, but provider choice should not define the agent architecture.

Required end state:

```text
Access Agent runtime
        |
        v
reasoning/provider adapter boundary
        |
        +-- current native/OpenAI-compatible path
        +-- Cline lower-layer path
        +-- future native adapters
        |
        v
selected provider/model
```

Changing provider must not create a competing session runtime, tool dispatcher, browser authority, evidence store, or completion state machine.

---

# 2. Non-negotiable Access authorities

The following remain Access-owned unless a later architecture decision explicitly replaces them with equivalent proven owners:

```text
AgentSessionRuntime
session/turn identity
ToolRegistry
workspace tools
terminal execution path
MCP registration/execution path
browser authority + target identity
BirdEye/project-specific tools
ExecutionEventSchema / normalized events
evidence/receipts
cancellation/waiting projection
completion/failure truth
Electron UI projection
```

Cline must enter through an adapter boundary.

Correct:

```text
Cline/provider proposes tool call
        -> Access adapter normalizes call
        -> Access ToolRegistry executes
        -> Access records result/evidence
        -> normalized result returns to Cline/provider continuation
```

Incorrect:

```text
Cline built-in shell/editor/browser mutates workspace directly
        -> Access observes afterward
```

---

# 3. Target provider registry

The provider layer should eventually support a normalized record conceptually equivalent to:

```text
providerId
providerType
authMode
displayName
endpoint/account reference
authenticated
health
models[]
selectedModelId
capabilities
availability reason
provider metadata
```

Initial provider classes:

```text
local/no-auth
API-key provider
OAuth/account provider
cloud credential provider
OpenAI-compatible endpoint
```

Expected product options may include:

- LM Studio / local OpenAI-compatible;
- Cline account/provider;
- OpenAI-compatible hosted providers;
- Anthropic;
- Gemini;
- OpenRouter;
- cloud-provider adapters when justified;
- future adapters without changing the agent/session contract.

This list is architectural scope, not a claim that all providers are implemented immediately.

---

# 4. Cline reuse boundary

## 4.1 Evaluate `@cline/llms` first

Goal: gain provider breadth and provider-native mechanics with the smallest authority overlap.

Prove:

- package can be pinned reproducibly;
- supported provider authentication can be invoked through official/public mechanisms;
- model discovery is available or can be adapted truthfully;
- streaming text/tool events can be normalized;
- tool calls can be intercepted before mutation;
- usage/errors/cancellation can be mapped to Access runtime events;
- no Cline session/tool owner is required merely to use the provider layer.

If this succeeds, use it as the preferred first integration seam.

## 4.2 Evaluate `@cline/agents` second

Goal: determine whether Cline's mature reasoning/tool-continuation loop can replace or simplify the custom reasoning loop without replacing Access execution authority.

Required proof:

```text
user turn
-> Cline agent reasoning
-> tool proposal
-> Access ToolRegistry
-> evidence-bearing result
-> Cline continuation
-> final turn result
```

Reject this layer if its normal use requires Cline's built-in mutation tools to bypass Access ownership.

## 4.3 Keep `@cline/core` optional

Do not adopt full ClineCore by default.

Its session persistence, built-in tools, workspace/config discovery, SQLite state, RPC, and execution-host behavior overlap active Access owners.

Evaluate individual concepts later only where there is a proven gap, for example:

- cross-process RPC;
- provider/session continuation metadata;
- persistence implementation techniques.

No dual source of truth is allowed.

---

# 5. Authentication plan

## 5.1 General rule

Use official provider authentication mechanisms.

Do not:

- scrape private web-session tokens;
- copy browser cookies into Access credentials;
- expose credentials to prompts;
- store secrets in normal workspace files or transcripts.

## 5.2 Cline account path

For Cline account-backed access:

1. inspect the exact pinned Cline SDK/CLI auth API;
2. use its supported login/OAuth mechanism;
3. determine the minimum durable credential/account reference Access must retain;
4. keep provider tokens outside workspace content;
5. support sign-out/revocation state;
6. project authenticated account/provider state into Access UI without exposing secrets.

Authentication success does not imply model execution success.

---

# 6. Model discovery and free-tier handling

Never hard-code a permanent list of Cline free models.

Model availability, free-tier status, quotas, and reset policies are provider runtime data.

Required model-discovery flow:

```text
provider configured/authenticated
        -> health
        -> list models
        -> normalize model metadata
        -> capability compatibility check
        -> display/select
        -> live invocation proof
```

If Cline/provider metadata marks a model as free/zero-price, render that metadata truthfully. Do not infer free status from names.

A model selector entry is not sufficient proof that the current account can invoke that model.

---

# 7. Capability negotiation

Access must distinguish:

```text
provider configured
provider authenticated
provider reachable
model discovered
model compatible
model ready
```

At minimum normalize capabilities relevant to Access:

- text generation;
- streaming;
- tool/function calling;
- provider continuation after tool results;
- context/token limits where exposed;
- vision where relevant;
- cancellation support;
- usage reporting;
- structured output/reasoning controls where actually supported.

A model without usable tool calling must not silently be treated as equivalent to a tool-capable agent model.

---

# 8. Normalized provider event adapter

Cline/provider-native event shapes must not become permanent Access UI/runtime contracts.

Use:

```text
Cline/provider event
        -> ClineProviderAdapter
        -> Access normalized model event
        -> AgentSessionRuntime / ExecutionEventSchema
        -> transcript / trace / UI
```

Preserve provider-native IDs and diagnostics only as backend metadata when useful.

The adapter must truthfully preserve:

```text
turn start
text/reasoning deltas where available
tool-call start/arguments/completion
usage
requires-tool/continuation
completed/incomplete/refused
cancelled
error
```

Do not fabricate event types the provider does not actually expose.

---

# 9. Session portability

Access session identity remains stable independently of provider identity.

Provider-specific conversation/continuation IDs may be persisted as opaque backend metadata.

If a user changes provider/model mid-session, implement an explicit policy:

```text
reconstruct normalized conversation context for new provider
OR
start a new provider conversation associated with the same Access session
```

The UI and evidence must not imply provider-native continuity if none exists.

---

# 10. Browser architecture interaction

Cline provider integration does not replace Access browser authority.

Keep:

```text
BrowserInstructionRelay
browser session/target authority
provider/control target identity
work-target identity
browser inspection/action tools
browser evidence/result store
```

A browser-hosted ChatGPT/Gemini/Copilot surface may remain a control/provider transport where that workflow is intentionally used, but account/API providers should also be usable without browser-provider transport.

The browser capability and model-provider capability are orthogonal:

```text
reasoning provider: Cline account / LM Studio / hosted API
browser work target: selected Chrome tab
```

Do not couple the selected reasoning provider to the browser target.

---

# 11. UI plan

Provider UI should eventually expose runtime truth rather than LM-Studio-only assumptions.

Conceptual surfaces:

```text
Provider        [ Cline | LM Studio | ... ]
Account/Auth    [ signed in / API key configured / local ]
Health          [ ready / unavailable / auth required ]
Model           [ dynamically discovered list ]
Capability      [ tool calling, vision, etc. ]
Tier            [ FREE/paid metadata only when provider supplies it ]
Actual runtime  [ provider + model currently used ]
```

Do not show "ready" merely because settings were saved.

LM Studio settings can remain during migration, but should move under a provider-specific adapter/settings surface rather than remain global architecture.

---

# 12. Implementation phases

## Phase 0 — Baseline and pinned Cline study

- record Access `main` commit;
- run current `npm run check`;
- trace current provider construction from Settings -> provider -> reasoning core;
- inventory every LM-Studio-specific assumption in runtime and UI;
- pin exact Cline package versions for evaluation;
- inspect package APIs/license/NOTICE obligations.

Completion:

```text
current provider path proven
AND Cline package/version pinned
AND authority-overlap map complete
```

## Phase 1 — Provider interface extraction

Introduce the smallest provider-neutral contract around the current `OpenAICompatibleProvider` path without changing behavior.

Prove LM Studio still works through the extracted boundary.

Completion:

```text
LM Studio live text/tool turn unchanged
AND provider identity no longer hard-coded into AgentSessionRuntime/LiveAgentCore contracts
```

## Phase 2 — Cline provider/auth prototype

Add a Cline adapter using the lowest viable package layer.

Prove:

- official authentication path;
- authenticated/unauthenticated state;
- health;
- dynamic model discovery;
- capability metadata;
- one live bounded text turn.

Do not wire mutation tools yet.

## Phase 3 — Access-governed tool continuation

Expose Access tools to the Cline reasoning/provider layer.

Prove one real sequence:

```text
prompt
-> Cline-backed reasoning
-> tool call proposal
-> Access ToolRegistry execution
-> Access evidence
-> tool result returned
-> provider continuation
-> final response
```

No direct Cline built-in mutation path may execute during this proof.

## Phase 4 — Cancellation, failure, and session continuation

Prove:

- provider error attribution;
- auth expiry/unavailable state;
- explicit cancellation;
- tool failure continuation semantics;
- waiting state;
- multi-turn same Access session;
- provider continuation identity persisted truthfully.

## Phase 5 — Provider-neutral UI

Replace LM-Studio-specific global assumptions with provider registry projection.

Prove:

- provider switch reflected from backend truth;
- authentication state accurate;
- models dynamically discovered;
- incompatible/unavailable models disabled with reason;
- actual provider/model recorded in trace/evidence.

## Phase 6 — Broader provider evaluation

Only after Cline + LM Studio coexist cleanly, decide whether to expose additional providers through Cline or native adapters.

Do not add providers solely to increase a count. Each provider must have a validated authentication, model, capability, tool, cancellation, and failure path.

---

# 13. Validation matrix

For each provider adapter record:

| Layer | Required proof |
|---|---|
| configuration | settings load and normalize |
| authentication | actual account/key/local state |
| health | live reachable/unavailable reason |
| model discovery | provider-derived list |
| capability | model suitability for Access tools |
| text turn | live response |
| tool turn | Access ToolRegistry executes proposal |
| continuation | provider consumes tool result |
| cancellation | bounded stop with truthful result |
| failure | no false success |
| session | next turn continues correctly |
| evidence | provider/model/tool identities attributable |
| UI | frontend matches backend truth |

Lower-layer proof does not justify higher-layer claims.

---

# 14. Migration rule

LM Studio remains supported throughout migration.

Do not delete the current provider implementation until:

1. it has been wrapped behind the provider-neutral contract;
2. the new contract is proven with the existing local path;
3. Cline integration is separately proven;
4. provider switching does not alter tool/browser/session authority;
5. regression/runtime validation passes.

No silent provider fallback.

If a configured provider fails, report that provider failure and only use another provider when explicit fallback policy permits it. Record the provider/model actually used.

---

# Completion predicate

The provider-neutral/Cline milestone is complete only when a live Access session proves both paths:

```text
Path A — local
Access session
-> LM Studio/local provider
-> tool call
-> Access ToolRegistry
-> evidence
-> provider continuation
-> final response

Path B — Cline/account-backed
Access session
-> supported Cline auth
-> dynamically discovered compatible model
-> tool call
-> Access ToolRegistry
-> evidence
-> provider continuation
-> final response
```

and both share the same Access session/tool/browser/evidence contracts.

## Final rule

**LM Studio is a provider, not the agent. Cline may supply mature provider/auth/reasoning mechanics, but Access retains session, tools, browser authority, evidence, validation, and UI truth. Model availability is discovered at runtime and no account/free-tier claim is complete until a live invocation proves it.**
