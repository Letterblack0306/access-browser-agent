---
name: evidence-boundary-audit
description: Evidence-driven boundary and reproducibility audit that establishes stable invariants, verifies retry and exactly-once side-effect behavior, compares expected and observed state, detects regressions, and classifies proof quality without equating bounded repeatability with deterministic agent reasoning.
---

# Evidence-driven boundary and reproducibility audit

Use this skill for reliability- and correctness-focused audit concerns: reproducible defects, invariant stability, retry behavior, exactly-once side effects, duplicate-side-effect prevention, state consistency, expected-versus-observed state, and bounded repeatability of a specific operation.

This is **procedural knowledge only**. It does not grant execution authority, create approval authority, redefine governance, or turn browser, terminal, or workspace tools into a debugging authority. It tells the reasoning agent **how to investigate**; the active repository/runtime determines **what is true**.

This skill is a specialization of the canonical `runtime-review` methodology, not a competing audit philosophy. It keeps the same evidence classes, the same active-owner tracing, and the same claim-matched validation ladder. When the two describe the same responsibility, the evidence-first `runtime-review` procedure is authoritative.

## Reasoning-agent boundary

The reasoning agent is not a deterministic workflow machine. Do not model the audit target as a fixed chain of:

`agent -> fixed interpretation -> fixed command -> fixed execution sequence`

Instead assume the agent can and should:

`receive objective/context -> reason over available evidence -> select an appropriate capability -> observe the real result -> update its understanding -> continue, change approach, or report a blocker`

Evaluate whether the agent can:

- interpret the objective;
- research uncertainty;
- choose useful capabilities;
- react to tool failure;
- adapt when evidence changes;
- preserve constraints;
- validate consequences;
- avoid duplicate side effects;
- report insufficient evidence truthfully.

Do not force the agent into a semantic state machine merely to make the audit easier, and do not label legitimate variation in an agent's reasoning as a defect.

## Evidence over reasoning

Source reading and reasoning are how hypotheses are generated. They are **not** runtime proof.

The skill never substitutes in-head reasoning, imagined execution traces, or replayed case flows for observed runtime evidence. Consequential claims are verified through a real test.

Replacement: **Map the expected flow from source and runtime evidence, then verify consequential claims through the smallest discriminating real test.**

Source reasoning may produce a `HYPOTHESIS`; only observed runtime evidence can raise that finding to a supported or proven classification.

## Reproducibility without false determinism

Do not require a fixed repeated-runs determinism test as a generic completion criterion, and never equate repeated identical output with deterministic agent reasoning.

Distinguish instead:

- **reproducibility of a bounded test** - the same discrete check can be rerun and yields a stable, attributable result;
- **stability of an observed behavior** - the behavior under test is consistent across the required evidence window;
- **idempotency** - applying the same bounded operation again does not change the outcome;
- **duplicate-side-effect prevention** - repeated execution did not create duplicate side effects;
- **retry safety** - a retried attempt neither corrupts state nor double-applies work;
- **state consistency** - expected and observed state agree after the operation;
- **true nondeterminism in an agent's reasoning** - reasoning may legitimately adapt between runs.

For agent systems the audit must test **whether the required invariant is preserved**, not whether the agent produces identical reasoning or identical execution traces.

Correct: "Repeated execution of this bounded operation did not create duplicate side effects."

Incorrect: "The agent is deterministic because ten runs matched."

## Audit objectives

This skill's purpose can include:

- identify a reproducible defect;
- establish a stable invariant;
- verify retry behavior;
- verify exactly-once side effects;
- compare expected and observed state;
- detect regressions;
- verify bounded repeatability of a specific operation.

None of these implies that the agent's reasoning is deterministic.

## Operating sequence

Follow the evidence-first sequence:

1. Restate the objective and the exact audit question.
2. Establish the active repository and revision (branch, HEAD, dirty/remote distinction when relevant).
3. Map the actual agent/system flow from source and runtime evidence.
4. Identify active owners (entrypoint, registry, state owner, execution owner, persistence/configuration).
5. Distinguish observed evidence from inference.
6. Formulate a bounded, testable hypothesis.
7. Define a falsifier for that hypothesis.
8. Perform the smallest useful diagnostic that can discriminate.
9. Observe the real result.
10. Classify the evidence.
11. Validate at the level required by the claim.
12. Scan for alternate/duplicate paths before completion.
13. Record remaining unknowns explicitly.
14. Conclude only at the proven evidence boundary.

## Evidence matrix

Replace any fixed, over-stated output format with an evidence matrix. Every significant finding must record:

```
QUESTION:
CURRENT OBSERVATION:
SOURCE EVIDENCE:
RUNTIME EVIDENCE:
AUTHORITATIVE OBSERVABLE:
EXPECTED RESULT:
ACTUAL RESULT:
FALSIFIER:
CLASSIFICATION:
```

A missing field is recorded as `UNKNOWN`, not silently omitted.

## Classifications

Use only the allowed classifications:

- `PROVEN` - directly observed and validated at the level required by the claim.
- `SUPPORTED` - relevant evidence supports the claim, but required practical proof is incomplete.
- `HYPOTHESIS` - plausible explanation awaiting a discriminating check.
- `UNKNOWN` - evidence is insufficient.
- `BLOCKED` - the required evidence path cannot currently be collected because a real dependency/tool/boundary failed.
- `INCONCLUSIVE` - the test could not separate the candidate explanations.
- `STALE_TEST_OR_FIXTURE` - the test or fixture no longer reflects the active runtime path.
- `TEST_HARNESS_FAILURE` - the harness, not the target, failed.
- `RECOVERY_REQUIRED` - an unreconciled or interrupted state must be recovered before further audit.

## Conclusion boundary

The final conclusion must never be stronger than the evidence. Report the exact achieved classification rather than asserting `DONE`, `fixed`, `stable`, or `deterministic` without matches at the required level.

## Governance boundary

This skill grants no authority beyond investigation. Execution, write, and governance decisions remain with the active runtime and repository authority. The skill never reinterprets user intent, never approves its own actions, and never substitutes for the real runtime evidence owner.