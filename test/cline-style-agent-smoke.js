'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const unified=fs.readFileSync(path.join(root,'src','agent','executive','UnifiedAgentService.js'),'utf8');
const adapter=fs.readFileSync(path.join(root,'electron','agent-runtime-adapter.js'),'utf8');
const settings=fs.readFileSync(path.join(root,'electron','rebuild-settings.js'),'utf8');

assert.doesNotMatch(unified,/require\(['"]\.\.\/ClineStyleAgentCore['"]\)/u,'active runtime must not import the chained Cline-style engine');
assert.doesNotMatch(unified,/new ClineStyleAgentCore/u);
assert.doesNotMatch(unified,/_pendingApprovals/u);
assert.doesNotMatch(unified,/_requestApproval/u);
assert.doesNotMatch(unified,/waiting_for_approval/u);
assert.match(unified,/new LiveAgentCore/u,'one adaptive reasoning engine must own live semantics');
assert.match(unified,/APPROVAL_WORKFLOW_REMOVED/u,'legacy approval calls fail explicitly instead of creating a hidden wait');
assert.doesNotMatch(adapter,/useClineStyle\s*:/u,'provider choice must not switch reasoning architecture');
assert.doesNotMatch(settings,/useClineStyle/u,'fresh UI must not expose alternate semantic engine selection');

console.log('inactive chained-agent architecture smoke: PASS');
