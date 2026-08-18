'use strict';

const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { parse } = require('shell-quote');
const { MachineEnvironment } = require('./machine-environment');

// Compatibility export only. An empty default means "do not impose a static
// capability allowlist". Explicit caller-provided allowCommands still narrow
// execution when a specialized runtime needs that behavior.
const DEFAULT_ALLOWED_COMMANDS = Object.freeze([]);
const DENIED_COMMANDS = new Set([
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'bash', 'sh', 'zsh', 'fish', 'wsl', 'wsl.exe',
]);
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 30_000;

function normalizeAllowedCommands(value) {
  if (!Array.isArray(value)) return null;
  const commands = value
    .map(item => String(item || '').trim().toLowerCase())
    .filter(item => /^[a-z0-9][a-z0-9._+-]{0,127}$/i.test(item) && !DENIED_COMMANDS.has(item));
  return [...new Set(commands)];
}

function parseTerminalCommand(input) {
  const text = String(input || '').trim();
  if (!text || text.length > 4_000 || /[\r\n]/u.test(text)) {
    throw new Error('Enter one literal command line (no multiline shell input).');
  }
  const tokens = parse(text);
  if (!tokens.length || tokens.some(token => typeof token !== 'string')) {
    throw new Error('Shell operators, expansion, pipes, redirects, and comments are not supported. Use an executable plus literal arguments.');
  }
  const [command, ...args] = tokens;
  const executable = String(command || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._+-]{0,127}$/i.test(executable)) throw new Error('Command must be a bare executable name.');
  if (DENIED_COMMANDS.has(executable)) throw new Error(`Command '${command}' is not available in the governed terminal.`);
  if (args.some(arg => arg.length > 16_384 || /[\0\r\n]/u.test(arg))) throw new Error('Command arguments are invalid.');
  return Object.freeze({ command:executable, args:Object.freeze(args) });
}

function terminalRequest(parsed, workspaceRoot) {
  return {
    intent:'run_shell',
    actor:'agent:workspace-runtime',
    command:{
      cmd:parsed.command,
      args:parsed.args,
      cwd:workspaceRoot,
      timeoutMs:MAX_TIMEOUT_MS,
      maxOutputBytes:MAX_OUTPUT_BYTES,
    },
    // LBE still receives an explicit deterministic execution boundary, but it
    // is scoped to the exact executable discovered for this request rather
    // than a product-wide baked list of machine capabilities.
    allowCommands:[parsed.command],
    denyCommands:[...DENIED_COMMANDS],
  };
}

class GovernedTerminal {
  constructor({ workspaceRoot, receiptsDirectory, allowedCommands, machineEnvironment } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.receiptsDirectory = path.resolve(receiptsDirectory);
    this.allowedCommands = normalizeAllowedCommands(allowedCommands);
    this.machineEnvironment = machineEnvironment || new MachineEnvironment();
  }

  async preview(commandLine) {
    const parsed = parseTerminalCommand(commandLine);
    if (this.allowedCommands && !this.allowedCommands.includes(parsed.command)) {
      const error = new Error(`Command '${parsed.command}' is outside this caller's explicitly narrowed executable set.`);
      error.code = 'COMMAND_NOT_ALLOWLISTED';
      throw error;
    }
    const executable = await this.machineEnvironment.resolveExecutable(parsed.command);
    if (!executable.available || !executable.resolved) {
      const error = new Error(`Executable '${parsed.command}' was not found in the active machine PATH.`);
      error.code = 'EXECUTABLE_NOT_FOUND';
      error.classification = 'ENVIRONMENT';
      throw error;
    }
    const { createLocalExecutor } = await import('@letterblack/lbe-exec');
    const executor = createLocalExecutor({
      rootDir:this.workspaceRoot,
      mode:'enforce',
      shell:{ allowCommands:[parsed.command], denyCommands:[...DENIED_COMMANDS], maxRequests:20 },
    });
    const lbe = await executor.dryRun(terminalRequest(parsed, this.workspaceRoot));
    if (!lbe.ok || lbe.decision === 'deny') {
      const error = new Error(lbe.error?.message || 'LBE denied this command.');
      error.code = lbe.error?.code || 'COMMAND_POLICY_DENIED';
      throw error;
    }
    return Object.freeze({
      id:randomUUID(), parsed, executable, workspaceRoot:this.workspaceRoot, lbe, expiresAt:Date.now()+60_000,
    });
  }

