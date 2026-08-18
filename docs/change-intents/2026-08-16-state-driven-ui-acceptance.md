# Change Intent

## Change ID

`2026-08-16-state-driven-ui-acceptance`

## Status

`in_progress`

## Requested outcome

Replace repetitive manual Browser Loop click-hunting with a repository-owned state-driven UI acceptance runner. The runner must operate real UI controls by stable semantic IDs, advance only after authoritative runtime state proves the previous step succeeded, stop immediately on failure, and emit enough evidence to identify the blocked step.

## Target files

- `docs/change-intents/2026-08-16-state-driven-ui-acceptance.md`
- `scripts/ui-state-driven-acceptance.js`
- `package.json`

## Method

1. Launch the real Electron application from the repository with a loopback Chromium remote-debugging port selected dynamically.
2. Attach to the actual Access Agent renderer through CDP.
3. Use stable semantic control IDs rather than coordinates.
4. Invoke real DOM clicks for UI-wiring acceptance.
5. After each click, poll `window.accessIde.status()` and advance only when the declared state predicate is proven.
6. Do not use fixed sleeps as success criteria. Polling delays are observation intervals only.
7. Stop on the first failed gate and print expected versus actual state plus the latest renderer/runtime status.
8. Keep the normal happy-path acceptance separate from recovery scenarios.
9. Preserve normal runtime/governance/target ownership boundaries; the runner must not introduce a test backdoor.
10. Keep state-driven runtime acceptance primary; UI clicking proves physical renderer wiring to the same runtime actions.

## Initial scenario

The initial runner validates the Browser Loop control sequence available from the current workbench:

```text
application renderer available
  -> runtime/status API reachable
  -> Browser Loop chat URL available
  -> click Browser Loop Start
  -> wait for loop running / selected target / managed browser endpoint
  -> click Check target
  -> prove selected target remains valid
  -> click Browser Loop Stop
  -> prove loop stopped
  -> click Stop All when available
  -> prove Access-owned runtime/browser/loop resources are stopped
```

If a valid chat URL is not already saved, the runner may consume `ACCESS_AGENT_ACCEPTANCE_CHAT_URL`; otherwise it must report a setup blocker rather than inventing a target.

## Evidence contract

Each step prints:

- step number and ID;
- PASS / FAIL / BLOCKED;
- elapsed time;
- expected predicate;
- relevant actual state on failure;
- renderer target URL;
- runtime/loop/browser/target state when applicable.

The process exits non-zero for a required failed or blocked gate.

## Cross-project rule

The reusable method is documented in GPT-Knowledge as `ui-engineering/state-driven-ui-build-debug-and-acceptance.md`: UI building/debugging should prefer state-gated acceptance over repeated human clicking or blind fixed-delay automation, while retaining focused physical UI-wiring and visual validation where those claims are in scope.
