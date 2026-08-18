'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_SECTIONS = Object.freeze([
  'Change ID',
  'Status',
  'Requested outcome',
  'Target files',
  'Intent',
  'Planned changes',
  'Why',
  'Post-change update',
  'Validation evidence',
]);
const VALID_STATUSES = new Set(['in_progress', 'completed', 'blocked']);
const ACTIVE_STATUS = 'in_progress';
const FILE_MUTATION_TOOLS = new Set(['createFile','writeFile','applyPatch','deleteFile']);

class ChangeGovernanceGuard {
  constructor({ workspaceRoot } = {}) {
    this.workspaceRoot = path.resolve(String(workspaceRoot || process.cwd()));
  }

  validateRepository() {
    const indexPath = path.join(this.workspaceRoot, 'docs', 'CHANGE_INDEX.md');
    if (!fs.existsSync(indexPath)) return fail('CHANGE_INDEX_MISSING', 'docs/CHANGE_INDEX.md is required.');
    const rows = indexRows(fs.readFileSync(indexPath, 'utf8'));
    if (!rows.length) return fail('CHANGE_INDEX_EMPTY', 'docs/CHANGE_INDEX.md must contain at least one change record.');
    const checkedRows=[];
    for (const row of rows) {
      if (!VALID_STATUSES.has(row.status)) return fail('CHANGE_STATUS_INVALID', `Unsupported change status "${row.status}" for ${row.changeId}.`);
      const checked = this._readIntent(row);
      if (!checked.ok) return checked;
      if (checked.changeId !== row.changeId) return fail('CHANGE_ID_MISMATCH', `Change index ID ${row.changeId} does not match intent ID ${checked.changeId || '(missing)'}.`);
      if (checked.status !== row.status) return fail('CHANGE_STATUS_MISMATCH', `Change index status ${row.status} does not match intent status ${checked.status || '(missing)'}.`);
      if (row.status === 'completed') {
        if (/^pending\b/iu.test(checked.sections.get('Post-change update') || '')) return fail('POST_CHANGE_UPDATE_PENDING', `${row.intentDocument} is completed but Post-change update is still pending.`);
        if (/^pending\b/iu.test(checked.sections.get('Validation evidence') || '')) return fail('VALIDATION_EVIDENCE_PENDING', `${row.intentDocument} is completed but Validation evidence is still pending.`);
      }
      checkedRows.push({...row,...checked});
    }
    return { ok:true, rows:checkedRows, active:checkedRows.filter(row => row.status === ACTIVE_STATUS) };
  }

  inspect({ toolName = '', args = {} } = {}) {
    const repository = this.validateRepository();
    if (!repository.ok) return repository;
    const active = repository.active;
    if (!active.length) return fail('ACTIVE_CHANGE_MISSING', 'At least one in_progress change must exist before agent workspace mutation.');
    const requestedId=String(args.changeId || '').trim();
    if(requestedId){
      const selected=active.find(row=>row.changeId===requestedId);
      if(!selected)return fail('CHANGE_ID_NOT_ACTIVE', `Requested change ${requestedId} is not active.`);
      return selected;
    }
    const name=String(toolName || '');
    if(FILE_MUTATION_TOOLS.has(name)){
      const target=normalizeRelative(String(args.path||''));
      if(!target)return fail('TARGET_PATH_REQUIRED', `${name} requires a declared target path.`);
      const matches=active.filter(row=>row.targetFiles.includes(target));
      if(matches.length===1)return matches[0];
      if(!matches.length)return fail('TARGET_NOT_DECLARED', `${target} is not declared by any active change intent.`);
      return fail('TARGET_CHANGE_AMBIGUOUS', `${target} is declared by multiple active changes; provide changeId.`);
    }
    if(active.length===1)return active[0];
    return fail('ACTIVE_CHANGE_AMBIGUOUS', `Multiple active changes exist (${active.map(row=>row.changeId).join(', ')}); provide changeId for this governed command.`);
  }

