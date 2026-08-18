'use strict';

const { ACTION_KINDS } = require('../ActionProtocol');

/**
 * Declares a tool for the ToolRegistry.
 * schema is a JSON Schema object (OpenAI tools-compatible) describing arguments.
 * execute(ctx, args) runs the tool against the live runtime context.
 * evidence(result, args) derives a compact evidence record (default verifies ok).
 * approval is a boolean: sensitive tools pause for explicit user approval.
 */
function tool(name, description, schema, actionKind, execute, evidence, approval = false) {
  return {
    name,
    description,
    schema,
    actionKind,
    execute,
    evidence: typeof evidence === 'function'
      ? evidence
      : (result, args) => ({ path: args && args.path, verified: result && result.ok === true }),
    approval: approval === true,
  };
}

module.exports = { tool, ACTION_KINDS };
