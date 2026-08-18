---
name: runtime-review
description: Evidence-first repository/runtime review that traces the active owner, classifies proof strength, and validates the real user path without turning execution tools into a debugging authority.
---

# Runtime Review

Use this skill for repository review, runtime investigation, browser-agent failures, execution-path audits, regression review, and completion verification.

This is **procedural knowledge only**. It does not grant execution authority, override governance, or create an approval workflow.

## Core boundary

Keep responsibilities separate:

- the reasoning agent interprets the objective, evidence, hypotheses, and next useful check;
- GitHub/repository source is the implementation and review surface;
- runtime logs/events/receipts are execution evidence;
- terminal, browser, workspace, MCP, and other tools are action/evidence capabilities, not the debugging authority;
- governance owns deterministic write/execution boundaries;
- UI status is a projection of runtime truth, never proof by itself.

Do not turn a local terminal/loop utility into a special debugging subsystem.

## Required evidence classes

Use the strongest class actually supported:

- `PROVEN` — directly observed and validated at the level required by the claim.
- `SUPPORTED` — relevant evidence supports the claim, but required practical proof is incomplete.
- `HYPOTHESIS` — plausible explanation awaiting a discriminating check.
- `UNKNOWN` — evidence is insufficient.
- `BLOCKED` — the required evidence path cannot currently be collected because a real dependency/tool/boundary failed.

A failed tool invocation proves only that the invocation failed. A passing unit test proves only the behavior represented by that test.

## Operating sequence

1. Lock project identity: repository, branch/revision, runtime/environment, dirty/remote distinction when relevant.
2. Restate the observable requirement and the exact current failure/evidence.
3. Classify the problem: structural, behavioral, runtime, integration, state, governance, UI truth, validation, performance, or recovery.
4. Trace the real owner from user-visible behavior backward through entrypoint, router/registry, state owner, execution owner, and persistence/configuration.
5. Check for duplicate/legacy/compatibility owners before editing.
6. Identify the **earliest proven incorrect state**, not merely the final error message.
7. Form at most a few bounded hypotheses and choose the smallest check that can discriminate between them.
8. Prefer repository/source inspection and existing runtime evidence before inventing new diagnostics.
9. When a source change is justified, declare/confirm the governed change target before mutation.
10. Patch the smallest active owner and add regression coverage for the proven mechanism.
11. Validate at the level required by the claim.
12. Run a bounded parallel-path/skill-freshness scan before completion.
13. Record remaining unknowns or blocked proof explicitly.

## Browser-agent review

For browser behavior, success is not "Chrome opened" or "an API returned 200" alone.

Trace and verify the relevant chain:

`browser discovery -> connection/CDP health -> browser instance identity -> target discovery -> explicit target identity -> action/navigation -> postcondition -> evidence`

A launcher PID is not browser truth if the backend contract is endpoint/target based. Conversely, a visible browser window is not proof that the runtime owns a usable browser endpoint.

Do not silently fall back to a different browser/profile/backend.

## Runtime/process review

For crashes, timeouts, dead processes, or wrong lifecycle:

- inspect existing correlated events first;
- identify who created the process and who can stop/replace it;
- distinguish launcher-process lifetime from service/backend readiness when the architecture permits handoff;
- capture exit/error/endpoint evidence without flooding unchanged poll records;
- do not infer process failure from unrelated stderr produced by another runtime layer.

## Skill freshness gate

Whenever runtime lifecycle, tool registry/schema, provider integration, workspace layout, commands, validation, state/persistence, or UI execution surface changes, review affected skills.

Ask:

- Does the skill point to the active owner?
- Does it assume a removed path, command, allowlist, port, profile, or workflow?
- Does it prescribe a weaker completion proof than the runtime now requires?
- Does another skill contradict it?
- Is the skill actually discoverable by the current skill catalog?

Treat stale skills as behavioral defects, not harmless documentation drift.

## Validation ladder

Match proof to the claim:

`source -> static/build -> unit/contract -> integration -> runtime -> user-visible`

Examples:

- source ownership claim: source/reachability proof may be sufficient;
- runtime lifecycle fix: runtime proof required;
- browser loop works: real browser endpoint + exact target + action/postcondition proof required;
- user-facing status is correct: backend consequence plus rendered state required.

Do not label lower-layer validation as end-to-end.

## Independent verification for high-risk findings

For broad architecture changes, destructive actions, security/governance changes, or release-critical conclusions:

- separate candidate finding from verified finding;
- attempt to falsify the finding using full caller/callee/runtime context;
- distinguish newly introduced defects from pre-existing ones;
- deduplicate overlapping findings;
- do not let the writer's patch self-approve its own assumptions.

## Completion predicate

Do not conclude `DONE`, `fixed`, `stable`, or `end-to-end` unless:

- the intended change exists;
- the active runtime path uses it;
- relevant validation passes;
- observed behavior matches the requirement at the claimed evidence level;
- no known blocker remains in scope;
- evidence is attributable to the tested revision.

Otherwise report the exact achieved level: `PROVEN`, `SUPPORTED`, `HYPOTHESIS`, `UNKNOWN`, or `BLOCKED`.