  assertMutation({ toolName = '', args = {} } = {}) {
    const name=String(toolName||'');
    const target=FILE_MUTATION_TOOLS.has(name)?normalizeRelative(String(args.path||'')):'';
    if(target&&isGovernanceDocument(target)){
      return {ok:true,governanceDocument:true,targetFiles:[target],changeId:String(args.changeId||'').trim()||null,status:'bootstrap'};
    }
    const state = this.inspect({toolName,args});
    if (!state.ok) throw governanceError(state);
    return state;
  }

  _readIntent(row) {
    const intentRelative = String(row.intentDocument || '').trim();
    if (!intentRelative.startsWith('docs/change-intents/') || !intentRelative.endsWith('.md')) return fail('CHANGE_INTENT_PATH_INVALID', `${row.changeId} must reference docs/change-intents/*.md.`);
    const intentPath = path.resolve(this.workspaceRoot, intentRelative);
    if (!inside(this.workspaceRoot, intentPath) || !fs.existsSync(intentPath)) return fail('CHANGE_INTENT_MISSING', `${intentRelative} is required.`);
    const sections = parseSections(fs.readFileSync(intentPath, 'utf8'));
    for (const section of REQUIRED_SECTIONS) {
      if (!sections.has(section) || !String(sections.get(section) || '').trim()) return fail('CHANGE_INTENT_INCOMPLETE', `${intentRelative} is missing required content for "## ${section}".`);
    }
    const changeId = firstCodeOrText(sections.get('Change ID'));
    const status = firstCodeOrText(sections.get('Status'));
    const targetFiles = parseTargetFiles(sections.get('Target files'));
    if (!targetFiles.length) return fail('TARGET_FILES_MISSING', `${intentRelative} must declare at least one target file.`);
    return { ok:true, changeId, status, intentRelative, intentPath, targetFiles, sections };
  }
}

function isGovernanceDocument(value){
  const target=normalizeRelative(value);
  return target==='docs/CHANGE_INDEX.md'||(/^docs\/change-intents\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.md$/u.test(target));
}
function indexRows(markdown) {
  const rows = [];
  for (const line of String(markdown || '').split(/\r?\n/u)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(cell => stripCode(cell.trim()));
    if (cells.length < 4 || cells[0] === 'Change ID' || /^-+$/u.test(cells[0])) continue;
    const [changeId, status, requestedOutcome, intentDocument] = cells;
    if (changeId && status) rows.push({ changeId, status, requestedOutcome, intentDocument });
  }
  return rows;
}
function activeIndexRows(markdown) { return indexRows(markdown).filter(row => row.status === ACTIVE_STATUS); }

function parseSections(markdown) {
  const sections = new Map(); let current = null; let lines = [];
  const flush = () => { if (current) sections.set(current, lines.join('\n').trim()); };
  for (const line of String(markdown || '').split(/\r?\n/u)) {
    const match = /^##\s+(.+?)\s*$/u.exec(line);
    if (match) { flush(); current = match[1].trim(); lines = []; }
    else if (current) lines.push(line);
  }
  flush(); return sections;
}
function parseTargetFiles(value) {
  return String(value || '').split(/\r?\n/u)
    .map(line => /^\s*-\s+`?([^`]+?)`?\s*$/u.exec(line)?.[1] || '')
    .map(normalizeRelative).filter(Boolean);
}
function normalizeRelative(value) { return String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/^\/+|\/+$/gu, ''); }
function firstCodeOrText(value) { const text = String(value || '').trim(); const code = /`([^`]+)`/u.exec(text)?.[1]; return String(code || text.split(/\r?\n/u)[0] || '').trim(); }
function stripCode(value) { return String(value || '').replace(/`/gu, '').trim(); }
function inside(root, candidate) { const relative = path.relative(root, candidate); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
function fail(code, message) { return { ok:false, code, message }; }
function governanceError(result) { const error = new Error(result.message); error.code = result.code; error.classification = 'GOVERNANCE'; return error; }

module.exports = { ChangeGovernanceGuard, REQUIRED_SECTIONS, FILE_MUTATION_TOOLS, isGovernanceDocument, indexRows, activeIndexRows, parseSections, parseTargetFiles };
