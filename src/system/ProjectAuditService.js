'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_EXCLUDES = [
  '.git', 'node_modules', '.audit', '.gpt-sync', 'dist', 'build', 'coverage',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode',
];
const TEXT_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.html', '.htm', '.css',
  '.json', '.md', '.py', '.ps1', '.sh', '.bat', '.cmd', '.yml', '.yaml',
]);

class ProjectAuditService {
  constructor({ workspaceRoot, onLog, maxFiles = 10000, maxFileBytes = 2_000_000 } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.onLog = typeof onLog === 'function' ? onLog : () => {};
    this.maxFiles = Math.max(100, Number(maxFiles) || 10000);
    this.maxFileBytes = Math.max(1000, Number(maxFileBytes) || 2_000_000);
    this.running = false;
    this.startedAt = null;
    this.completedAt = null;
    this.lastReport = null;
    this.logs = [];
    this._logId = 0;
  }

  setWorkspaceRoot(root) {
    if (this.running) throw new Error('Cannot switch audit workspace while an audit is running.');
    this.workspaceRoot = path.resolve(root || process.cwd());
  }

  status() {
    return {
      ok: true,
      running: this.running,
      phase: this.running ? 'RUNNING' : this.lastReport ? 'COMPLETED' : 'IDLE',
      workspaceRoot: this.workspaceRoot,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      summary: this.lastReport?.summary || null,
      reportDir: this.lastReport?.reportDir || path.join(this.workspaceRoot, '.audit'),
    };
  }

  getLogs(after = 0, limit = 300) {
    const cursor = Number(after) || 0;
    const size = Math.max(1, Math.min(1000, Number(limit) || 300));
    const logs = this.logs.filter(item => item.id > cursor).slice(-size);
    return { ok: true, logs, cursor: logs.at(-1)?.id || cursor };
  }

  getReport() {
    return this.lastReport
      ? { ok: true, report: this.lastReport }
      : { ok: false, error: 'No audit report has been generated.' };
  }

  async run(options = {}) {
    if (this.running) return { ok: false, error: 'Project audit is already running.' };
    this.running = true;
    this.startedAt = new Date().toISOString();
    this.completedAt = null;
    this.logs = [];
    try {
      const excludes = normalizeExcludes(options.excludes);
      this._log('info', 'audit.started', `Auditing ${this.workspaceRoot}`);
      const inventory = this._inventory(excludes);
      const sources = this._readSources(inventory.files);
      const ui = auditUi(sources);
      const api = auditApi(sources);
      const events = auditEvents(sources);
      const orphans = auditOrphans(inventory.files, sources, this.workspaceRoot);
      const proofLedger = buildProofLedger(ui, api, events);
      const findings = collectFindings(inventory, ui, api, events, orphans);
      const summary = summarize(findings, inventory);
      const reportDir = path.join(this.workspaceRoot, '.audit');
      const report = {
        ok: summary.critical === 0 && summary.high === 0,
        generatedAt: new Date().toISOString(),
        workspaceRoot: this.workspaceRoot,
        reportDir,
        options: { excludes },
        summary,
        findings,
        inventory,
        uiContract: ui,
        apiContract: api,
        eventContract: events,
        orphanedFiles: orphans,
        proofLedger,
        runtimeSmoke: {
          status: 'NOT_RUN',
          reason: 'Static project audit cannot prove live clicks or external runtime dependencies.',
        },
      };
      writeReports(reportDir, report);
      this.lastReport = report;
      this.completedAt = report.generatedAt;
      this._log(report.ok ? 'info' : 'warn', 'audit.completed', formatSummary(summary));
      return { ok: true, report };
    } catch (error) {
      this._log('error', 'audit.failed', error.message || String(error));
      return { ok: false, error: error.message || String(error) };
    } finally {
      this.running = false;
    }
  }

