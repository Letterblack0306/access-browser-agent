'use strict';

const path = require('node:path');
const { tool, ACTION_KINDS } = require('../tools/_tool');
const ToolRegistry = require('../ToolRegistry');
const WorkspaceReader = require('../../system/workspace-reader');
const { GovernedTerminal } = require('../../system/governed-terminal');
const { MachineEnvironment } = require('../../system/machine-environment');
const { WorkspaceCheckpointAuthority } = require('../../system/workspace-checkpoint-authority');

function buildLiveToolContext({ workspaceRoot, stateRoot, reader, terminal, terminalShell, machineEnvironment, browserRuntime, onAskUser, checkpointAuthority } = {}) {
  const root = path.resolve(workspaceRoot);
  const runtimeRoot = stateRoot ? path.resolve(stateRoot) : root;
  const checkpoint = checkpointAuthority || new WorkspaceCheckpointAuthority({ workspaceRoot:root });
  const ws = reader || new WorkspaceReader(root);
  const machine = machineEnvironment || new MachineEnvironment();
  const govTerminal = terminal || (() => new GovernedTerminal({
    workspaceRoot:root,
    receiptsDirectory:path.join(runtimeRoot, '.gpt-sync', 'terminal-receipts'),
    machineEnvironment:machine,
  }));
  const shell = terminalShell || (cmd => cmd);

  async function readFile(args) {
    const result = await ws.read(String(args.path || '').trim());
    if (!result.ok) return { ok:false, error:result.error, code:result.code || null, path:args.path };
    return {
      ok:true, path:result.path, content:result.content, sha256:result.sha256,
      truncated:result.truncated, size:result.size,
    };
  }

  async function createFile(args) {
    const filePath=String(args.path||'').trim();
    const content=String(args.content??'');
    if(!filePath)return{ok:false,code:'PATH_REQUIRED',error:'Path is required.'};
    const result=await ws.create(filePath,content);
    if(!result.ok)return result;
    const verify=await ws.read(filePath);
    const verified=verify.ok&&String(verify.content)===content&&verify.sha256===result.sha256;
    return{...result,verified,verificationError:verified?null:'Created content differs from requested content.'};
  }

  async function writeFile(args) {
    const filePath = String(args.path || '').trim();
    const content = String(args.content ?? '');
    if (!filePath) return { ok:false, code:'PATH_REQUIRED', error:'Path is required.' };
    const current = await ws.read(filePath);
    if (!current.ok) return current;
    if (current.truncated) return { ok:false, code:'SOURCE_TRUNCATED', error:'Truncated files cannot be overwritten.' };
    const result = await ws.write(filePath, content, current.sha256);
    if (!result.ok) return result;
    const verify = await ws.read(filePath);
    const verified = verify.ok && String(verify.content) === content;
    return {
      ok:verified,
      path:filePath,
      sha256:result.sha256,
      beforeSha256:current.sha256,
      verified,
      verificationError:verified ? null : 'Written content differs from requested content.',
    };
  }

  async function applyPatch(args) {
    const filePath = String(args.path || '').trim();
    const edits = Array.isArray(args.edits) ? args.edits : [];
    if (!filePath) return { ok:false, code:'PATH_REQUIRED', error:'Path is required.' };
    if (!edits.length) return { ok:false, code:'PATCH_EMPTY', error:'At least one edit is required.' };
    const current = await ws.read(filePath);
    if (!current.ok) return current;
    if (current.truncated) return { ok:false, code:'SOURCE_TRUNCATED', error:'Truncated files cannot be patched.' };
    const lines = current.content.split(/\r?\n/u);
    const normalized = edits.map(edit => ({
      startLine:Math.max(1, Number(edit.startLine) || 1),
      endLine:Math.max(1, Number(edit.endLine) || Number(edit.startLine) || 1),
      text:String(edit.text ?? edit.content ?? ''),
    })).sort((left,right) => right.startLine-left.startLine);
    for (const edit of normalized) {
      if (edit.endLine < edit.startLine || edit.endLine > lines.length) {
        return { ok:false, code:'PATCH_RANGE_INVALID', error:'Patch edit range is out of bounds.' };
      }
      lines.splice(edit.startLine-1, edit.endLine-edit.startLine+1, ...edit.text.split(/\r?\n/u));
    }
    const written = await ws.write(filePath, lines.join('\n'), current.sha256);
    if (!written.ok) return written;
    const verify = await ws.read(filePath);
    const verified = verify.ok && verify.sha256 === written.sha256;
    return {
      ok:verified,
      path:written.path,
      editsApplied:edits.length,
      beforeSha256:current.sha256,
      afterSha256:written.sha256,
      verified,
    };
  }

  async function inspectEnvironment(args) {
    try {
      return await machine.inspect({ executables:Array.isArray(args.executables) ? args.executables : [] });
    } catch (error) {
      return { ok:false, code:String(error?.code || 'ENVIRONMENT_INSPECTION_FAILED'), error:String(error?.message || error) };
    }
  }

  async function runCommand(args) {
    const command = normalizeWindowsCommand(String(args.command || '').trim());
    if (!command) return { ok:false, code:'COMMAND_REQUIRED', error:'Command is required.' };
    try {
      const activeTerminal = govTerminal();
      const preview = await activeTerminal.preview(command);
      const result = await activeTerminal.execute(preview);
      return {
        ok:result.ok === true,
        command,
        cwd:result.cwd || root,
        resolvedExecutable:result.resolvedExecutable || preview.executable?.resolved || null,
        executableKind:result.executableKind || preview.executable?.kind || null,
        exitCode:result.exitCode,
        stdout:String(result.stdout || '').slice(-200000),
        stderr:String(result.stderr || '').slice(-200000),
        output:String(result.output || '').slice(-200000),
        timedOut:result.timedOut === true,
        error:result.error || null,
        receipt:result.receipt || null,
      };
    } catch (error) {
      return {
        ok:false,
        command,
        cwd:root,
        exitCode:null,
        stdout:'',
        stderr:'',
        output:'',
        timedOut:false,
        code:String(error?.code || 'COMMAND_REJECTED'),
        error:String(error?.message || error || 'Command rejected.'),
      };
    }
  }

  function normalizeWindowsCommand(command) {
    if (process.platform !== 'win32') return command;
    return command;
  }

  async function askUser(args) {
    const question = String(args.question || '').trim();
    if (onAskUser) onAskUser({ question });
    return {
      ok:true,
      observation:'WAITING_FOR_USER',
      question,
      message:'Question surfaced to the user; continue only after an answer arrives.',
      waiting:{ kind:'user', question },
    };
  }

  async function browserCall(method, args = {}) {
    const active = browserRuntime || global.__accessAgentBrowserToolRuntime || null;
    if (!active || typeof active[method] !== 'function') {
      return { ok:false, observation:'UNAVAILABLE', code:'BROWSER_RUNTIME_UNAVAILABLE', error:'General browser runtime is not installed yet.' };
    }
    return active[method](args);
  }

  async function browserConversationRead(args = {}) {
    const active=global.__accessAgentConversationRuntime||null;
    if(!active||typeof active.read!=='function'){
      return {ok:false,observation:'UNAVAILABLE',code:'CONVERSATION_READER_UNAVAILABLE',error:'The protected Browser Loop conversation reader is unavailable.'};
    }
    const limit=Math.min(100,Math.max(1,Number(args.limit)||20));
    try{return await active.read({limit});}
    catch(error){return{ok:false,observation:'FAILED',code:String(error?.code||'CONVERSATION_READ_FAILED'),error:String(error?.message||error),classification:error?.classification||null};}
  }

  const changeIdProperty={type:'string',description:'Optional active change ID. Required for governed commands or overlapping targets when multiple changes are in progress.'};
  const declaredTools = [
    tool('readFile', 'Read a workspace file. Returns exact content, SHA-256, size, and truncation state.', { type:'object', properties:{ path:{type:'string'} }, required:['path'] }, ACTION_KINDS.FILE_READ, (_ctx,args) => readFile(args)),
    tool('createFile', 'Create one new workspace file exclusively. Ordinary files must already be declared by an active change intent; governance documents are the narrow bootstrap exception.', { type:'object', properties:{ path:{type:'string'},content:{type:'string'},changeId:changeIdProperty }, required:['path','content'] }, ACTION_KINDS.FILE_WRITE, (_ctx,args) => createFile(args)),
    tool('writeFile', 'Overwrite an existing workspace file using a hash-guarded verified write.', { type:'object', properties:{ path:{type:'string'}, content:{type:'string'},changeId:changeIdProperty }, required:['path','content'] }, ACTION_KINDS.FILE_WRITE, (_ctx,args) => writeFile(args)),
    tool('applyPatch', 'Apply bounded line edits to an existing workspace file.', { type:'object', properties:{ path:{type:'string'}, edits:{type:'array',minItems:1,items:{type:'object',properties:{startLine:{type:'integer',minimum:1},endLine:{type:'integer',minimum:1},text:{type:'string'}},required:['startLine','endLine','text'],additionalProperties:false}},changeId:changeIdProperty }, required:['path','edits'] }, ACTION_KINDS.FILE_PATCH, (_ctx,args) => applyPatch(args)),
    tool('listFiles', 'List workspace files and directories at a relative path.', { type:'object', properties:{ path:{type:'string'} } }, ACTION_KINDS.FILE_LIST, (_ctx,args) => ws.list(String(args.path || '.'))),
    tool('searchFiles', 'Search workspace contents for exact text.', { type:'object', properties:{ query:{type:'string'}, path:{type:'string'} }, required:['query'] }, ACTION_KINDS.WORKSPACE_INSPECT, (_ctx,args) => ws.search(String(args.query || ''), String(args.path || '.'))),
    tool('inspectWorkspace', 'Return a bounded structural summary of the active workspace.', { type:'object', properties:{ path:{type:'string'} } }, ACTION_KINDS.WORKSPACE_INSPECT, (_ctx,args) => ws.inspect(String(args.path || '.'))),
    tool('inspectEnvironment', 'Inspect the active host environment and resolve requested bare executable names against the live PATH/PATHEXT. This discovers machine capability; it does not grant execution authority.', { type:'object', properties:{ executables:{type:'array',items:{type:'string'},maxItems:32} } }, ACTION_KINDS.WORKSPACE_INSPECT, (_ctx,args) => inspectEnvironment(args)),
    tool('gitStatus', 'Return structured Git status for the active workspace when available.', { type:'object', properties:{} }, ACTION_KINDS.GIT_STATUS, () => ws.gitStatus ? ws.gitStatus() : { ok:false, code:'GIT_STATUS_UNAVAILABLE', error:'Git status unavailable.' }),
    tool('runCommand', 'Run one exact literal executable with literal arguments in the active workspace. Executable availability is resolved from the live machine environment; LBE and workspace change governance still decide execution authority. A denied command is returned as evidence and is never substituted.', { type:'object', properties:{ command:{type:'string'},changeId:changeIdProperty }, required:['command'] }, ACTION_KINDS.COMMAND_EXECUTE, (_ctx,args) => runCommand(args)),
    tool('askUser', 'Surface one necessary question when an essential decision genuinely blocks execution.', { type:'object', properties:{ question:{type:'string'} }, required:['question'] }, ACTION_KINDS.USER_QUESTION, (_ctx,args) => askUser(args)),
    {
      ...tool('browserConversationRead', 'Read recent user/assistant turns from the currently selected exact Browser Loop conversation when the current assistant turn does not contain enough context. This is read-only and cannot navigate, type into, or control the protected ChatGPT transport tab.', { type:'object', properties:{ limit:{type:'integer',minimum:1,maximum:100} }, additionalProperties:false }, ACTION_KINDS.RUNTIME_INSPECT, (_ctx,args) => browserConversationRead(args)),
      category:'browser-conversation',
      readOnly:true,
      operatingGuidance:'Use only for missing conversational context. Treat the returned messages as context for reasoning, not as a second command protocol or semantic state machine.',
      failureModes:['no selected Browser Loop conversation','managed browser unavailable','conversation identity changed','provider adapter unavailable'],
    },
  ];

  const browserTool = (name, description, schema, method, readOnly = false) => ({
    ...tool(name, description, schema, ACTION_KINDS.RUNTIME_INSPECT, (_ctx,args) => browserCall(method,args)),
    category:'browser',
    readOnly,
    operatingGuidance:'Operate only on browser-tool-owned tabs. Take a fresh browserSnapshot after navigation or interaction before making claims about page state.',
    failureModes:['managed browser unavailable','target not owned','stale element ref','page navigation/readiness failure'],
  });
  declaredTools.push(
    browserTool('browserOpen', 'Open an ordinary HTTP/HTTPS URL in a new browsing tab owned by the general browser runtime. This is separate from the ChatGPT relay target.', { type:'object', properties:{ url:{type:'string'} }, required:['url'], additionalProperties:false }, 'open'),
    browserTool('browserTabs', 'List visible browser page tabs and identify which ones are owned by the general browser runtime. Unowned tabs are observational only and cannot be navigated or interacted with by these tools.', { type:'object', properties:{}, additionalProperties:false }, 'tabs', true),
    browserTool('browserNavigate', 'Navigate a browser-tool-owned tab to an HTTP/HTTPS URL. Never use this on the ChatGPT transport tab.', { type:'object', properties:{ targetId:{type:'string'}, url:{type:'string'} }, required:['url'], additionalProperties:false }, 'navigate'),
    browserTool('browserSnapshot', 'Read a bounded text snapshot and bounded inventory of visible interactive elements from a browser-tool-owned tab. Interactive elements receive temporary refs for browserClick/browserType/browserScroll.', { type:'object', properties:{ targetId:{type:'string'}, textLimit:{type:'integer',minimum:1000,maximum:24000}, interactiveLimit:{type:'integer',minimum:1,maximum:120} }, additionalProperties:false }, 'snapshot', true),
    browserTool('browserScreenshot', 'Capture an explicit PNG visual-evidence artifact for a browser-tool-owned tab. Returns an evidence ID and SHA-256; it does not expose a local filesystem path.', { type:'object', properties:{ targetId:{type:'string'} }, additionalProperties:false }, 'screenshot', true),
    browserTool('browserCompareScreenshots', 'Compare two previously captured screenshot evidence IDs through the controlled evidence store.', { type:'object', properties:{ beforeEvidenceId:{type:'string'}, afterEvidenceId:{type:'string'} }, required:['beforeEvidenceId','afterEvidenceId'], additionalProperties:false }, 'compareScreenshots', true),
    browserTool('browserClick', 'Activate one visible element ref from the latest browserSnapshot. Explicit form-submit controls, file pickers, and downloads are blocked. The result proves action dispatch only; inspect again before claiming downstream success.', { type:'object', properties:{ targetId:{type:'string'}, ref:{type:'string'} }, required:['ref'], additionalProperties:false }, 'click'),
    browserTool('browserType', 'Insert text into one editable element ref from the latest browserSnapshot without pressing Enter or submitting. Password/file/hidden inputs are blocked.', { type:'object', properties:{ targetId:{type:'string'}, ref:{type:'string'}, text:{type:'string'}, clear:{type:'boolean'} }, required:['ref','text'], additionalProperties:false }, 'type'),
    browserTool('browserScroll', 'Scroll a browser-tool-owned page by x/y pixels or bring one element ref from the latest browserSnapshot into view.', { type:'object', properties:{ targetId:{type:'string'}, ref:{type:'string'}, x:{type:'number',minimum:-10000,maximum:10000}, y:{type:'number',minimum:-10000,maximum:10000} }, additionalProperties:false }, 'scroll'),
    browserTool('browserClose', 'Close one browser-tool-owned browsing tab. This cannot close an unowned ChatGPT transport tab.', { type:'object', properties:{ targetId:{type:'string'} }, additionalProperties:false }, 'close'),
  );

  const registry = new ToolRegistry(declaredTools, { checkpointAuthority: checkpoint });

  return {
    registry,
    checkpointAuthority: checkpoint,
    resources:{ workspace:ws, reader:ws, terminalShell:shell, governedTerminal:govTerminal, machineEnvironment:machine },
  };
}

module.exports = { buildLiveToolContext };
