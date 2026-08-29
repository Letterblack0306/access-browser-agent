# Agent Ownership Inversion — Architecture Plan

**Status:** PLANNED (post P0–P2 stability fixes)
**Priority:** Next major architectural milestone
**Date:** 2026-08-29

---

## Problem Statement

The current architecture follows a **"machine executes, agent observes"** pattern:

| Current Behavior | Ownership |
|:---|:---|
| Tools run as autonomous machine tasks | Machine owns execution |
| Guards (CHANGE_INDEX) block mutations machine-side | Machine owns policy |
| Agent sees only final tool result | Machine owns observability |
| Timeout/retries set by constructor params | Machine owns boundaries |
| State projected by `reduceSessionEvent` | Machine owns state |

The agent is a **passenger** — it decides *what* to call but has no authority over *how* execution proceeds, *when* it terminates, or *whether* governance allows it.

## Target Architecture

**"Agent owns, machine executes on behalf."**

| Target Behavior | Ownership |
|:---|:---|
| Agent declares execution parameters per tool call | Agent owns boundaries |

---

## Phase A — Agent-Declared Execution Boundaries

### Current State
```
// AgentExecutive.js — machine sets retries
constructor({ maxRetries = 2, retryDelayMs = 500 })

// LiveAgentCore.js — machine sets timeout
const timeoutMs = Number(stepContext.timeoutMs) || 300_000;

// GovernedTerminal.js — machine hardcodes command timeout
const MAX_TIMEOUT_MS = 30_000;
```

### Target
The agent's tool call arguments include execution parameters:
```json
{
  "name": "runCommand",
  "arguments": {
    "command": "npm run check",
    "_execution": {
      "timeoutMs": 60000,
      "maxRetries": 1,
      "retryDelayMs": 1000
    }
  }
}
```

### Implementation

**File: `src/agent/ToolRegistry.js`**
- Extract `_execution` from tool arguments before passing to tool
- Validate against machine-enforced upper bounds:
  - `timeoutMs` capped at 300_000 (5 min)
  - `maxRetries` capped at 5
  - `retryDelayMs` capped at 10_000
- Pass validated bounds into tool execution context

**File: `src/agent/executive/LiveAgentCore.js`**
- Read `_execution.timeoutMs` from each tool call
- Create per-call AbortController with agent-declared timeout
- Machine cap remains as absolute ceiling (agent can lower, never exceed)

**File: `src/system/governed-terminal.js`**
- Accept `timeoutMs` parameter in `execute()` (currently hardcoded 30s)
- Validate: `Math.min(agentTimeout, MAX_TIMEOUT_MS)`


---

## Phase B — Tool Progress Streaming

### Current State
```js
// LiveAgentCore.js — agent only sees final result
result = await this.registry.execute(call.name, call.arguments, ctx);
// ... agent gets `result` as a single tool message
```

### Target
Tools emit progress events during execution. The agent receives them as
intermediate observations in its conversation, enabling real-time awareness.

### Implementation

**New File: `src/agent/ToolProgressChannel.js`**
```js
class ToolProgressChannel {
  constructor({ toolCallId, onProgress, maxEvents = 20 }) { ... }
  emit(stage, data) { /* bounded, deduplicated progress events */ }
  complete(result) { /* final result */ }
}
```

**File: `src/agent/ToolRegistry.js`**
- Accept optional `onProgress` callback in execution context
- Pass `ToolProgressChannel` instance to tool execute functions
- Tools that support streaming call `progress.emit('downloading', { pct: 45 })`

**File: `src/agent/executive/LiveAgentCore.js`**
- Create `ToolProgressChannel` per tool call
- `onProgress` handler appends progress as a `tool` message with
  `"[PROGRESS]"` prefix (not a full tool result)
- Agent sees: `[PROGRESS] runCommand: executing npm run check (3.2s elapsed)`
- Final result still arrives as the authoritative tool response

**File: `src/agent/tools/_tool.js`**
- Add `streaming: true` flag to tool declarations that support progress
- Tool execute signature becomes: `execute(ctx, args, progress?)`

