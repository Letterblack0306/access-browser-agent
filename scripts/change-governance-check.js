'use strict';

const path = require('node:path');
const { ChangeGovernanceGuard } = require('../src/agent/guards/ChangeGovernanceGuard');

const root = path.resolve(__dirname, '..');
const guard = new ChangeGovernanceGuard({ workspaceRoot:root });
const state = guard.validateRepository();
if (!state.ok) {
  console.error(`CHANGE_GOVERNANCE_BLOCKED ${state.code}: ${state.message}`);
  process.exit(1);
}
console.log(`change-governance: PASS (${state.rows.length} change record(s); active=${state.active?.changeId || 'none'})`);
