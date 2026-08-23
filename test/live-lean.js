// CRITICAL_TRIAGE: see docs/change-intents/2026-08-23-orphan-triage.md
// This file is flagged for behavior verification before any keep/wire/delete decision.
// Do not delete or change behavior without first recording a check result in the triage doc.

'use strict';

// Lean LIVE round-trip against LM Studio: proves the agent-led loop with the real
// provider and REAL SHA-backed workspace tools (few tools so the local model is fast).

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { LiveAgentCore } = require('../src/agent/executive/LiveAgentCore');
const ToolRegistry = require('../src/agent/ToolRegistry');
const OpenAICompatibleProvider = require('../src/llm/OpenAICompatibleProvider');
const WorkspaceReader = require('../src/system/workspace-reader');
const { ImplementationExecutor } = require('../src/loop/implementation-executor');
const { tool, ACTION_KINDS } = require('../src/agent/tools/_tool');

const MODEL = process.env.LIVE_MODEL || 'qwen2.5-1.5b-instruct';
const crypto = require('node:crypto');
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'access-live-lean-'));
  await fs.writeFile(path.join(root, 'data.txt'), 'one\ntwo\nthree\n');
  const beforeHash = hash('one\ntwo\nthree\n');

  const ws = new WorkspaceReader(root);
  const executor = new ImplementationExecutor();
  const registry = new ToolRegistry([
    tool('readFile', 'Read a workspace file (returns sha256).', { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, ACTION_KINDS.FILE_READ,
      async (_c, a) => { const r = await ws.read(String(a.path)); return r.ok ? { ok: true, path: r.path, content: r.content, sha256: r.sha256 } : { ok: false, error: r.error }; }),
    tool('listFiles', 'List files.', { type: 'object', properties: { path: { type: 'string' } } }, ACTION_KINDS.FILE_LIST,
      (_c, a) => ws.list(String(a.path || '.'))),
    tool('applyPatch', 'Edit file lines. Requires approval.', { type: 'object', properties: { path: { type: 'string' }, edits: { type: 'array' } }, required: ['path', 'edits'] }, ACTION_KINDS.FILE_PATCH,
      (_c, a) => executor.execute({ action_type: 'implementation', operation: 'apply_patch', working_directory: root, targets: [String(a.path)], arguments: { edits: a.edits } }), null, true),
    tool('writeFile', 'Write/overwrite a file (SHA-guarded). Requires approval.', { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, ACTION_KINDS.FILE_WRITE,
      async (_c, a) => { const cur = await ws.read(String(a.path)); if (!cur.ok) return cur; const r = await ws.write(String(a.path), String(a.content), cur.sha256); return r.ok ? { ok: true, path: a.path, beforeSha: cur.sha256, sha256: r.sha256 } : r; }, null, true),
  ]);

  const provider = new OpenAICompatibleProvider({ baseUrl: 'http://127.0.0.1:1234', model: MODEL });
  const agent = new LiveAgentCore({
    registry,
    provider,
    ctx: {},
    approvalRequestor: async () => 'approved',
    maxToolCalls: 6,
  });

  const instruction = 'Read data.txt (note its sha256), then change line 2 to TWO using writeFile, then answer DONE.';
  const sw = Date.now();
  const result = await agent.step({
    sessionId: 'live',
    objective: instruction,
    pendingInstructions: [{ instructionId: 'i1', text: instruction }],
    recentDecisions: [],
    recentObservations: [],
  });
  const elapsed = Date.now() - sw;

  const messages = agent.messagesFor('live');
  const toolMsgs = messages.filter(m => m.role === 'tool');
  const data = await fs.readFile(path.join(root, 'data.txt'), 'utf8').catch(() => '(deleted)');
  const finalMsg = messages.filter(m => m.role === 'assistant' && m.content).at(-1)?.content || '';

  const shaRead = toolMsgs.some(m => /"sha256"/.test(String(m.content)));
  const mutationDone = data !== 'one\ntwo\nthree\n';
  const ok = result.status === 'completed' && toolMsgs.length >= 2 && shaRead && mutationDone;

  console.log('\n===== LIVE LEAN ROUND-TRIP =====');
  console.log('status        :', result.status, '(elapsed', elapsed + 'ms)');
  console.log('tool messages :', toolMsgs.length, '(results fed back into same conversation)');
  console.log('SHA read seen :', shaRead);
  console.log('before sha    :', beforeHash.slice(0, 12) + '...');
  console.log('data.txt now  :', JSON.stringify(data));
  console.log('mutation done :', mutationDone);
  console.log('final answer  :', finalMsg);
  console.log('RESULT        :', ok ? 'LIVE_LEAN_PASS' : 'LIVE_LEAN_INCOMPLETE');
  if (!ok) process.exitCode = 1;
})().catch(error => { console.error('\nLIVE LEAN ERROR:', error.message); process.exitCode = 1; });
