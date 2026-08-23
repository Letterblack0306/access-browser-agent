'use strict';

// Windows node-pty defect fix (audit item 20, REBUILD_REMOTE_COMPLETION_AUDIT_2026-08-14.md):
// node-pty's kill() path forks lib/conpty_console_list_agent.js whose native
// getConsoleProcessList() calls AttachConsole(shellPid). When the target shell
// console is already gone, AttachConsole fails and the unhandled throw crashes
// the helper process ("Error: AttachConsole failed"). The parent agent already
// falls back to [innerPid] after a 5s timeout, so failing closed to [shellPid]
// here matches upstream fallback semantics and removes the crash output.
// Idempotent; applied automatically via the package "postinstall" script.

const fs = require('node:fs');
const path = require('node:path');

const MARKER = '__ACCESS_AGENT_ATTACHCONSOLE_GUARD__';
const BROKEN = 'var consoleProcessList = getConsoleProcessList(shellPid);';
const FIXED = [
  `// ${MARKER}: AttachConsole can fail when the target console is already gone;`,
  '// fall back to [shellPid] exactly like the parent-side 5s timeout does.',
  'var consoleProcessList;',
  'try {',
  '    consoleProcessList = getConsoleProcessList(shellPid);',
  '} catch (error) {',
  '    consoleProcessList = [shellPid];',
  '}',
].join('\n');

function main() {
  const target = path.join(__dirname, '..', 'node_modules', 'node-pty', 'lib', 'conpty_console_list_agent.js');
  if (!fs.existsSync(target)) {
    console.log('[patch-node-pty] node-pty is not installed; skipping.');
    return;
  }
  const source = fs.readFileSync(target, 'utf8');
  if (source.includes(MARKER)) {
    console.log('[patch-node-pty] AttachConsole guard already present.');
    return;
  }
  if (!source.includes(BROKEN)) {
    console.log('[patch-node-pty] Expected node-pty source shape not found; leaving file untouched.');
    return;
  }
  fs.writeFileSync(target, source.replace(BROKEN, FIXED));
  console.log('[patch-node-pty] Applied AttachConsole guard to conpty_console_list_agent.js.');
}

main();
