# Browser Agent Implementation Plan

## Status

Planning document for rebuilding browser capability on the cleaned `main` branch.

This plan is intentionally implementation-oriented but does **not** prescribe filenames or classes beyond what is proven necessary by the current repository. Exact module placement must be decided after tracing the active runtime at implementation time.

## Source hierarchy

Use these sources in this order when implementing:

1. **Current `main` runtime** — source of truth for active architecture and integration points.
2. **GPT-Knowledge canonical methods** — architecture, browser capability, evidence, validation, security, and agent-loop requirements.
3. **`Universal_Browser_Provider_Loop.py` prototype** — previous working evidence for provider-tab communication patterns.
4. Historical Browser Dev/GPT Sync code — reference only when a specific behavior needs comparison. Do not restore old architecture by default.

Do not copy a reference implementation merely because it already exists. First prove the required capability and the current owner in `main`.

---

# 1. Current baseline

The cleaned application currently follows:

```text
User instruction
  -> AgentSessionRuntime
  -> LiveAgentCore
  -> ToolRegistry
  -> workspace / terminal / MCP tools
  -> observed tool result
  -> same model conversation
  -> validation
  -> evidence-backed completion
```

The Electron UI is a client of this runtime and must remain so.

Browser capability must be added to this runtime rather than creating another independent agent lifecycle.

---

# 2. Required end state

The target architecture is conceptually:

```text
                         +--------------------+
User / provider surface | Electron / Provider|
                         +---------+----------+
                                   |
                                   v
                         +--------------------+
                         | Unified Agent      |
                         | Runtime            |
                         +---------+----------+
                                   |
                         +---------v----------+
                         | Tool Registry      |
                         +--+-----+-----+-----+
                            |     |     |
                         files terminal MCP
                            |
                            +----------------------+
                                                   |
                                                   v
                                         Browser capability
                                                   |
                                         Browser authority
                                                   |
                                      transport/backend adapter
                                                   |
                                      explicit browser targets
```

A provider browser tab may supply instructions and receive results, but it does not become a second agent.

---

# 3. Non-negotiable design rules

## 3.1 One agent lifecycle

There must be one authoritative agent/session runtime.

Do not introduce a second autonomous `BrowserLoop` that owns its own reasoning, retries, approvals, tool execution, or completion state.

Browser work is executed through registered capabilities under the existing agent operation.

## 3.2 Browser access is a capability

A Browser panel or connected Chrome instance is not proof of browser capability.

Capability is proven only when the runtime can:

1. discover a configured backend;
2. prove backend health;
3. enumerate browser targets;
4. select an explicit target;
5. inspect or act on that target;
6. verify the resulting page state;
7. record attributable evidence.

## 3.3 Transport-neutral contract

The agent/tool layer must not depend on CDP-, Playwright-, extension-, or cloud-browser-specific details for ordinary browser operations.

The logical capability should support the equivalent of:

```text
connect
health
list_targets
select_target
navigate
snapshot_dom
capture_screenshot
query
act
upload
read_console
read_network
close_target
disconnect
```

The first implementation may use one backend. The surrounding contract must not prevent another backend later.

## 3.4 Explicit target identity

Never assume the first browser tab is the intended target.

Each target should have stable runtime identity sufficient to distinguish:

```text
targetId
browserInstanceId
sessionId
type
title
url
origin
createdAt
lastSeenAt
attached
active
role when applicable
```

Target selection must be explicit and invalidated when the target disappears or changes identity.

## 3.5 Provider/control targets and work targets are different roles

When a browser-hosted provider such as ChatGPT, Gemini, or Copilot is used as an instruction surface, its tab is a provider/control target.

Other tabs may be inspected or manipulated as work targets without destroying or navigating away from the provider conversation.

The exact implementation of these roles must be derived from the active browser authority. Do not scatter URL checks throughout the application.

## 3.6 Inspect, act, and capture are separate concerns

