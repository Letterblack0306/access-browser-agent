# Cline Provider Local Test

## Branch

`agent/cline-provider-runtime`

## Purpose

Validate the first provider-neutral runtime slice without replacing Access Agent session, ToolRegistry, browser, MCP, evidence, or UI authority.

Implemented in this branch:

- LM Studio remains supported and explicitly selects `providerKind: lm-studio`.
- Cline provider path uses `@cline/llms` through an Access-owned adapter.
- Cline OAuth uses the official `@cline/core` provider-auth handler.
- OAuth access/refresh tokens are persisted locally in `ide-preferences.json`, restored when Access Agent restarts, refreshed credentials are re-saved, and sign out clears them.
- Cline model discovery comes from the installed Cline model catalog.
- Zero-cost catalog metadata is surfaced as `FREE` in Settings when present.
- Cline tool calls are normalized back into the existing Access `LiveAgentCore`/`ToolRegistry` loop.
- Tool results are converted back into Cline provider continuation messages.

## Pull locally

```powershell
git fetch origin
git switch agent/cline-provider-runtime
git pull --ff-only origin agent/cline-provider-runtime
npm install --no-audit --no-fund
npm run check
```

`npm install` is required because this branch adds `@cline/core`, `@cline/llms`, and `zod`. The existing GitHub workflow also uses `npm install` before validation.

## Test LM Studio regression

1. Start LM Studio and load a tool-capable model.
2. Open Access Agent Settings.
3. Use the LM Studio section as before.
4. Discover models.
5. Run **Test connection**.
6. Save with **Use LM Studio**.
7. Run a normal workspace instruction and confirm the existing agent/tool loop still works.

Expected: provider selection persists as `lm-studio`; normal AgentSessionRuntime and ToolRegistry behavior is unchanged.

## Test Cline account path

1. Open Access Agent Settings.
2. In **Cline account**, click **Sign in with Cline**.
3. The Settings panel will display the authorization URL emitted by the official Cline OAuth flow. Copy/open that URL in a browser and complete sign-in.
4. After authentication completes, click **Discover models** if the list has not already populated.
5. Choose a model. Models whose installed Cline catalog pricing metadata is all zero are marked `FREE`.
6. Click **Test READY**.
7. Click **Use Cline provider**.
8. Run a normal Access Agent instruction that requires a registered tool.

Expected:

```text
Cline account/model
  -> ClineLlmsProvider
  -> LiveAgentCore
  -> Access ToolRegistry
  -> Access tool result
  -> Cline continuation
  -> normal Access completion/evidence
```

The provider must not execute its own shell/editor tools outside Access ToolRegistry.

## Optional non-OAuth test

For provider-adapter testing only, set `CLINE_API_KEY` before starting Access Agent. The provider factory uses it instead of the persisted OAuth session when present.

```powershell
$env:CLINE_API_KEY = '<temporary-key>'
npm start
```

Do not commit credentials.

## Known first-slice limitation

OAuth credentials are intentionally persisted in the existing local `ide-preferences.json` store for this personal-PC integration. Restarting Access Agent restores the saved Cline session. Sign out clears the persisted access and refresh credentials and fails closed if that disk update cannot be completed.

## Completion evidence required before merge

- `npm run check` passes on Windows/Node 22.
- LM Studio regression path still passes.
- Cline OAuth reaches authenticated state.
- Cline model discovery returns a non-empty catalog.
- selected Cline model returns exactly `READY` in provider readiness test.
- at least one Cline-backed Access Agent turn proposes an Access tool, receives the Access tool result, continues, and completes in the same Access session.
- Cline OAuth tokens appear only in the local `ide-preferences.json` by design; they must not appear in logs, receipts, committed files, or PR content.