  async execute(preview) {
    if (!preview || typeof preview !== 'object' || !preview.id || Date.now() > preview.expiresAt) {
      throw new Error('Command preview has expired. Preview it again before execution.');
    }
    const { parsed } = preview;
    const revalidated = await this.preview([parsed.command, ...parsed.args.map(quoteArgument)].join(' '));
    if (revalidated.parsed.command !== parsed.command || revalidated.parsed.args.join('\0') !== parsed.args.join('\0')) {
      throw new Error('Command changed after preview.');
    }
    if (revalidated.executable.resolved !== preview.executable.resolved) {
      const error = new Error('Resolved executable changed after preview.');
      error.code = 'EXECUTABLE_IDENTITY_CHANGED';
      throw error;
    }
    const startedAt = new Date().toISOString();
    const result = await runLiteralCommand({ parsed, executable:revalidated.executable, machineEnvironment:this.machineEnvironment }, this.workspaceRoot);
    const receipt = await this.record({
      previewId:preview.id,
      command:parsed.command,
      resolvedExecutable:revalidated.executable.resolved,
      executableKind:revalidated.executable.kind,
      args:parsed.args,
      cwd:this.workspaceRoot,
      startedAt,
      ...result,
    });
    return {
      ...result,
      cwd:this.workspaceRoot,
      commandLine:[parsed.command, ...parsed.args].join(' '),
      resolvedExecutable:revalidated.executable.resolved,
      executableKind:revalidated.executable.kind,
      receipt,
      lbe:revalidated.lbe,
    };
  }

  async record(entry) {
    await fs.mkdir(this.receiptsDirectory, { recursive:true });
    const file = path.join(this.receiptsDirectory, 'terminal-receipts.jsonl');
    let previousHash = 'GENESIS';
    try {
      const existing = (await fs.readFile(file, 'utf8')).trim().split(/\r?\n/u).filter(Boolean);
      if (existing.length) previousHash = JSON.parse(existing.at(-1)).hash || previousHash;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const payload = { kind:'agent_terminal_execution', previousHash, ...entry, recordedAt:new Date().toISOString() };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    await fs.appendFile(file, `${JSON.stringify({ ...payload, hash })}\n`, 'utf8');
    return { id:hash, file, hash };
  }
}

function quoteArgument(value) { return JSON.stringify(String(value)); }

function runLiteralCommand({ parsed, executable, machineEnvironment }, cwd) {
  if (executable.kind === 'script-wrapper' && machineEnvironment.platform === 'win32') {
    return runWindowsScriptWrapper({ parsed, executable, machineEnvironment }, cwd);
  }
  return runSpawn(executable.resolved, parsed.args, cwd);
}

function runWindowsScriptWrapper({ parsed, executable, machineEnvironment }, cwd) {
  // .cmd/.bat files require cmd.exe on Windows. This is an internal adapter,
  // not model access to a general shell: command/args were parsed as literals,
  // the wrapper path was discovered from PATH, and wrapper-sensitive expansion
  // characters are rejected before constructing one fully quoted invocation.
  // Parentheses are allowed because every path/argument is quoted; this keeps
  // normal Program Files (x86) style paths usable without opening shell syntax.
  const unsafe = [executable.resolved, ...parsed.args].find(value => /[&|<>^%!"\r\n]/u.test(String(value)));
  if (unsafe) {
    return Promise.resolve({
      ok:false, exitCode:null, stdout:'', stderr:'', output:'', timedOut:false,
      error:'Windows script-wrapper arguments contain unsafe shell-expansion characters; use a dedicated typed adapter instead.',
      code:'SCRIPT_WRAPPER_ARGUMENT_UNSAFE',
    });
  }
  const comspec = machineEnvironment.shellIdentity();
  const commandText = [quoteCmd(executable.resolved), ...parsed.args.map(quoteCmd)].join(' ');
  return runSpawn(comspec, ['/d','/s','/c',commandText], cwd);
}

function quoteCmd(value) { return `"${String(value)}"`; }

function runSpawn(command, args, cwd) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, shell:false, windowsHide:true, stdio:['ignore','pipe','pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const append = (current, chunk) => `${current}${chunk}`.slice(-MAX_OUTPUT_BYTES);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const finish = value => { if (settled) return; settled = true; resolve(value); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, MAX_TIMEOUT_MS);
    child.once('error', error => {
      clearTimeout(timer);
      finish({ ok:false, exitCode:null, stdout, stderr, output:`${stdout}${stderr}`.slice(-MAX_OUTPUT_BYTES), error:error.message, code:error.code || null, timedOut });
    });
    child.once('close', exitCode => {
      clearTimeout(timer);
      finish({ ok:!timedOut && exitCode === 0, exitCode, stdout, stderr, output:`${stdout}${stderr}`.slice(-MAX_OUTPUT_BYTES), error:timedOut ? `Command exceeded ${MAX_TIMEOUT_MS / 1000} seconds.` : '', timedOut });
    });
  });
}

module.exports = {
  GovernedTerminal,
  DEFAULT_ALLOWED_COMMANDS,
  DENIED_COMMANDS,
  normalizeAllowedCommands,
  parseTerminalCommand,
  MAX_TIMEOUT_MS,
};