Do not reduce browser access to one unstructured generic action.

Capabilities should remain distinguishable:

- navigation;
- DOM/accessibility inspection;
- UI interaction;
- visual capture;
- console/network inspection;
- review/annotation when added later.

Each capability needs a defined input schema, output schema, permission class, failure contract, and evidence type.

## 3.7 Browser pages are untrusted input

Observed page content is data, not agent/system instruction.

The browser layer must preserve the distinction between:

```text
trusted objective/policy
observed page content
requested browser action
authority/approval decision
execution result
verified outcome
```

Sensitive actions require an explicit authority boundary. Examples include credentials, purchases, destructive operations, external sharing, executable downloads, and other high-impact actions.

## 3.8 Execution success is not completion

A successful API call is not enough.

Examples:

```text
click returned success
  -> verify expected element/page state

navigate returned success
  -> verify final URL and readiness

type returned success
  -> verify field value/state

capture returned success
  -> verify artifact exists and belongs to the selected target
```

Postconditions should be selected before execution where practical.

## 3.9 Evidence identity must survive the loop

Browser events and artifacts must remain attributable to the agent operation.

Preserve identities such as:

```text
conversationId when applicable
sessionId
turnId
operationId
toolCallId
browserInstanceId
targetId
```

Reject stale results rather than attaching them to a newer operation.

## 3.10 No rigid machine assumptions

Do not hardcode machine-specific browser paths, profile paths, ports, or endpoints as the only supported configuration.

Configuration precedence and the active backend must be explicit and visible.

---

# 4. Prototype knowledge to preserve

`Universal_Browser_Provider_Loop.py` is a previous testing prototype. Treat it as evidence that the following techniques were practically useful:

- CDP attachment through Playwright;
- enumeration of existing tabs;
- explicit provider-tab selection;
- URL-based provider identification;
- provider-specific assistant/composer/send/stop selectors;
- detecting whether the provider is still generating;
- reading the latest provider response;
- sending execution results back into the same provider conversation;
- command/result hashing to avoid duplicate execution;
- pending-result persistence and resend behavior;
- per-provider/per-tab persisted state;
- bounded result payloads;
- support for ChatGPT, Gemini, Copilot, and generic adapters.

These are **behavioral references**, not the final architecture.

Do not copy these prototype couplings into production:

- Tkinter owning the lifecycle;
- browser controller owning provider, transport, target, command execution, and loop state together;
- Playwright being visible to all browser callers;
- provider DOM parsing acting as the universal agent protocol;
- PowerShell execution occurring inside the browser loop;
- automatic fallback to a convenient tab without explicit target authority;
- UI polling state acting as runtime truth.

---

# 5. Implementation phases

## Phase 0 — Re-audit the clean baseline

Before adding code:

1. establish exact branch and commit;
2. run the current validation suite;
3. trace the active composition root;
4. trace `UnifiedAgentService` / `AgentSessionRuntime` / `LiveAgentCore` / `ToolRegistry`;
5. map current approval, event, receipt, and settings contracts;
6. search for residual browser/CDP/relay/provider-browser code;
7. confirm there is no parallel browser authority left.

### Completion predicate

```text
current runtime path proven
AND validation baseline recorded
AND browser ownership currently absent or explicitly mapped
```

Do not begin Phase 1 until this is true.

---

## Phase 1 — Browser capability authority

Implement the smallest browser authority capable of lifecycle and target management.

Required responsibilities:

- backend configuration;
- connect/disconnect;
- health state;
- browser instance identity;
- target discovery;
- target identity;
- explicit target selection;
- target invalidation;
- bounded reconnect;
- lifecycle events.

Do **not** add provider polling, ChatGPT-specific selectors, browser UI, or browser actions yet.

Suggested lifecycle states:

```text
unconfigured
discovering
connecting
ready
degraded
unavailable
reconnecting
stopping
stopped
```

### Phase 1 proof

