# Change Intent

## Change ID

`2026-08-15-review-skill-freshness`

## Status

`in_progress`

## Requested outcome

Make the repository's audit/review procedure an actually discoverable runtime skill and align it with the current GPT-Knowledge evidence-first engineering method instead of mental-simulation/determinism claims.

## Target files

- `docs/CHANGE_INDEX.md`
- `docs/change-intents/2026-08-15-review-skill-freshness.md`
- `skills/runtime-review/SKILL.md`
- `skills/SKILL.md`
- `skills/Audit SKILL.md`
- `skills/governed-terminal/SKILL.md`
- `test/skill-catalog-smoke.js`

## Intent

Keep debugging/review procedure in the skill layer and implementation/source changes in GitHub. The local terminal/loop remains an execution capability, not the debugging authority. Runtime/source evidence determines the active owner; skills encode procedure only and grant no execution authority.

## Evidence before change

- `SkillCatalog.list()` discovers only `skills/<directory>/SKILL.md` entries.
- The existing audit content is stored at `skills/SKILL.md` and duplicate `skills/Audit SKILL.md`, so it is not discoverable by the active catalog.
- The existing audit procedure relies on mental simulation, ten-run determinism expectations, and a fixed output workflow that can overstate runtime truth.
- `skills/governed-terminal/SKILL.md` still claims a product-wide static allowlist and an obsolete `.gpt-sync/terminal-receipts` location, while the active `GovernedTerminal` dynamically resolves requested executables, keeps direct general shells denied, allows optional caller narrowing, and writes receipts to the caller-supplied receipt directory.
- GPT-Knowledge requires project/revision identity, active-owner tracing, evidence classification, smallest discriminating checks, claim-matched validation, independent verification for high-risk findings, and skill-freshness review when runtime/tooling/validation changes.

## Planned changes

1. Create one canonical discoverable `runtime-review` skill under the directory shape used by `SkillCatalog`.
2. Encode source/runtime/verification evidence classes and active-owner tracing rather than mental simulation as proof.
3. Explicitly state that the skill does not turn terminal/loop/browser tools into debugging authorities; they are evidence/action capabilities selected as needed.
4. Remove the two stale non-discoverable duplicate audit files to prevent conflicting procedural authority.
5. Refresh the discoverable governed-terminal skill so its procedure matches current machine-adaptive governed execution.
6. Strengthen the skill-catalog regression so directory-based discovery and full skill-body loading are tested.

## Why

The repository's review behavior is itself part of runtime quality. A stale or undiscoverable skill can repeatedly steer the agent toward the wrong owner, outdated command boundaries, or weaker validation even when the implementation has already changed. Keeping one discoverable evidence-first review skill aligns procedural knowledge with the active architecture while preserving the separation between reasoning, action tools, governance, and proof.

## Acceptance criteria

- `SkillCatalog.list()` discovers `runtime-review` from `skills/runtime-review/SKILL.md`.
- `readSkill('runtime-review')` returns the canonical body.
- No duplicate root audit skill remains.
- The procedure distinguishes `PROVEN`, `SUPPORTED`, `HYPOTHESIS`, `UNKNOWN`, and `BLOCKED` and requires validation strength to match the claim.
- `governed-terminal` no longer teaches the removed static capability allowlist or obsolete receipt path.
- Skills remain procedural knowledge only; governance/runtime remains authoritative for actions.

## Post-change update

Implementation is present on the rebuild branch: the canonical `skills/runtime-review/SKILL.md` was added, the two stale non-discoverable root audit files were removed, `skills/governed-terminal/SKILL.md` was refreshed to match the active machine-adaptive terminal contract, and `test/skill-catalog-smoke.js` was expanded to verify discoverability and loaded skill content. The change remains `in_progress` until exact-head repository validation passes.

## Validation evidence

Exact-head repository validation has not yet reached the source/test phase because governance validation first identified missing mandatory intent sections. Those governance-document defects are being corrected before the same full `npm run check` is rerun. No source/test pass is claimed yet.
