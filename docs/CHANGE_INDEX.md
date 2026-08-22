# Workspace Change Index

> Hard governance index for agent-authored workspace mutations.
>
> Before an agent writes, patches, deletes, creates an ordinary workspace file, or runs a governed workspace command for a change, the change must be listed here and its intent document must already contain the required pre-change sections.

| Change ID | Status | Requested outcome | Intent document |
| --- | --- | --- | --- |
| `2026-08-14-workspace-governance-blocker` | `completed` | Add fail-closed pre-change documentation governance and runtime-module maintenance visibility to the Access Agent rebuild. | `docs/change-intents/2026-08-14-workspace-governance-blocker.md` |
| `2026-08-15-objective-budget-message-test-fix` | `completed` | Correct the case-sensitive tool-budget blocker assertion found by the first isolated Windows validation. | `docs/change-intents/2026-08-15-objective-budget-message-test-fix.md` |
| `2026-08-15-diagnostic-correlation-merge-fix` | `completed` | Preserve inherited diagnostic operation correlation when a producer supplies undefined correlation fields. | `docs/change-intents/2026-08-15-diagnostic-correlation-merge-fix.md` |
| `2026-08-15-task-state-router-negative-test-fix` | `completed` | Narrow the stale semantic-router negative assertion so it does not reject the transport-only `TaskStateRouterBridge` class name. | `docs/change-intents/2026-08-15-task-state-router-negative-test-fix.md` |
| `2026-08-15-ui-stability-runtime-truth` | `completed` | Keep the approved rebuild UI while calming cursor/status churn, removing CSP-blocked inline styles, and projecting real runtime/tool evidence into the Execution Monitor. | `docs/change-intents/2026-08-15-ui-stability-runtime-truth.md` |
| `2026-08-15-event-driven-provider-contact` | `in_progress` | Make optional provider connectivity passive while idle and bounded to one explicit discovery/reachability attempt per meaningful action. | `docs/change-intents/2026-08-15-event-driven-provider-contact.md` |
| `2026-08-15-runtime-control-consolidation-csp` | `in_progress` | Restore browser-owned instruction UX: exact chat URL + one Start/Stop path, Access-owned managed Chrome profile/dynamic CDP, recovery controls only, and strict-CSP layout safety. | `docs/change-intents/2026-08-15-runtime-control-consolidation-csp.md` |
| `2026-08-15-inline-live-toolcall-ui` | `in_progress` | Render truthful live agent/tool-call activity inline in the browser-owned session stream using the supplied LBE runtime prototype as visual reference, with no approval workflow. | `docs/change-intents/2026-08-15-inline-live-toolcall-ui.md` |
| `2026-08-15-machine-capability-discovery` | `in_progress` | Discover the live host environment and dynamically resolve executable capabilities so registered tools are current adapters rather than a fixed definition of machine capability. | `docs/change-intents/2026-08-15-machine-capability-discovery.md` |
| `2026-08-15-runtime-instance-ownership` | `in_progress` | Remove the legacy machine-global single-instance startup blocker so independent Access Agent runtimes can own dynamic local endpoints without silent process exit. | `docs/change-intents/2026-08-15-runtime-instance-ownership.md` |
| `2026-08-15-browser-cdp-generation-recovery` | `in_progress` | Recover current-generation Managed Chrome CDP deterministically and invalidate stale relay target state after browser startup failure. | `docs/change-intents/2026-08-15-browser-cdp-generation-recovery.md` |
| `2026-08-15-diagnostic-noise-coalescing` | `in_progress` | Stop diagnostic flooding by suppressing unchanged poll/byte IPC success traffic and coalescing repeated identical evidence while preserving transitions and failures. | `docs/change-intents/2026-08-15-diagnostic-noise-coalescing.md` |
| `2026-08-15-review-skill-freshness` | `in_progress` | Make runtime/repository review an actually discoverable evidence-first skill and retire stale non-discoverable audit duplicates. | `docs/change-intents/2026-08-15-review-skill-freshness.md` |
| `2026-08-15-diagnostic-contract-generation-test-fix` | `in_progress` | Update the stale diagnostic contract test to validate generation-aware Managed Chrome exit ownership. | `docs/change-intents/2026-08-15-diagnostic-contract-generation-test-fix.md` |
| `2026-08-15-execution-status-domain-boundary` | `in_progress` | Prevent tool/browser observation states from leaking into `ExecutionEventSchema.status` during browser-owned task startup. | `docs/change-intents/2026-08-15-execution-status-domain-boundary.md` |
| `2026-08-16-general-browser-tools-evals` | `in_progress` | Add isolated general HTTP/HTTPS browser tools for the reasoning agent plus deterministic eval-style regression scenarios without weakening the exact-chat transport boundary. | `docs/change-intents/2026-08-16-general-browser-tools-evals.md` |
| `2026-08-16-browser-conversation-turn-transport` | `in_progress` | Remove the normal-agent text-envelope gate, transport natural assistant turns into the continuing local reasoning session, and expose bounded read-only context from the selected protected Browser Loop conversation; retain structured parsing only for explicit `quick_command`. | `docs/change-intents/2026-08-16-browser-conversation-turn-transport.md` |
| `2026-08-16-provider-tool-schema-array-items` | `in_progress` | Define the applyPatch edits item schema so strict provider tool validators accept the declared function set. | `docs/change-intents/2026-08-16-provider-tool-schema-array-items.md` |
| `2026-08-16-fresh-runtime-provider-readiness` | `completed` | Let a fresh Browser Start perform one demand-driven provider capability probe after durable-recovery preflight and reach relay waiting state without a prior Settings readiness action. | `docs/change-intents/2026-08-16-fresh-runtime-provider-readiness.md` |
| `2026-08-16-recovery-renderer-input` | `completed` | Replace unsupported renderer prompt-based recovery input with a controlled in-renderer form while preserving the existing reconciliation authority and append-only journal contract. | `docs/change-intents/2026-08-16-recovery-renderer-input.md` |
| `2026-08-16-scope-level-recovery-discovery` | `completed` | Fail closed before Browser Loop start when any unreconciled ambiguous durable instruction exists for the selected workspace + exact conversation, even when a newer assistant turn is currently visible. | `docs/change-intents/2026-08-16-scope-level-recovery-discovery.md` |