  _inventory(excludes) {
    const files = [];
    const directories = [];
    const skipped = [];
    const stack = [this.workspaceRoot];
    while (stack.length) {
      const dir = stack.pop();
      const relativeDir = relative(this.workspaceRoot, dir);
      if (relativeDir && isExcluded(relativeDir, excludes)) {
        skipped.push(relativeDir);
        continue;
      }
      directories.push(relativeDir || '.');
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (error) {
        skipped.push(`${relativeDir || '.'}: ${error.message}`);
        continue;
      }
      for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        const rel = relative(this.workspaceRoot, absolute);
        if (isExcluded(rel, excludes)) continue;
        if (entry.isDirectory()) stack.push(absolute);
        else if (entry.isFile()) {
          const stat = fs.statSync(absolute);
          files.push({ path: rel, size: stat.size, ext: path.extname(entry.name).toLowerCase() });
          if (files.length >= this.maxFiles) throw new Error(`Audit file limit exceeded (${this.maxFiles}). Add exclusions.`);
        }
      }
    }
    const byExtension = {};
    for (const file of files) byExtension[file.ext || '[none]'] = (byExtension[file.ext || '[none]'] || 0) + 1;
    this._log('info', 'inventory.completed', `${files.length} files, ${directories.length} directories`);
    return { files, directories, skipped, byExtension, totalBytes: files.reduce((sum, file) => sum + file.size, 0) };
  }

  _readSources(files) {
    const out = [];
    for (const file of files) {
      if (!TEXT_EXTENSIONS.has(file.ext) || file.size > this.maxFileBytes) continue;
      const absolute = path.join(this.workspaceRoot, file.path);
      try { out.push({ ...file, text: fs.readFileSync(absolute, 'utf8') }); }
      catch (error) { this._log('warn', 'source.read_failed', `${file.path}: ${error.message}`); }
    }
    this._log('info', 'source.completed', `${out.length} text sources inspected`);
    return out;
  }

  _log(level, type, message) {
    const entry = { id: ++this._logId, at: new Date().toISOString(), level, type, message };
    this.logs.push(entry);
    if (this.logs.length > 1000) this.logs.splice(0, this.logs.length - 1000);
    this.onLog(entry);
  }
}

