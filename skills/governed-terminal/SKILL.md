---
name: governed-terminal
description: Execute a literal installed executable inside the active workspace through machine discovery, LBE governance, and evidence receipts; this is an action capability, not a debugging authority.
---

# Governed terminal

Use the governed terminal when the reasoning agent needs to execute a concrete host command as part of an evidence or implementation step.

The runtime resolves the requested **bare executable name** against the active machine PATH/PATHEXT on demand. There is no product-wide static capability allowlist. A caller may explicitly narrow the executable set for a specialized operation.

Hard boundaries remain deterministic:

- direct general shell interpreters such as `cmd`, PowerShell, Bash, Zsh, Fish, and WSL are not exposed as model-callable commands;
- shell operators, pipes, redirects, comments, expansion, and multiline shell input are rejected;
- execution is scoped to the active workspace and checked through LBE/governance;
- the executable is resolved again before execution and identity drift fails closed;
- Windows `.cmd`/`.bat` wrappers use the internal guarded adapter required by the OS rather than granting arbitrary shell access;
- command result truth is stdout/stderr/exit/timed-out/error plus the returned receipt, not a semantic success claim.

Receipts are written to the receipt directory supplied by the active runtime owner. Do not assume a fixed workspace-relative receipt path.

This tool does not decide what to debug, which hypothesis is correct, or whether a task is complete. The reasoning agent chooses the action; runtime/governance authorizes and executes it; validation determines what the result proves.
