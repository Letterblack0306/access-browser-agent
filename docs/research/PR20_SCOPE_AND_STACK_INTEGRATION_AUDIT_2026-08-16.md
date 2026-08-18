# PR #20 Scope and Stack Integration Audit — 2026-08-16

## Classification

`SPLIT_REQUIRED`

## Audited boundary

- Base / PR #18 head: `68eff6f3708bca0198453d6ec9c25ccd862fdc61`
- Combined PR #20 audit head: `49c41bb734547d49ac462ab3a98654d1f832ea29`
- Audited commits: 40
- Audited changed files: 40

## Ownership result

| Combined-stack commits | Classification |
|---|---|
| 1–14 (`521a9e4..35031db`) | Independent browser capability/subagent feature |
| 15–22 (`d02f34d..7df4076`) | Independent terminal re-entry and skill-contract feature |
| 23 (`1ee8e11`) | Structural merge of feature head and PR #18 |
| 24 (`e9dcbc4`) | Independent, unimplemented browser-state lifecycle intent |
| 25–28 (`b9371b6..ba3102f`) | R3 required |
| 29–39 (`e353dc9..80cc573`) | Managed Chrome bootstrap lifecycle required |
| 40 (`49c41bb`) | Audit-gate status only |

## Decision

The clean integration unit starts directly from PR #18 head and contains only the effective R3 and bootstrap lifecycle changes represented by commits 25–39, plus corrected governance/audit documentation.

The combined branch remains recoverable and must not be force-rewritten or deleted until this clean branch passes its full validation contract.

## Falsifier

`SPLIT_REQUIRED` would be disproven only by an identified source/runtime dependency from R3 or bootstrap lifecycle behavior onto commits 1–24. Merge/cherry-pick friction alone is not dependency evidence.

## Required clean-branch proof

- governance and module registry checks;
- focused recovery/relay/authority/runtime-state/shell/browser-lifecycle tests;
- full `npm run check`;
- copied-journal R3 acceptance;
- rendered isolated-fixture R3 acceptance;
- visible bootstrap retirement acceptance;
- unchanged production journal.