function auditUi(sources) {
  const ids = new Map();
  const idOccurrences = new Map();
  const referenced = new Map();
  const listeners = new Set();
  const hiddenViews = [];
  for (const source of sources) {
    for (const match of source.text.matchAll(/\bid=["']([^"']+)["']/g)) {
      pushMap(ids, match[1], source.path);
      idOccurrences.set(match[1], (idOccurrences.get(match[1]) || 0) + 1);
    }
    for (const match of source.text.matchAll(/(?:getElementById|byId)\(\s*["']([^"']+)["']\s*\)/g)) pushMap(referenced, match[1], source.path);
    for (const match of source.text.matchAll(/([A-Za-z_$][\w$]*)\??\.addEventListener\(\s*["']([^"']+)["']/g)) listeners.add(`${source.path}:${match[1]}:${match[2]}`);
    for (const match of source.text.matchAll(/data-view=["']([^"']+)["'][^>]*(?:hidden|aria-hidden=["']true["'])/g)) hiddenViews.push({ view: match[1], file: source.path });
  }
  const duplicateIds = [...idOccurrences]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count, files: ids.get(id) || [] }));
  const missingElements = [...referenced].filter(([id]) => !ids.has(id)).map(([id, files]) => ({ id, files }));
  const unreferencedElements = [...ids].filter(([id]) => !referenced.has(id)).map(([id, files]) => ({ id, files }));
  return { ids: ids.size, referencedIds: referenced.size, listenerCount: listeners.size, duplicateIds, missingElements, unreferencedElements, hiddenViews };
}

function auditApi(sources) {
  const calls = new Map();
  const routes = new Map();
  for (const source of sources) {
    for (const match of source.text.matchAll(/(?:fetch|request|perform)\(\s*["'`]([^"'`]*\/api\/[^"'`]*)/g)) pushMap(calls, normalizeRoutePath(match[1]), source.path);
    for (const match of source.text.matchAll(/["'`](GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^"'`?]+)["'`]/g)) pushMap(routes, `${match[1]} ${normalizeRoutePath(match[2])}`, source.path);
  }
  const callPaths = new Set([...calls.keys()]);
  const routePaths = new Set([...routes.keys()].map(value => value.replace(/^[A-Z]+\s+/, '')));
  const callersWithoutRoute = [...callPaths].filter(value => !routePaths.has(value)).map(pathname => ({ path: pathname, callers: calls.get(pathname) }));
  const routesWithoutCaller = [...routes]
    .filter(([route]) => !callPaths.has(route.replace(/^[A-Z]+\s+/, '')))
    .map(([route, files]) => ({ route, files }));
  return { calls: calls.size, routes: routes.size, callersWithoutRoute, routesWithoutCaller };
}

function auditEvents(sources) {
  const producers = new Map();
  const consumers = new Map();
  for (const source of sources) {
    for (const match of source.text.matchAll(/(?:emit|broadcast|send|postMessage)\(\s*["']([a-z][\w.:-]+)["']/g)) pushMap(producers, match[1], source.path);
    for (const match of source.text.matchAll(/(?:on|once|addEventListener|subscribe)\(\s*["']([a-z][\w.:-]+)["']/g)) pushMap(consumers, match[1], source.path);
  }
  const producedWithoutConsumer = [...producers].filter(([name]) => !consumers.has(name)).map(([name, files]) => ({ name, files }));
  const consumedWithoutProducer = [...consumers].filter(([name]) => !producers.has(name)).map(([name, files]) => ({ name, files }));
  return { producers: producers.size, consumers: consumers.size, producedWithoutConsumer, consumedWithoutProducer };
}

function auditOrphans(files, sources, root) {
  const imports = new Set();
  for (const source of sources) {
    for (const match of source.text.matchAll(/(?:require\(|from\s+|import\s*\()\s*["']([^"']+)["']/g)) imports.add(match[1]);
  }
  const packageJson = path.join(root, 'package.json');
  let entryText = '';
  try { entryText = fs.readFileSync(packageJson, 'utf8'); } catch {}
  const candidates = files.filter(file => ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py'].includes(file.ext)).filter(file => {
    const stem = file.path.replace(/\.[^.]+$/, '').replace(/\\/g, '/');
    const base = path.basename(stem);
    if (/^(index|main|app|server|launcher|cli|setup|test|spec)/i.test(base)) return false;
    if (entryText.includes(file.path) || entryText.includes(stem)) return false;
    return ![...imports].some(value => value.includes(base) || value.includes(stem));
  }).map(file => ({ path: file.path, reason: 'No static import/reference found; heuristic only.' }));
  return { candidates, note: 'Orphan detection is heuristic and requires human confirmation before deletion.' };
}

function buildProofLedger(ui, api, events) {
  const ledger = [];
  for (const item of ui.missingElements) ledger.push({ feature: item.id, entryPoint: 'DOM reference', status: 'BROKEN', evidence: item.files, gap: 'Referenced element does not exist.' });
  for (const item of api.callersWithoutRoute) ledger.push({ feature: item.path, entryPoint: 'UI/API caller', status: 'BROKEN', evidence: item.callers, gap: 'No matching backend route found.' });
  for (const item of events.consumedWithoutProducer) ledger.push({ feature: item.name, entryPoint: 'Event consumer', status: 'UNPROVEN', evidence: item.files, gap: 'No static producer found.' });
  return ledger;
}

function collectFindings(inventory, ui, api, events, orphans) {
  const findings = [];
  for (const item of ui.duplicateIds) findings.push(finding('high', 'UI_DUPLICATE_ID', `Duplicate DOM id: ${item.id}`, item.files));
  for (const item of ui.missingElements) findings.push(finding('high', 'UI_MISSING_ELEMENT', `Listener/reference targets missing element: ${item.id}`, item.files));
  for (const item of api.callersWithoutRoute) findings.push(finding('high', 'API_CALL_WITHOUT_ROUTE', `API caller has no matching route: ${item.path}`, item.callers));
  for (const item of events.consumedWithoutProducer) findings.push(finding('medium', 'EVENT_WITHOUT_PRODUCER', `Event consumer has no static producer: ${item.name}`, item.files));
  for (const item of events.producedWithoutConsumer) findings.push(finding('low', 'EVENT_WITHOUT_CONSUMER', `Event producer has no static consumer: ${item.name}`, item.files));
  if (orphans.candidates.length) findings.push(finding('low', 'ORPHAN_CANDIDATES', `${orphans.candidates.length} possible orphan source files require review.`, orphans.candidates.slice(0, 100).map(item => item.path)));
  if (inventory.skipped.length) findings.push(finding('low', 'INVENTORY_SKIPPED', `${inventory.skipped.length} paths could not be inspected or were skipped.`, inventory.skipped.slice(0, 100)));
  return findings;
}

function summarize(findings, inventory) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, total: findings.length, files: inventory.files.length };
  for (const item of findings) summary[item.severity] += 1;
  summary.verdict = summary.critical || summary.high ? 'FAIL' : summary.medium ? 'REVIEW' : 'PASS';
  return summary;
}

function writeReports(dir, report) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    'inventory.json': report.inventory,
    'ui-contract.json': report.uiContract,
    'api-contract.json': report.apiContract,
    'event-contract.json': report.eventContract,
    'orphaned-files.json': report.orphanedFiles,
    'runtime-smoke.json': report.runtimeSmoke,
    'proof-ledger.json': report.proofLedger,
    'audit-report.json': report,
  };
  for (const [name, payload] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'audit-summary.md'), markdownSummary(report), 'utf8');
}

function markdownSummary(report) {
  const s = report.summary;
  const lines = ['# Project Audit', '', `- Verdict: **${s.verdict}**`, `- Files: ${s.files}`, `- Findings: ${s.total}`, `- Critical: ${s.critical}`, `- High: ${s.high}`, `- Medium: ${s.medium}`, `- Low: ${s.low}`, '', '## Findings', ''];
  for (const item of report.findings) lines.push(`- **${item.severity.toUpperCase()} · ${item.code}** — ${item.message}`);
  lines.push('', '## Runtime proof', '', 'Static audit completed. Live runtime smoke remains NOT_RUN until the application is launched and controls are exercised.');
  return lines.join('\n');
}

function finding(severity, code, message, evidence) { return { severity, code, message, evidence }; }
function pushMap(map, key, value) { if (!map.has(key)) map.set(key, []); if (!map.get(key).includes(value)) map.get(key).push(value); }
function normalizeRoutePath(value) { try { return new URL(value, 'http://local').pathname; } catch { return String(value).split('?')[0]; } }
function normalizeExcludes(value) { const extra = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/); return [...new Set([...DEFAULT_EXCLUDES, ...extra.map(item => String(item).trim()).filter(Boolean)])]; }
function isExcluded(rel, excludes) { const value = rel.replace(/\\/g, '/'); return excludes.some(rule => value === rule || value.startsWith(`${rule.replace(/\/$/, '')}/`) || (rule.endsWith('/**') && (value === rule.slice(0, -3) || value.startsWith(`${rule.slice(0, -3)}/`)))); }
function relative(root, absolute) { return path.relative(root, absolute).replace(/\\/g, '/'); }
function formatSummary(s) { return `${s.verdict}: ${s.total} findings (${s.critical} critical, ${s.high} high, ${s.medium} medium, ${s.low} low)`; }

module.exports = ProjectAuditService;
module.exports.auditUi = auditUi;
module.exports.auditApi = auditApi;
module.exports.auditEvents = auditEvents;
