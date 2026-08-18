# Access Agent

A local Electron workbench for an agent-led development workflow.

The selected workspace is the execution boundary. The agent runtime is **provider-neutral**: LM Studio remains a first-class local/private option, but it is not the architectural identity of the agent. Provider adapters may expose local endpoints, account-authenticated providers, API-key providers, cloud providers, or OpenAI-compatible endpoints while the same Access session, tools, browser authority, evidence, and UI contracts remain authoritative.

## Quick start

```powershell
npm install
npm run check
npm start
```

For the currently implemented runtime, start LM Studio, load a tool-capable model, open a workspace in the Electron IDE, configure the provider in **Settings**, and submit an instruction from the **Agent** drawer.

The provider-neutral/Cline integration described below is an implementation direction and must not be reported as active until the corresponding runtime adapter, authentication/model discovery, and live validation are implemented.

## Runtime model

Current implementation:

```text
User instruction
  -> persistent AgentSessionRuntime
  -> LiveAgentCore
  -> ToolRegistry
  -> workspace / terminal / MCP / browser capabilities
  -> observed tool result
  -> same model conversation
  -> validation
  -> evidence-backed turn result
```

Target provider-neutral shape:

```text
User / browser-provider instruction
        |
        v
AgentSessionRuntime
        |
        v
Reasoning-engine adapter
        |
        +-- current native/LiveAgentCore path
        +-- optional Cline lower-layer path
        |      @cline/llms
        |      optional @cline/agents
        |
        v
Provider Registry
        +-- LM Studio / local OpenAI-compatible
        +-- Cline account/provider
        +-- OpenAI / compatible hosted APIs
        +-- Anthropic
        +-- Gemini
        +-- OpenRouter
        +-- cloud providers
        +-- future adapters
        |
        v
Access ToolRegistry
        +-- workspace
        +-- terminal
        +-- Git
        +-- MCP
        +-- browser authority
        +-- BirdEye / project-specific capabilities
```

The UI is a client of the runtime. It does not own a separate agent lifecycle.

## Provider architecture rule

Provider selection must not create a second agent architecture.

The Access runtime remains authoritative for:

- session/turn identity;
- workspace identity;
- tool registration and execution;
- browser target/session authority;
- cancellation and waiting state;
- evidence and receipts;
- validation and completion/failure truth;
- UI projection.

Provider adapters own provider-specific concerns such as authentication plumbing, model discovery, request/stream formats, provider-native tool-call grammar, continuation serialization, and usage/error metadata.

Provider-native events must be normalized before becoming durable Access runtime/UI contracts.

## Cline integration direction

Cline is being evaluated as a reusable provider/agent substrate, not as a wholesale replacement for Access Agent.

Preferred evaluation order:

1. `@cline/llms` — provider breadth, authentication/model discovery, streaming, provider-specific request/response/tool-call mechanics.
2. `@cline/agents` — optional reasoning/tool-continuation loop **only if** Access can intercept tool calls and keep `ToolRegistry` as the execution path.
3. `@cline/shared` — selective stable types/helpers where useful.
4. `@cline/core` / full `@cline/sdk` — optional later evaluation; do not adopt by default because session persistence, built-in tools, workspace discovery, RPC, and execution-host ownership overlap existing Access authorities.

Do not route a Cline-proposed shell/editor/browser mutation around Access `ToolRegistry` and then observe it afterward. The correct flow is:

```text
model proposes tool
  -> Access capability/tool projection
  -> Access ToolRegistry executes
  -> evidence-bearing result
  -> provider/Cline continuation
```

Cline's Plan/Act or approval UX is not an Access runtime requirement. Planning may be used by the reasoning agent when useful; it must not become a transport-owned semantic gate.

## Provider and authentication model

The provider registry should eventually represent, without hard-coding one provider as mandatory:

```text
providerId
providerType
authMode
endpoint/account reference
modelId
model capabilities
health/availability
tier/pricing metadata when supplied
```

Authentication classes may include:

- local/no-auth;
- API key;
- OAuth/account login;
- cloud credential chain;
- custom/OpenAI-compatible endpoint credentials.

For Cline account authentication, use supported Cline SDK/CLI/provider authentication mechanisms. Do not reverse-engineer private tokens or extract browser-session credentials.

Free/paid model availability must be discovered dynamically. Do not hard-code a historical list of Cline free models; tier labels, quotas, and available models may change independently of Access Agent.

LM Studio remains a first-class provider for local/private/offline workflows.

## Core capabilities

- Persistent disk-backed agent sessions and execution traces.
- Native model tool calling through the current `OpenAICompatibleProvider` path.
- Provider-neutral architecture direction with Cline lower-layer evaluation.
- Workspace-scoped read, search, inspect, hash-guarded write, and patch tools.
- Governed command execution and receipts.
- Dynamic MCP tool registration based on live MCP availability.
- Browser capability with explicit target/session authority and attributable evidence.
- LM Studio model discovery, readiness testing, and provider settings in the current implementation.
- Workspace Git status/diff, skills, activity, changes, evidence, and diagnostics surfaces.
- Electron isolation with `contextIsolation`, disabled renderer Node integration, sandboxing, and a narrow preload bridge.

## Layout

```text
electron/            Electron shell, preload, renderer, settings, editor, terminal
src/agent/executive/ persistent agent runtime and reasoning/tool loop
src/agent/           tool registry and action protocol
src/llm/             current provider integration / future provider adapters
src/system/          workspace, terminal, MCP, Git, settings, skills, diagnostics
test/                source-contract, smoke, and integration validation
skills/              reusable workspace and execution procedures
docs/                active architecture and implementation plans
```

## Validation

```powershell
npm run check
```

Live provider behavior requires a running configured provider/model. A source file, class, button, model listing, or passing isolated test is not treated as proof of a runtime capability without the corresponding execution evidence.

A new provider is not complete when authentication or model discovery succeeds. Validation must reach, as applicable:

```text
configuration/authentication
-> provider health
-> model discovery
-> model capability truth
-> live text turn
-> live tool-call turn
-> Access-governed tool execution
-> tool-result continuation
-> cancellation/error attribution
-> persistent session projection
-> UI truth
```

For account/free-tier models, a `FREE` label or model-list entry is not execution proof; the selected account/model must complete a live bounded turn.

## Configuration

Runtime configuration is stored through the Electron preferences layer rather than browser-specific configuration files.

Current implementation:

- LM Studio base URL: configurable in Settings.
- LM Studio model: discovered from the configured provider.
- Workspace: selected by the user at runtime.
- MCP server command: configurable in Settings.
- IDE workspace bridge port: optional `ACCESS_AGENT_IDE_BRIDGE_PORT` environment override.
- Skills root: optional `ACCESS_AGENT_SKILLS_ROOT` environment override.

Target provider-neutral configuration additionally requires:

- selected provider;
- provider-specific authentication state/reference;
- dynamic model discovery;
- model capabilities/compatibility;
- actual active provider/model projection in the UI;
- explicit fallback policy rather than silent provider switching.

Local generated state, credentials, and dependencies must remain excluded from normal workspace/source-control content.

## Related plans

- `docs/BROWSER_AGENT_IMPLEMENTATION_PLAN.md` — browser authority, target identity, provider/control tabs, evidence, and browser-tool architecture.
- `docs/CLINE_PROVIDER_INTEGRATION_PLAN.md` — staged evaluation and implementation plan for Cline-backed provider/auth/model breadth without surrendering Access runtime authority.
