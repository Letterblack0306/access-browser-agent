# Local-agent visual input and image verification

## Change ID

`2026-08-22-local-agent-visual-input-verification`

## Status

in_progress

## Requested outcome

Give the existing local agent bounded screenshot evidence and deterministic image verification while keeping the local runtime as the only reasoning authority.

## Intent

Extend the existing local agent with bounded screenshot evidence and image verification while keeping `AgentSessionRuntime` and `LiveAgentCore` as the only reasoning authority.

## Scope

- Normalize screenshot evidence around evidence IDs and SHA-256 identity.
- Resolve artifacts only through the existing evidence store, never arbitrary provider paths.
- Add explicit image-input capability metadata and fail-closed text-only behavior.
- Add browser screenshot evidence and deterministic before/after comparison.

## Why

The repository already persisted hashed screenshots for failure evidence, but ordinary browser tools and provider readiness had no visual evidence contract or explicit image-input capability state.

## Planned changes

- Extend the existing evidence store with controlled image resolution and comparison.
- Expose explicit browser screenshot and screenshot-comparison tools.
- Track image-input capability without inferring it from provider names.
- Reject image-bearing requests when the selected provider/model is not explicitly configured for image input.
- Add focused regression coverage and document the unproven live multimodal boundary.

## Target files

- `src/browser/observable-browser-runtime.js`
- `src/browser/browser-tool-runtime.js`
- `electron/browser-session-authority.js`
- `electron/main.js`
- `src/agent/executive/LiveToolContext.js`
- `src/llm/ModelCatalog.js`
- `src/llm/ModelReadinessRegistry.js`
- `src/llm/OpenAICompatibleProvider.js`
- `src/llm/ClineLlmsProvider.js`
- `src/llm/ProviderFactory.js`
- `src/system/ide-preferences.js`
- `electron/agent-runtime-adapter.js`
- `src/agent/executive/UnifiedAgentService.js`
- `test/visual-evidence-smoke.js`
- `docs/CURRENT_STATUS.md`
- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-22-local-agent-visual-input-verification.md`

## Out of scope

- A second visual agent or reasoning loop.
- Claiming provider/model multimodal readiness without a real configured probe.
- External BirdEye/workspace-node authority.

## Post-change update

Implemented the bounded evidence and capability-gating slice. Governed screenshot capture and comparison are READY. Provider-native image delivery and model-backed visual reasoning remain OPEN for the next acceptance gate and do not block this phase.

## Validation

- Focused evidence, screenshot, capability, and comparison smoke tests.
- Existing agent-led and rebuild validation.

## Validation evidence

- `node test/visual-evidence-smoke.js` — PASS
- `npm run check:agent-led` — PASS
- `npm run check:rebuild` — PASS
- `npm run precheck` — PASS
- `git diff --check` — PASS
