'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readIfExists(repoRoot, relPath) {
  const p = path.join(repoRoot, relPath);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function checkVerifiedAssistantIsDerived(providerChannelText) {
  const id = 'provenance.verifiedAssistant-derived';
  const claim = 'snapshot().provenance.verifiedAssistant reflects whether an assistant message was actually found in the DOM';
  const breakCondition = 'the field is a static literal (verifiedAssistant:true) inside the in-page eval template, not computed from the same text/messageIndex the snapshot just extracted';
  if (providerChannelText == null) return { id, claim, breakCondition, status: 'SKIP', detail: 'provider-channel.js not found' };
  const literalMatch = /verifiedAssistant:true(?!\s*[?:])/.test(providerChannelText);
  const derivedMatch = /verifiedAssistant:\s*Boolean\(/.test(providerChannelText) || /verifiedAssistant:\s*\w+\s*\?/.test(providerChannelText);
  if (literalMatch && !derivedMatch) {
    return { id, claim, breakCondition, status: 'FAIL', detail: 'verifiedAssistant:true found as an unconditional literal; no derived (Boolean(...)/ternary) form found alongside it' };
  }
  return { id, claim, breakCondition, status: 'PASS', detail: 'no unconditional literal form found' };
}

function checkProvenanceGuardHasNegativeTestCoverage(testFileTexts) {
  const id = 'provenance-guard-negative-coverage';
  const claim = 'the ASSISTANT_PROVENANCE_UNVERIFIED throw path in assertSnapshotTarget-equivalent guard is exercised by at least one test';
  const breakCondition = 'every test fixture that builds a snapshot/provenance object hardcodes verifiedAssistant:true, so the guard never executes its false path in the suite';
  const entries = Object.entries(testFileTexts).filter(([, text]) => text != null);
  if (entries.length === 0) return { id, claim, breakCondition, status: 'SKIP', detail: 'no test files provided' };
  let sawTrue = false;
  let sawFalse = false;
  const filesWithTrue = [];
  for (const [file, text] of entries) {
    if (/verifiedAssistant:\s*true/.test(text)) { sawTrue = true; filesWithTrue.push(file); }
    if (/verifiedAssistant:\s*false/.test(text)) sawFalse = true;
  }
  if (sawTrue && !sawFalse) {
    return { id, claim, breakCondition, status: 'FAIL', detail: `verifiedAssistant:true found in ${filesWithTrue.length} test file(s), verifiedAssistant:false found in none -- this guards failure path has zero coverage` };
  }
  if (sawFalse) return { id, claim, breakCondition, status: 'PASS', detail: 'at least one fixture exercises verifiedAssistant:false' };
  return { id, claim, breakCondition, status: 'SKIP', detail: 'no fixtures reference verifiedAssistant at all' };
}

function checkNoInboundObjectiveExtraction(relayText) {
  const id = 'no-inbound-OBJECTIVE-parsing';
  const claim = 'ordinary browser-observed prose is never re-classified via an OBJECTIVE: keyword extraction on the INBOUND (parse) side';
  const breakCondition = 'getField(...,"OBJECTIVE") or an equivalent inbound-parsing call exists in the relay/parse path';
  if (relayText == null) return { id, claim, breakCondition, status: 'SKIP', detail: 'BrowserInstructionRelay.js not found' };
  const inboundExtraction = /getField\([^)]*['"]OBJECTIVE['"]/.test(relayText);
  if (inboundExtraction) {
    return { id, claim, breakCondition, status: 'FAIL', detail: 'getField(...,"OBJECTIVE") call found in relay file' };
  }
  return { id, claim, breakCondition, status: 'PASS', detail: 'no inbound OBJECTIVE: field extraction found' };
}

function checkTaskStateRouterUnreachable(allFileTexts) {
  const id = 'task-state-router-unreachable';
  const claim = 'TaskStateRouter/TaskStateController are not imported or string-referenced by any active (non-dead-file) source';
  const breakCondition = 'the literal string "TaskStateRouter" or "TaskStateController" appears in any file other than their own dead-file definitions and the static module-registry governance declaration';
  const ALLOWLISTED_FILES = [
    'src/system/task-state/TaskStateRouter.js',
    'src/system/task-state/TaskStateController.js',
    'src/system/module-registry.js',
'src/system/module-registry.js',
    // Negative regression coverage in this test intentionally references these identifiers
    // in doesNotMatch(...) assertions and must not be treated as a runtime dependency.
    'test/rebuild-agent-truth-observability-smoke.js',
  ];
  const hits = [];
  for (const [file, text] of Object.entries(allFileTexts)) {
    if (text == null) continue;
    if (ALLOWLISTED_FILES.includes(file)) continue;
    if (/TaskStateRouter(?!Bridge)|TaskStateController(?!Bridge)/.test(text)) hits.push(file);
  }
  if (hits.length > 0) {
    return { id, claim, breakCondition, status: 'FAIL', detail: `referenced outside allowlisted files: ${hits.join(', ')}` };
  }
  return { id, claim, breakCondition, status: 'PASS', detail: 'no references outside dead files / static registry declaration' };
}

function runAudit(repoRoot) {
  const providerChannelText = readIfExists(repoRoot, 'src/browser/provider-channel.js');
  const relayText = readIfExists(repoRoot, 'src/agent/executive/BrowserInstructionRelay.js');
  const testFiles = [
    'test/browser-delivery-cdp-recovery-smoke.js',
    'test/browser-instruction-relay-smoke.js',
    'test/browser-relay-authority-endpoint-smoke.js',
    'test/browser-relay-restart-identity-smoke.js',
    'test/browser-scope-recovery-preflight-smoke.js',
    'test/provider-channel-smoke.js',
    'test/rebuild-agent-truth-observability-smoke.js',
    'test/rebuild-loop-lifecycle-smoke.js',
    'test/rebuild-phase0-contract-smoke.js',
  ];
  const testFileTexts = Object.fromEntries(testFiles.map(f => [f, readIfExists(repoRoot, f)]));
  const routerScanFiles = [
    'electron/main.js',
    'electron/task-state-router-bridge.js',
    'src/system/module-registry.js',
    'src/system/task-state/TaskStateRouter.js',
    'src/system/task-state/TaskStateController.js',
    'test/rebuild-agent-truth-observability-smoke.js',
    'test/rebuild-phase0-contract-smoke.js',
  ];
  const routerScanTexts = Object.fromEntries(routerScanFiles.map(f => [f, readIfExists(repoRoot, f)]));
  return [
    checkVerifiedAssistantIsDerived(providerChannelText),
    checkProvenanceGuardHasNegativeTestCoverage(testFileTexts),
    checkNoInboundObjectiveExtraction(relayText),
    checkTaskStateRouterUnreachable(routerScanTexts),
  ];
}

function printReport(results) {
  let failCount = 0;
  for (const r of results) {
    const marker = r.status === 'FAIL' ? '[FAIL]' : r.status === 'SKIP' ? '[SKIP]' : '[PASS]';
    if (r.status === 'FAIL') failCount += 1;
    console.log(`${marker} ${r.id}`);
    console.log(`  claim:  ${r.claim}`);
    console.log(`  breaks: ${r.breakCondition}`);
    console.log(`  detail: ${r.detail}`);
    console.log('');
  }
  console.log(`${results.length} checks, ${failCount} failed.`);
  return failCount;
}

if (require.main === module) {
  const repoRoot = process.argv[2] || process.cwd();
  const results = runAudit(repoRoot);
  const failCount = printReport(results);
  process.exitCode = failCount > 0 ? 1 : 0;
}

module.exports = { checkVerifiedAssistantIsDerived, checkProvenanceGuardHasNegativeTestCoverage, checkNoInboundObjectiveExtraction, checkTaskStateRouterUnreachable, runAudit, printReport };