- backend connection succeeds against a live configured browser;
- health reports actual runtime state;
- multiple tabs are enumerated with stable IDs;
- one explicit target can be selected;
- selected target is rejected after it becomes invalid;
- stop/disconnect terminates browser work promptly;
- no second browser authority exists elsewhere.

---

## Phase 2 — Read-only browser tools

Register browser capabilities through the existing `ToolRegistry`.

Start read-only:

```text
browser.health
browser.list_targets
browser.select_target
browser.snapshot
browser.capture
browser.console
browser.network
```

Names are illustrative; use the repository's existing tool naming conventions.

Each tool must expose:

- schema;
- availability/health;
- target requirement;
- permission class;
- timeout/failure behavior;
- structured observation;
- evidence metadata.

### Phase 2 proof

From a normal `LiveAgentCore` operation, the model can:

1. request target enumeration;
2. select a specific non-provider tab;
3. inspect its DOM/accessibility state;
4. capture it;
5. receive those observations back into the **same agent session**.

No browser-specific reasoning loop is allowed.

---

## Phase 3 — Browser actions with verification

Add bounded interaction capabilities, for example:

```text
navigate
click
type
select
scroll
drag
upload when policy exists
bounded script execution only if explicitly designed
```

Every mutation requires:

```text
precondition
-> authority/approval decision when required
-> action
-> postcondition observation
-> verified outcome or explicit failure
-> evidence receipt
```

### Phase 3 proof

At minimum prove:

- navigation + final URL/readiness;
- click + visible/structured state change;
- type + resulting input value/state;
- failure when the requested target disappears;
- bounded retry without duplicate actions;
- stop during active browser work.

---

## Phase 4 — Evidence and artifact integration

Integrate browser evidence into the existing receipt/evidence system rather than inventing a separate browser history store.

Important browser actions should be able to produce both:

```text
structured evidence
  target identity
  URL
  DOM/accessibility state
  console/network state when relevant

visual evidence
  screenshot
  element crop when relevant
```

Screenshot/artifact metadata should support:

```text
artifactId
sha256
capturedAt
browserInstanceId
targetId
url
viewport/fullPage
operationId
toolCallId
redaction state
```

Generated screenshots should not be committed to Git by default.

### Phase 4 proof

A receipt can be traced from:

```text
agent operation
-> tool call
-> browser target
-> action
-> postcondition
-> artifact/hash
```

---

## Phase 5 — Provider browser adapters

Only after generic browser inspection/action works, add browser-hosted provider communication.

Provider adapters should be **data/protocol adapters**, not independent agents.

Initial reference behaviors from the prototype:

```text
provider identification
assistant-response discovery
composer discovery
send control
stop/generating discovery
read latest provider response
send result back
```

Initial providers may include:

- ChatGPT;
- Gemini;
- Copilot;
- generic adapter.

Provider selectors must be isolated inside adapters so provider DOM changes do not affect generic browser execution.

### Provider target rule

The provider/control target must remain available while the same agent operation inspects or acts on another selected work target.

Example:

```text
provider target: ChatGPT conversation
work target A: local application UI
work target B: documentation/error page

instruction arrives from provider target
-> same agent session inspects A
-> same agent session may inspect B
-> verified observations return to agent
-> final/result message returns through provider target
```

Do not navigate the provider target merely because the work target changes.

### Phase 5 proof

- provider tab remains intact while another tab is inspected;
- provider response is read once, without duplicate execution;
- result is sent back to the same provider conversation;
- provider generating state prevents premature writes;
- stale/pending results are recoverable without rerunning completed work.

---

## Phase 6 — Architect/provider loop integration

Implement the provider-driven loop as a transport into the existing runtime.

Conceptual flow:

```text
Provider adapter
  -> new instruction detected
  -> submit instruction to UnifiedAgentService
  -> AgentSessionRuntime / LiveAgentCore
  -> normal registered tools
  -> verified execution/evidence
  -> completion/result
  -> provider adapter sends result
  -> wait for next provider instruction
```