### Progress Event Contract
```json
{

---

## Phase C — Governance as Agent Consultation

### Current State
```js
// ToolRegistry.js — machine hard-blocks
new ChangeGovernanceGuard({ workspaceRoot }).assertMutation({ toolName, args });
// → throws → returns { observation: 'BLOCKED' } to agent
// Agent has NO say. Machine decided.
```

### Target
Governance presents its findings to the agent as a **consultation**.
The agent reasons about the governance state and decides:
- **Proceed** (with explicit acknowledgment)
- **Create the missing intent** (self-remediate)
- **Abort** (respect the boundary)

Machine still enforces **hard safety caps** (path escape, shell injection,
destructive operations) — these are non-negotiable. But **policy governance**
(CHANGE_INDEX, intent documents) becomes agent-consulted.

### Implementation

**File: `src/agent/ToolRegistry.js`**
- Replace hard-block with consultation result:
```js
if (GOVERNED_MUTATIONS.has(tool.actionKind)) {
  const consultation = new ChangeGovernanceGuard({ workspaceRoot })
    .consult({ toolName: name, args: args || {} });
  if (!consultation.ok) {
    return {
      ok: false,
      output: {
        ok: false,
        observation: 'GOVERNANCE_CONSULTATION',
        consultation: {
          code: consultation.code,
          message: consultation.message,
          requiredAction: consultation.requiredAction,
          agentOptions: ['create_intent', 'proceed_with_acknowledgment', 'abort'],
        },
      },
      evidence: { verified: false, governance: true },
    };
  }
}
```

**File: `src/agent/guards/ChangeGovernanceGuard.js`**
- Add `consult()` method alongside existing `assertMutation()`
- `consult()` returns structured findings without throwing
- Includes `requiredAction` describing what the agent must do to proceed

**File: `src/agent/executive/LiveAgentCore.js`**
- When agent receives `GOVERNANCE_CONSULTATION`, it can:
  1. Call `createFile` to write the change intent document
  2. Call the mutation again with `_governance: { acknowledged: true, changeId: "..." }`
  3. Choose to abort and report the blocker

**File: `src/agent/ToolRegistry.js`**
- On re-execution with `_governance.acknowledged === true`:
  - Validate the agent actually created the intent (re-run `consult()`)
  - If valid → proceed with execution
  - If still invalid → return consultation again (agent lied or failed)


---

## Phase D — Agent-Owned State

### Current State
```js
// AgentExecutive.js — machine projects state from events
this.state = projectSession([event], this.state);

