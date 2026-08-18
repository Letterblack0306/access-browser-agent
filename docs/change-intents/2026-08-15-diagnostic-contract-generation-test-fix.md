# Change Intent

## Change ID

`2026-08-15-diagnostic-contract-generation-test-fix`

## Status

`in_progress`

## Requested outcome

Update the stale rebuild diagnostic contract test so it validates generation-aware Managed Chrome exit ownership instead of requiring the superseded `if(this.child!==child)return` source string.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-diagnostic-contract-generation-test-fix.md`
- `test/rebuild-diagnostic-contract-smoke.js`

## Intent

Keep the current endpoint-centric Managed Chrome lifecycle unchanged. Correct only the source-contract assertion that still encodes the previous child-identity-only exit guard.

## Planned changes

1. Replace the brittle assertion for `if(this.child!==child)return`.
2. Assert the current generation-aware ownership markers used by Managed Chrome.
3. Preserve all other diagnostic-contract assertions unchanged.

## Why

The exact-head repository check reached `check:rebuild` after all earlier Managed Chrome and browser authority tests passed, then failed only because `test/rebuild-diagnostic-contract-smoke.js` requires a source string removed intentionally by the generation-aware lifecycle fix. Keeping that old assertion would force regression back to weaker ownership semantics.

## Post-change update

Pending the single test assertion correction and exact-head validation.

## Validation evidence

Current failing evidence: `AssertionError` at `test/rebuild-diagnostic-contract-smoke.js:63` for `assert.ok(managedChrome.includes('if(this.child!==child)return'))`, while `Managed Chrome smoke PASS` and `Browser session authority smoke PASS` already succeeded on head `5152cdf5a930a5963cf3b8c4e5eba57ed9f43c60`.
