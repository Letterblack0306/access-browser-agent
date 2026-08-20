'use strict';

/**
 * Chain-break audit for the browser-turn trust chain:
 *   snapshot -> provenance -> identity -> transport -> session -> capability -> observation -> adaptation
 *
 * This does NOT check whether a claim's prose is accurate (that was the
 * earlier conversational audit). It checks whether a claimed GATE can
 * structurally fail, or whether it is a tautology / has zero negative-path
 * test coverage -- the two ways a "verification" step silently stops
 * verifying anything.
 *
 * Usage (run from repo root, i.e. G:\Developments\46_Accecc_Browser_Agent\Browser Agent):
 *   node chain-break-audit.js
 *
 * Each check is a pure function over file text so it's inspectable and
 * testable in isolation (see chain-break-audit.test.js).
 */

const fs = require('node:fs');
const path = require('node:path');

function readIfExists(repoRoot, relPath) {
  const p = path.join(repoRoot, relPath);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

// ---------------------------------------------------------------------
// Individual checks. Each returns { id, claim, breakCondition, status,
// detail } where status is 'PASS' | 'FAIL' | 'SKIP' (file missing).
// ---------------------------------------------------------------------

function checkVerifiedAssistantIsDerived(providerChannelText) {
  const id = 'provenance.verifiedAssistant-derived';
  const claim = 'snapshot().provenance.verifiedAssistant reflects whether an assistant message was actually found in the DOM';
  const breakCondition = 'the field is a static literal (verifiedAssistant:true) inside the in-page eval template, not computed from the same text/messageIndex the snapshot just extracted';
  if (providerChannelText == null) return { id, claim, breakCondition, status: 'SKIP', detail: 'provider-channel.js not found' };

  // Look specifically inside the snapshot() eval template string for a
  // literal `verifiedAssistant:true` that is NOT wrapped in a ternary or
  // boolean expression derived from `text`/`messageId`/`messageIndex`.
  const literalMatch = /verifiedAssistant:true(?!\s*[?:])/.test(providerChannelText);
  const derivedMatch = /verifiedAssistant:\s*Boolean\(/.test(providerChannelText) ||
    /verifiedAssistant:\s*\w+\s*\?/.test(providerChannelText);

  if (literalMatch && !derivedMatch) {
    return {
      id, claim, breakCondition,
      status: 'FAIL',
      detail: 'verifiedAssistant:true found as an unconditional literal; no derived (Boolean(...)/ternary) form found alongside it',
    };
  }
  return { id, claim, breakCondition, status: 'PASS', detail: 'no unconditional literal form found' };
}
function checkProvenanceGuardHasNegativeTestCoverage(testFileTexts) {
  const id = 'provenance-guard-negative-coverage';
  const claim = 'the ASSISTANT_PROVENANCE_UNVERIFIED throw path in assertSnapshotTarget-equivalent guard is exercised by at least one test';
  const breakCondition = 'every test fixture that builds a snapshot/provenance object hardcodes verifiedAssistant:true, so the guard\'s false-path is never executed by the suite';

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
    return {
      id, claim, breakCondition,
      status: 'FAIL',
      detail: `verifiedAssistant:true found in ${filesWithTrue.length} test file(s), verifiedAssistant:false found in none — the guard's failure path has zero coverage`,
    };
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
    'src/system/module-registry.js', // static allowlist entry, not a require() call site
  ];

  const hits = [];
  const REF_PATTERN = /TaskStateRouter(?!Bridge)|TaskStateController(?!Bridge)/g;
  for (const [file, text] of Object.entries(allFileTexts)) {
    if (text == null) continue;
    if (ALLOWLISTED_FILES.includes(file)) continue;

    let match;
    REF_PATTERN.lastIndex = 0;
    while ((match = REF_PATTERN.exec(text)) !== null) {
      // A reference only proves reachability if it's a live require/import
      // or direct use. A reference sitting inside a doesNotMatch(...)
      // assertion is evidence FOR unreachability (the test is asserting the
      // string is absent elsewhere), not a positive use -- so check the
      // ~60 chars immediately preceding each match for that context before
      // counting it as a hit. This is a structural check on each match, not
      // a blanket trust of the whole file's presumed purpose.
      const windowStart = Math.max(0, match.index - 60);
      const preceding = text.slice(windowStart, match.index);
      const isInsideAbsenceAssertion = /doesNotMatch\([^)]*$/.test(preceding);
      if (!isInsideAbsenceAssertion) {
        hits.push(`${file}:${match.index}`);
      }
    }
  }

  if (hits.length > 0) {
    return { id, claim, breakCondition, status: 'FAIL', detail: `referenced outside allowlisted files: ${hits.join(', ')}` };
  }
  return { id, claim, breakCondition, status: 'PASS', detail: 'no references outside dead files / static registry declaration' };
}
// ---------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------

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

  // For the TaskStateRouter check we'd ideally scan the whole tree; kept
  // minimal here to the files already implicated by the earlier audit so
  // this is fast and reproducible without a full walk. Extend SCAN_GLOBS
  // if you want tree-wide coverage baked into the script itself.
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

  const results = [
    checkVerifiedAssistantIsDerived(providerChannelText),
    checkProvenanceGuardHasNegativeTestCoverage(testFileTexts),
    checkNoInboundObjectiveExtraction(relayText),
    checkTaskStateRouterUnreachable(routerScanTexts),
  ];

  return results;
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

module.exports = {
  checkVerifiedAssistantIsDerived,
  checkProvenanceGuardHasNegativeTestCoverage,
  checkNoInboundObjectiveExtraction,
  checkTaskStateRouterUnreachable,
  runAudit,
  printReport,
};
