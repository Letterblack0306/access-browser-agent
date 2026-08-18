'use strict';

/**
 * Example: Using the ClineStyleAgentCore with the browser agent.
 *
 * Wire up the Cline-style agent (plan → approve → execute → preview → verify)
 * to the existing ToolRegistry and an OpenAI-compatible provider.
 *
 * Run: node examples/cline-style-agent.js
 */

const ToolRegistry = require('../src/agent/ToolRegistry');
const { ClineStyleAgentCore } = require('../src/agent/ClineStyleAgentCore');
const OpenAICompatibleProvider = require('../src/llm/OpenAICompatibleProvider');

async function main() {
  // 1. Build a ToolRegistry (reusing your existing tools)
  const registry = new ToolRegistry([
    {
      name: 'inspectWorkspace',
      description: 'Inspect the active workspace structure, files, and extensions.',
      schema: { type: 'object', properties: { path: { type: 'string' } } },
      execute: async () => ({ ok: true, files: 42, directories: 8, bytes: 12345 }),
      category: 'investigate',
    },
    {
      name: 'readFile',
      description: 'Read a file from the workspace and return its content.',
      schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async (ctx, args) => ({ ok: true, path: args.path, content: '// hello.js\nconsole.log("Hello");' }),
      category: 'investigate',
    },
    {
      name: 'writeFile',
      description: 'Write a file to the workspace. Requires approval.',
      schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      execute: async (ctx, args) => ({ ok: true, path: args.path, receipt: { id: 'receipt-abc' } }),
      category: 'edit',
      approval: true,
    },
    {
      name: 'runCommand',
      description: 'Run a command in the workspace terminal. Requires approval.',
      schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      execute: async (ctx, args) => ({ ok: true, exitCode: 0, output: 'All tests passed.' }),
      category: 'validate',
      approval: true,
    },
  ]);

  // 2. Configure the OpenAI-compatible provider (LM Studio, Ollama, etc.)
  const provider = new OpenAICompatibleProvider({
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
  });

  // 3. Create the Cline-style agent core
  const agent = new ClineStyleAgentCore({
    registry,
    provider,
    ctx: {
      workspaceRoot: process.cwd(),
      workspace: {
        read: async filePath => ({ content: '// hello.js\nconsole.log("Hello");' }),
        list: async () => ({ items: [] }),
      },
    },
    // Auto-approve in this example. For interactive approval:
    // approvalRequestor: async ({ name, arguments }) => 'approved',
    approvalRequestor: async ({ name, arguments: args, sessionId, plan }) => {
      console.log(`\n[APPROVAL REQUESTED]`);
      if (plan) {
        console.log(`  Plan: ${plan.objective}`);
        plan.steps.forEach((step, i) => console.log(`    ${i + 1}. [${step.status}] ${step.title}`));
      } else {
        console.log(`  Tool: ${name}`);
        console.log(`  Args: ${JSON.stringify(args, null, 2)}`);
      }
      return 'approved';
    },
    emitEvent: async event => console.log(`[EVENT] ${event.type || event.phase} → ${event.status || ''}`),
  });

  // 4. Register a file reader for diff previews and verification
  agent.setFileReader('demo-session', async filePath => {
    // In production, read via the workspace bridge
    return '// hello.js\nconsole.log("Hello");';
  });

  // 5. Run a task — the agent will:
  //    plan → await approval → execute → preview file changes → report
  const result = await agent.run({
    sessionId: 'demo-session',
    objective: 'Update the greeting in src/hello.js to say "Hello, Cline!"',
    turnId: 'demo-turn',
  });

  console.log('\n=== RESULT ===');
  console.log(`Status: ${result.status}`);
  console.log(`Summary: ${result.summary}`);

  // 6. Show the final plan state
  console.log('\n=== FINAL PLAN ===');
  const plan = result.plan;
  (plan.steps || []).forEach(step => {
    console.log(`  [${step.status.toUpperCase()}] ${step.title}`);
  });
}

main().catch(error => {
  console.error('Example failed:', error);
  process.exit(1);
});