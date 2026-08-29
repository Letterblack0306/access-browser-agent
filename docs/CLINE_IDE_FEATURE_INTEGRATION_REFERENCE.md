# Cline IDE Feature Integration Reference

**Date:** 2026-08-29
**Source:** https://cline.bot/ide + https://docs.cline.bot + https://github.com/cline/cline
**Purpose:** Identify Cline IDE features worth integrating into Access Browser Agent

---

## Feature Comparison Matrix

| Cline Feature | Browser Agent Status | Integration Value | Priority |
|:---|:---|:---|:---|
| Plan / Act Mode | ❌ Not implemented | 🔴 HIGH | P1 |
| Checkpoints (shadow git rollback) | ⚠️ PARTIALLY IMPLEMENTED | 🔴 HIGH | P1 (partial) |
| @ Mentions (context injection) | ❌ Not implemented | 🟡 MEDIUM | P2 |
| Hooks (tool-call gates) | ⚠️ Partial (governance guard) | 🟡 MEDIUM | P2 |
| Skills (reusable expertise) | ✅ Implemented | — | — |
| MCP Tools | ✅ Implemented | — | — |
| Terminal + Browser | ✅ Implemented | — | — |
| Multi-Agent Teams | ❌ Not implemented | 🟡 MEDIUM | P3 |
| Scheduled Agents | ❌ Not implemented | 🟢 LOW | P4 |
| Headless CLI | ❌ Not implemented | 🟢 LOW | P4 |
| Visual Diffs | ❌ Not implemented | 🟡 MEDIUM | P2 |
| Different models per mode | ❌ Not implemented | 🟡 MEDIUM | P2 |
| Kanban (parallel agents) | ❌ Not implemented | 🟢 LOW | P4 |

---

## P1 — HIGH VALUE INTEGRATIONS

### 1. Plan / Act Mode

**What Cline does:**
- **Plan mode**: Agent can READ files, search, discuss strategy — but CANNOT modify files or run commands
- **Act mode**: Agent retains full planning context and CAN modify files, run commands, execute
- Toggle between modes; conversation history carries over
- Different models can be used per mode (strong reasoning for plan, fast for act)
- `/deep-planning` command for complex multi-file tasks

**Why it matters for Browser Agent:**
- Currently the agent operates in a single mode — it can read AND write in the same turn
- The Agent Ownership Inversion plan (Phase C) already proposes governance consultation
- Plan/Act is a natural complement: agent declares "I'm planning" vs "I'm executing"
- Prevents accidental mutations during exploration
- Enables the user to approve the strategy before execution begins

**Integration approach:**
```
New tool: `declareMode`
  - status: 'plan' | 'act'
  - In 'plan' mode: ToolRegistry blocks GOVERNED_MUTATIONS
  - In 'act' mode: ToolRegistry allows all tools
  - Mode is agent-declared (fits ownership inversion)
  - Machine enforces: plan mode cannot mutate

UI addition:
  - Mode toggle in the Task view header
  - Visual indicator: "Planning" (blue) vs "Executing" (green)
  - Agent can switch modes via declareMode tool call
```

**Files to modify:**
- `src/agent/executive/LiveAgentCore.js` — mode awareness in step loop
- `src/agent/ToolRegistry.js` — block mutations in plan mode
- `electron/rebuild-renderer.js` — mode indicator UI
- `electron/index.html` — mode toggle element

---

### 2. Checkpoints (Shadow Git Rollback)

**What Cline does:**
- Maintains a **shadow Git repository** separate from project's actual Git history
- After EACH tool use (file edit, command), commits current file state to shadow repo
- Project's real Git history stays untouched
- Three restore options:
  - **Restore Files** — revert files, keep conversation
  - **Restore Task Only** — delete messages after checkpoint, keep files
  - **Restore Files & Task** — revert both
- Visual diff comparison at each checkpoint
- Makes auto-approve safe (roll back if something goes wrong)

**Why it matters for Browser Agent:**
- Currently the agent has NO rollback capability
- If the agent writes a bad file, the user must manually fix it
- The event store already tracks all actions — checkpoints would add file-state snapshots
- Fits perfectly with the existing `AgentEventStore.checkpoint()` mechanism
- Enables "experiment freely, roll back if needed" workflow