// AgentSessionState.js — machine-owned reducer
case 'objective.completed': state.status = 'completed'; break;
case 'objective.failed': state.status = 'failed'; break;
```

The agent's step result is *interpreted* by the machine into state transitions.
The agent says `{ status: 'completed' }` but the machine decides what that means.

### Target
The agent **declares** its state transitions explicitly. The machine:
1. Validates the declaration is legal (no invalid transitions)
2. Persists it to the event log
3. Projects it into the session state

The agent is the **authority** on its own state. The machine is the **registrar**.

### Implementation

**New Tool: `declareState`**
```js
tool('declareState',
  'Declare your current execution state. You own your state transitions.',
  {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['completed', 'failed', 'blocked',
        'waiting_for_input', 'waiting_for_dependency', 'timed_out'] },
      summary: { type: 'string' },
      evidence: { type: 'array', items: { type: 'object' } },
      reason: { type: 'string' },
    },
    required: ['status', 'summary'],
    additionalProperties: false,
  },
  null,
  async (ctx, args) => {
    return { ok: true, declaredStatus: args.status, persisted: true };
  }
);
```

**File: `src/agent/executive/LiveAgentCore.js`**
- When agent calls `declareState`, the step returns the declared status
- Machine no longer infers terminal state from tool results
- Agent explicitly says "I am done" or "I am blocked"

**File: `src/agent/executive/AgentExecutive.js`**
- `_runLoop` respects agent-declared state from `declareState` tool
- Machine still enforces: no transition from terminal → active
- Machine still enforces: recovery boundary (crash detection)

---

## Implementation Order

| Phase | Scope | Risk | Depends On |
|:---|:---|:---|:---|
| **A** | Agent-declared boundaries | Low | P0 timeout fix (landed) |
| **B** | Progress streaming | Medium | Phase A (per-call timeout) |
| **C** | Governance consultation | Medium | Phase A (agent can self-remediate) |
| **D** | Agent-owned state | Medium | Phase C (agent declares blockers) |

### Recommended Sequence
1. **Phase A first** — smallest change, immediate agent empowerment
2. **Phase C second** — unblocks agent self-remediation for governance
3. **Phase B third** — observability improvement, lower urgency
4. **Phase D last** — largest semantic shift, benefits from A+C being stable

---

## Invariants That Must Hold

Regardless of ownership inversion:

1. **Machine enforces hard safety caps** — agent cannot exceed timeout/retry ceilings
2. **Machine enforces path containment** — no workspace escape regardless of agent consent
3. **Machine enforces terminal immutability** — no transition out of terminal states
4. **Machine enforces crash recovery** — recovery boundary is non-negotiable
5. **Machine enforces event ordering** — sequential write queue remains authoritative
6. **Agent declarations are validated** — illegal transitions are rejected with evidence
7. **No silent failure** — every rejection is observable to the agent

---

## Files Modified (Summary)

| File | Phase | Change |
|:---|:---|:---|
| `src/agent/ToolRegistry.js` | A, C | Extract `_execution`, governance consultation |
| `src/agent/executive/LiveAgentCore.js` | A, B, C, D | Per-call timeout, progress channel, declareState |
| `src/agent/executive/AgentExecutive.js` | A, D | Agent-declared retries, state declarations |
| `src/agent/executive/AgentSessionState.js` | D | `agent.state_declared` event type |
| `src/agent/guards/ChangeGovernanceGuard.js` | C | `consult()` method |
| `src/agent/tools/_tool.js` | B | `streaming` flag, progress param |
| `src/system/governed-terminal.js` | A | Accept `timeoutMs` param |
| **NEW** `src/agent/ToolProgressChannel.js` | B | Progress event channel |
| **NEW** `src/agent/tools/declareState.js` | D | State declaration tool |

---

## Acceptance Criteria

- [ ] Agent can set `timeoutMs` per tool call (capped at 300s)
- [ ] Agent can set `maxRetries` per tool call (capped at 5)
- [ ] Agent receives progress events during long-running tools
- [ ] Governance blocks return consultation, not hard failure
- [ ] Agent can self-remediate governance (create intent, retry)
- [ ] Agent can declare its own terminal state via `declareState`
- [ ] Machine rejects illegal state transitions with evidence
- [ ] Hard safety caps remain non-overridable
- [ ] All existing smoke tests pass without modification
- [ ] New smoke tests cover each phase's contract


**File: `src/agent/executive/AgentSessionState.js`**
- Add `agent.state_declared` event type
- Reducer processes agent declarations as authoritative
- Machine-inferred transitions become fallback only

### Transition Validation Rules (Machine-Enforced)
```
idle → running          (agent starts work)
running → completed     (agent declares done)
running → failed        (agent declares failure)
running → blocked       (agent declares blocker)
running → waiting_*     (agent needs external input)
running → timed_out     (machine-enforced, non-overridable)
* → stopped/cancelled   (user action, non-overridable)
terminal → *            (FORBIDDEN — machine rejects)
```

### Backward Compatibility
- If agent doesn't call `declareState`, machine falls back to current inference
- Existing step results (`{ status: 'completed' }`) still work as implicit declarations
- `declareState` is additive, not breaking

### Hard Safety (Non-Negotiable, Machine-Enforced)
These remain machine-blocked regardless of agent consent:
- Path escape outside workspace root
- Shell operator injection (`|`, `>`, `&`, etc.)
- Denied executables (`cmd.exe`, `powershell`, `bash`, etc.)
- Credential exposure in URLs
- Irreversible destructive operations without explicit objective authorization

### Agent-Consulted (Policy Governance)
These become agent decisions:
- CHANGE_INDEX existence and content
- Change intent document completeness
- Target file declaration in active intents
- Post-change update and validation evidence

  "toolCallId": "call_abc123",
  "stage": "executing",
  "elapsedMs": 3200,
  "detail": "npm run check — 12/47 checks passed",
  "pct": 25
}
```

### Bounding Rules
- Max 20 progress events per tool call (prevents context flooding)
- Min 500ms between events (debounce)
- Progress events are observational only — agent cannot act on them mid-execution
- If agent wants to abort, it uses the existing stop mechanism

**File: `src/agent/executive/AgentExecutive.js`**
- Read agent-declared `maxRetries` from step result
- Machine cap remains: `Math.min(agentRetries, MAX_MACHINE_RETRIES)`

### Schema Addition
Add to tool schemas:
```json
"_execution": {
  "type": "object",
  "description": "Agent-declared execution boundaries for this call",
  "properties": {
    "timeoutMs": { "type": "integer", "minimum": 1000, "maximum": 300000 },
    "maxRetries": { "type": "integer", "minimum": 0, "maximum": 5 },
    "retryDelayMs": { "type": "integer", "minimum": 0, "maximum": 10000 }
  },
  "additionalProperties": false
}
```

| Agent receives streaming progress during execution | Agent owns observability |
| Governance presents consultation, agent decides | Agent owns policy consent |
| Agent declares its own state transitions | Agent owns state |
| Machine persists, validates, and enforces hard safety caps | Machine is the executor |