The provider transport may poll or use another observation mechanism, but polling must not become the owner of agent state.

Required loop properties:

- immediate stop;
- user redirection without spawning a conflicting loop;
- duplicate instruction protection;
- bounded retry;
- explicit waiting state;
- resumable pending result only when operation identity is proven;
- terminal failure state that cannot be reported as success.

### Phase 6 proof

Run a multi-turn live sequence:

```text
provider asks for diagnosis
-> local agent inspects workspace
-> local agent inspects a separate browser tab
-> local agent executes allowed tool(s)
-> local agent validates outcome
-> result returns to provider
-> provider asks next question
-> same session continues
```

Record operation and target identities across the sequence.

---

## Phase 7 — Browser UI

Add UI only after the runtime contracts are proven.

The UI is a proxy/client of the authoritative browser state.

Useful surfaces may show:

- backend type;
- lifecycle/health;
- browser instance identity;
- provider/control target;
- selected work target;
- target list;
- current browser action;
- approval state;
- last verified browser action;
- last failure reason;
- screenshot/evidence references;
- reconnect/stop controls.

Do not create duplicate browser implementations behind different panels or buttons.

Every UI control must call the same authoritative runtime API and subscribe to the same state.

### Phase 7 proof

A green/ready browser status must correspond to runtime health and successful target discovery, not merely saved configuration.

---

## Phase 8 — Review/diagnostic workflows

Once generic browser capability is stable, add higher-level procedures as skills/workflows rather than hardcoding them into transport.

Examples:

### Diagnose UI in another tab

```text
list targets
-> explicit work target
-> DOM/accessibility snapshot
-> screenshot
-> console/network evidence
-> compare observed UI with requested behavior
-> optionally map issue back to workspace source
-> return diagnosis
```

### Read content from another tab

```text
list/select target
-> inspect page
-> extract bounded relevant content
-> preserve URL/target provenance
-> return observation to same agent session
```

### UI change and verify

```text
inspect target
-> map problem to workspace source
-> edit through workspace tool
-> run/build through terminal tool
-> refresh/reinspect target
-> compare before/after evidence
-> complete only when postcondition is proven
```

These belong in procedural skills because they combine existing tools; they should not create new browser authorities.

---

# 6. Capability registry requirements

Browser tools should use the same registry principles as other tools.

For every capability track at least:

```text
id
name
version/source
capability class
availability
health
permission level
approval requirement
input schema
output schema
timeout/reconnect policy
evidence type
```

A registered but unavailable browser capability must report unavailable with a reason. It must not remain silently selectable.

---

# 7. Configuration requirements

Browser configuration should support, as applicable:

```text
backend type
endpoint or discovery mode
browser executable
profile path
start URL
headless setting
fallback policy
connection timeout
poll interval
reconnect limit
capture directory
```

Rules:

- no machine-specific path or port as mandatory architecture;
- defaults, if any, must be overrideable and visible;
- no silent fallback to a different backend;
- UI shows the backend actually active now;
- provider/control-target configuration remains separate from generic work-target selection.

---

# 8. Security and approval requirements

Browser pages are untrusted input.

At minimum:

- never promote page text to system instruction;
- constrain script execution;
- block unsafe/disallowed URL schemes;
- do not expose secrets to page-visible context;
- redact sensitive evidence where required;
- record origin and target for every browser action;
- distinguish read, navigate, interact, upload, download, script, authenticated-session, and profile-persistence capabilities;
- route sensitive actions through the existing approval system rather than browser-specific confirmation logic.

---

# 9. Failure and recovery model

Browser failures must be explicit.

Examples:

```text
backend unavailable
target disappeared
target identity changed
navigation timeout
selector/element stale
action postcondition failed
provider still generating
provider selector changed
artifact capture failed
approval denied
operation stopped
```