**Integration approach:**
```
New module: src/system/workspace-checkpoint-authority.js
  - Uses a shadow git repo in .gpt-sync/checkpoints/
  - After each mutation tool (writeFile, applyPatch, createFile, runCommand):
    → git add -A && git commit -m "checkpoint:stepId:toolName"
  - Checkpoint ID linked to stepId in event store
  - Restore: git checkout <checkpoint-sha> -- .

New tool: `restoreCheckpoint`
  - checkpointId: string
  - mode: 'files' | 'task' | 'files_and_task'
  - Agent can declare "I want to roll back to checkpoint X"

UI addition:
  - Checkpoint indicators in execution trace
  - "Compare" button → shows diff in editor view
  - "Restore" button → triggers restoreCheckpoint

**Status (2026-08-29):** ⚠️ PARTIALLY IMPLEMENTED — not "✅ Implemented" as the summary table previously claimed.

Working pieces (verified):
- `src/system/workspace-checkpoint-authority.js` correctly creates shadow git commits on `commit()` using the `checkpoint:<id>:<toolName>` subject marker.
- `list()` returns the checkpoints stored in the shadow repo.
- The smoke test `test/workspace-checkpoint-authority-smoke.js` (now wired into `npm run check:workspace-checkpoint-authority`) validates create + list.

Known blockers (P1 follow-up before this can be marked "✅ Implemented"):
1. **Restore path was broken.** The original `_resolveCheckpoint` used `git rev-parse cp-...^{commit}` on a human-readable ID, which git cannot resolve. Fixed 2026-08-29 by searching `git log --all --format=%H|%s` for the `checkpoint:<id>:` marker and verifying the candidate with `git rev-parse`. (Regression test now in smoke file.)
2. **`restoreCheckpoint` tool was not registered.** `WorkspaceCheckpointAuthority` was instantiated by `LiveToolContext` but no tool entry exposed its `restore({checkpointId})` method. Fixed 2026-08-29: `restoreCheckpoint` and `listCheckpoints` tools are now registered in `LiveToolContext.declaredTools`.
3. **Restore mode semantics not implemented.** Cline offers three modes (files / task / files_and_task). The current `restore()` only reverts files. The "task only" and "files_and_task" branches need explicit event-truncation logic tied to `AgentEventStore` before this row can be flipped to "✅ Implemented".

---

## P2 — MEDIUM VALUE INTEGRATIONS

### 3. @ Mentions (Context Injection)

**What Cline does:**
- User types `@filename` to bring a file into conversation context
- Supports: files, folders, problems, git diffs
- Agent reads what you point at — no copy-pasting needed

**Integration approach:**
- In the Browser Agent's instruction input, support `@path` syntax
- Before sending to LLM, resolve @mentions to file contents
- Inject as context in the system prompt or user message
- UI: autocomplete dropdown when user types `@`

### 4. Hooks (Tool-Call Gates)

**What Cline does:**
- Scripts that run BEFORE or AFTER any tool call
- Can gate (block), shape (modify args), or audit (log) tool calls
- Configured per-project in `.cline/hooks/`

**Integration approach:**
- The Browser Agent already has `ChangeGovernanceGuard` as a machine-enforced gate
- The Agent Ownership Inversion (Phase C) converts this to agent consultation
- Hooks would add user-defined scripts as additional gates
- Location: `.gpt-sync/hooks/` with `pre-tool.js` and `post-tool.js`
- ToolRegistry calls hooks before/after execution

### 5. Visual Diffs

**What Cline does:**
- After each file modification, shows a visual diff in the editor
- User can see additions, deletions, modifications

**Integration approach:**
- The Browser Agent already has an Editor view with file content
- Add diff rendering: when agent writes a file, show before/after
- Use the `beforeSha256` already returned by writeFile/applyPatch
- Render inline diff in the editor view

### 6. Different Models Per Mode

**What Cline does:**
- Configure separate models for Plan and Act modes
- Stronger reasoning model for planning, faster model for execution

**Integration approach:**
- Add `planModel` and `actModel` to preferences
- When mode switches, swap the active provider model
- Settings UI: two model selects (one per mode)

---

## P3 — FUTURE INTEGRATIONS

### 7. Multi-Agent Teams

**What Cline does:**
- Coordinator agent breaks work into subtasks
- Delegates to specialist agents with own tools/context
- Team state persists across sessions

**Integration approach:**
- The Browser Agent's `AgentSessionRuntime` already supports multiple sessions
- Extend to support a coordinator session that spawns worker sessions
- Each worker gets its own `AgentExecutive` instance
- Coordinator aggregates results

### 8. Plugin System (SDK)

**What Cline does:**
- Register tools and lifecycle hooks programmatically
- `createTool({ name, description, inputSchema, execute })`
- Plugins for logging, auditing, policy enforcement

**Integration approach:**
- The Browser Agent's `ToolRegistry` already supports dynamic registration
- Add a plugin loader that reads `.gpt-sync/plugins/*.js`
- Each plugin exports tools to register + hooks to install
- Fits the Agent Ownership Inversion (agent can discover plugins)

---

## P4 — LOW PRIORITY (Nice-to-have)

| Feature | Notes |
|:---|:---|
| Scheduled Agents | Cron-based automation; useful for periodic workspace health checks |
| Headless CLI | Run agent without Electron UI; useful for CI/CD integration |
| Kanban | Parallel agent task board; requires significant UI work |
| Messaging Connectors | Telegram/Slack/Discord; useful for remote agent interaction |

---

## Recommended Implementation Order

```
Phase 1 (immediate):  Plan/Act Mode + Checkpoints
Phase 2 (next):       @ Mentions + Visual Diffs + Hooks
Phase 3 (later):      Multi-Agent Teams + Plugin System
Phase 4 (future):     Scheduled Agents + Headless CLI + Kanban
```

---

## Key Architectural Insight

Cline's most powerful pattern is **separating thinking from doing** (Plan/Act)
combined with **safe rollback** (Checkpoints). Together they create a workflow where:

1. Agent explores freely in Plan mode (no risk)
2. User approves the strategy
3. Agent executes in Act mode with checkpoints
4. If something goes wrong → instant rollback
5. Cost of a mistake drops to nearly zero

This maps directly to the Browser Agent's **Agent Ownership Inversion** plan:
- Plan/Act = Phase D (agent declares its own mode)
- Checkpoints = Phase A (agent-declared boundaries with machine persistence)
- Hooks = Phase C (governance as consultation, not hard-block)

The two architectures are complementary. Implementing Plan/Act + Checkpoints
would complete the "agent owns, machine executes on behalf" vision.

```

**Files to create/modify:**
- **NEW** `src/system/workspace-checkpoint-authority.js`
- `src/agent/executive/LiveAgentCore.js` — emit checkpoint after mutations
- `src/agent/executive/LiveToolContext.js` — register restoreCheckpoint tool
- `electron/rebuild-renderer.js` — checkpoint UI in execution trace
- `electron/index.html` — checkpoint controls

| Messaging Connectors | ❌ Not implemented | 🟢 LOW | P4 |
| Plugin System (SDK) | ⚠️ Partial (ToolRegistry) | 🟡 MEDIUM | P3 |
