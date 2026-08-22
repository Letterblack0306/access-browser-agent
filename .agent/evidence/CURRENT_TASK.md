# Current Task Evidence

## Task

Add local-agent visual input and image verification without creating a second reasoning authority.

## Target Repo

`G:\Developments\46_Accecc_Browser_Agent\Browser Agent`

## Confirmed Broken Behavior

- Browser screenshots are currently produced only by failure-evidence capture.
- General browser snapshots expose text and accessibility data but no image evidence.
- Active provider adapters do not declare or translate image input.
- Model readiness tracks completion, tool calling, and structured output only.

## Evidence

- `src/browser/observable-browser-runtime.js`: `BrowserEvidenceStore` persists hashed PNG refs, and `ObservableProviderChannel.captureFailureEvidence` captures screenshots only for failure evidence.
- `src/browser/browser-tool-runtime.js`: `snapshot()` returns bounded text/interactive/accessibility data without screenshot evidence.
- `src/llm/OpenAICompatibleProvider.js`: completion sends the supplied message array unchanged and exposes no image-input capability.
- `src/llm/ClineLlmsProvider.js`: conversation translation is text/tool-result based and exposes no image-input capability.
- `src/llm/ModelReadinessRegistry.js`: readiness capabilities are completion, toolCalling, and structuredOutput only.
- `src/llm/ProviderFactory.js`: active provider kinds are `lm-studio` and `cline`.

## Root Cause

There is no normalized visual evidence contract connecting browser artifacts to agent messages, and no explicit capability gate for image input.

## Minimal Fix

1. Extend the existing evidence store with registered image evidence and controlled evidenceId resolution.
2. Add explicit `imageInput` capability metadata and fail-closed visual-input status.
3. Expose opt-in browser screenshot evidence through the existing browser tool runtime.
4. Add deterministic image comparison over controlled evidence artifacts.
5. Preserve text-only provider behavior and do not claim live multimodal readiness.

## Allowed Edit Paths

- `src/browser/observable-browser-runtime.js`
- `src/browser/browser-tool-runtime.js`
- `src/llm/ModelCatalog.js`
- `src/llm/ModelReadinessRegistry.js`
- `src/llm/OpenAICompatibleProvider.js`
- `src/llm/ClineLlmsProvider.js`
- `src/llm/ProviderFactory.js`
- `src/agent/executive/LiveToolContext.js`
- `test/*visual*`
- `test/*browser*`
- `docs/change-intents/2026-08-22-local-agent-visual-input-verification.md`
- `docs/CHANGE_INDEX.md`

## Required Validation

- focused visual/evidence smoke tests
- `npm run check:agent-led`
- `npm run check:rebuild`
- `git diff --check`

## Remaining Risks

- No active provider/model currently proves real image delivery or visual reasoning.
- Full IMAGE_READ and live IMAGE_COMPARE acceptance remain blocked until a configured multimodal model is explicitly capability-enabled and exercised.
- Existing untracked `section_09.md` is unrelated and must remain untouched.