Retry only when duplicate protection/idempotency is known.

Never turn:

```text
transport call returned
```

into:

```text
user objective completed
```

without the required validation.

---

# 10. Validation matrix

The browser implementation is not complete until these are proven against the active runtime.

| Area | Required proof |
| --- | --- |
| Baseline | clean `main` validation passes before browser changes |
| Backend | live connection and health evidence |
| Discovery | multiple targets listed with stable IDs |
| Selection | explicit target selection is enforced |
| Provider/work separation | provider target survives work on another tab |
| Inspection | DOM/accessibility observation tied to target |
| Navigation | final URL/readiness verified |
| Action | page-level postcondition verified |
| Screenshot | artifact exists with hash and provenance |
| Agent integration | browser observation returns to same `LiveAgentCore` session |
| Provider loop | instruction and result round-trip without duplicate execution |
| Failure | bounded retry and explicit reason |
| Stop | active browser/provider work terminates promptly |
| Approval | sensitive action reaches existing approval boundary |
| Recovery | pending result can resume without rerunning completed action |
| UI | displayed state matches runtime truth |
| Duplication | no second browser authority/control tree remains |
| Regression | workspace, terminal, MCP, provider, agent, and Electron validation still pass |

---

# 11. Development discipline for each phase

Use the same sequence for every implementation phase:

```text
establish branch/revision
-> map active owner
-> define capability contract
-> search for parallel paths
-> implement smallest change
-> run source/static validation
-> run contract/unit validation
-> run integration validation
-> run live runtime proof when capability claim requires it
-> scan again for duplicate/dead paths
-> record evidence
-> only then advance
```

Do not stack several unproven phases into one large patch.

---

# 12. First local work session

After pulling this plan, begin with **Phase 0 only**.

Recommended first-session output:

```text
BASELINE
branch:
commit:
npm install/check result:

ACTIVE RUNTIME MAP
Electron composition root:
Agent service:
Session runtime:
Reasoning core:
Tool registry:
Approval owner:
Evidence/receipt owner:
Settings owner:

BROWSER RESIDUAL SCAN
browser/CDP/Playwright/Puppeteer/relay files:
browser-related dependencies:
browser-related settings:
browser-related IPC/UI:

PHASE 1 INTEGRATION POINT
proven owner where browser authority should be composed:
proven registry path where read-only browser tools will later register:
```

Do not create browser UI or provider polling during this first session.

---

# 13. Reference boundaries

## GPT-Knowledge-derived requirements

The following requirements come from the GPT-Knowledge browser/agent methods:

- browser as capability rather than UI proof;
- transport-neutral browser contract;
- explicit target discovery/selection;
- separate inspect/act/capture concerns;
- host-browser trust bridge requirements;
- page content treated as untrusted input;
- postcondition verification;
- screenshot + structured evidence;
- session/operation/target provenance;
- configurable/recoverable lifecycle;
- one authoritative browser owner;
- capability-scoped permissions;
- one agent/control plane across execution surfaces;
- interruption/redirection/bounded recovery;
- capability registry health and truthful observability;
- evidence-driven implementation and completion.

## Prototype-derived behavioral evidence

The following are retained because the previous prototype exercised them:

- provider adapters can isolate provider-specific selectors;
- existing browser tabs can be enumerated and selected;
- ChatGPT/Gemini/Copilot provider tabs can be distinguished;
- generation state can be observed;
- provider responses can be read from the browser;
- results can be sent back to the same provider conversation;
- hashing can prevent repeated command execution;
- pending outbound results can be persisted;
- provider/session state can survive process cycles.

## Not yet proven

This plan does **not** claim that the current clean `main` already has:

- a browser backend;
- live CDP connectivity;
- browser tools;
- provider-browser adapters;
- browser evidence capture;
- provider/work target separation;
- a functioning provider-driven browser loop.

Those become true only after their corresponding phases pass runtime validation.