| `2026-08-16-r3-ambiguous-durable-recovery` | `completed` | Add evidence-preserving operator reconciliation for ambiguous durable Browser Loop records without automatic replay, evidence deletion, or semantic completion guessing. | `docs/change-intents/2026-08-16-r3-ambiguous-durable-recovery.md` |
| `2026-08-16-managed-chrome-bootstrap-target-lifecycle` | `completed` | Own the current-generation managed Chrome bootstrap target by exact CDP identity and retire only that target after provider verification. | `docs/change-intents/2026-08-16-managed-chrome-bootstrap-target-lifecycle.md` |

| `2026-08-16-r3-preload-recovery-ordering` | `completed` | Route relay start through BrowserSessionAuthority so unresolved local recovery is visible before provider-readiness failure without allowing WAITING. | `docs/change-intents/2026-08-16-r3-preload-recovery-ordering.md` |

| `2026-08-17-innosetup-installer-packaging` | `in_progress` | Package the Access Browser Agent Electron application into a distributable Windows setup via `electron-builder` output compiled with Inno Setup, and record install-smoke runtime evidence against the canonical R4 branch. | `docs/change-intents/2026-08-17-innosetup-installer-packaging.md` |
| `2026-08-19-chain-break-audit-negative-context` | `completed` | Restore the `chain-break-audit.js` router-unreachability check so a `doesNotMatch(...)` absence-assertion is not blanket-allowlisted but distinguished structurally as evidence for unreachability. | `docs/change-intents/2026-08-19-chain-break-audit-negative-context.md` |
| `2026-08-22-local-ui-external-surface-removal` | `completed` | Remove external BirdEye/workspace-handoff UI surfaces and stale UI test contracts while preserving the local IDE, agent, provider, managed-browser, runtime, editor, terminal, and MCP surfaces. | `docs/change-intents/2026-08-22-local-ui-external-surface-removal.md` |
| `2026-08-22-monitor-aware-layout-reconciliation` | `completed` | Reconcile persisted IDE pane dimensions when the window moves across displays or its viewport/device scale changes. | `docs/change-intents/2026-08-22-monitor-aware-layout-reconciliation.md` |
| `2026-08-22-cline-provider-store-import` | `in_progress` | Reuse an existing Cline login from the standard local provider store without exposing or mutating that store. | `docs/change-intents/2026-08-22-cline-provider-store-import.md` |
| `2026-08-22-cline-live-readiness` | `completed` | Record authenticated live Cline completion, tool-calling, and structured-output readiness. | `docs/change-intents/2026-08-22-cline-live-readiness.md` |
| `2026-08-22-browser-isolation-ax-hardening` | `completed` | Isolate general browser tabs in an Access-owned CDP context and expose bounded AX snapshot evidence. | `docs/change-intents/2026-08-22-browser-isolation-ax-hardening.md` |
| `2026-08-22-agent-recovery-boundary` | `completed` | Fail closed after process restart when an execution step has no durable terminal outcome, requiring explicit reconciliation before new work. | `docs/change-intents/2026-08-22-agent-recovery-boundary.md` |
| `2026-08-22-general-browser-process-isolation` | `completed` | Give general agent browsing an Access-owned browser process/profile separate from the persistent provider relay browser. | `docs/change-intents/2026-08-22-general-browser-process-isolation.md` |
| `2026-08-22-browser-screenshot-storage` | `completed` | Keep opt-in browser screenshots and define their default app-owned storage location with correlated evidence metadata. | `docs/change-intents/2026-08-22-browser-screenshot-storage.md` |

## Status values

- `in_progress` — mutation may proceed only for targets authorized by the matching active intent document.
- `completed` — implementation is closed and the intent document contains post-change outcome and validation evidence.
- `blocked` — the documented change may not authorize further ordinary mutation until its blocker is resolved and recorded.

## Hard rule

Multiple changes may be `in_progress` concurrently. Ordinary file create/write/patch operations are authorized only when the requested target is declared by one matching active change. If more than one active change declares the same target, the mutation must identify its `changeId` explicitly. Governed command execution must identify `changeId` when multiple active changes exist because command side effects are not safely inferable from shell text alone.

The governance bootstrap is deliberately narrower: `docs/CHANGE_INDEX.md` and `docs/change-intents/*.md` may be created or updated so the next change can be declared before ordinary mutation. That bootstrap does not authorize unrelated workspace files or commands.
