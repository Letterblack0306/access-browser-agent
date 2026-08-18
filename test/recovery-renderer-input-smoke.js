'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rendererPath = path.join(__dirname, '..', 'electron', 'rebuild-renderer.js');
const source = fs.readFileSync(rendererPath, 'utf8');

assert(!source.includes('window.prompt('), 'Recovery renderer must not use unsupported window.prompt().');
assert(source.includes('requestRecoveryInput('), 'Recovery renderer must use the controlled recovery input helper.');
assert(source.includes("api.browserRecoveryReconcile({key,disposition,reason,operator:'local-operator',evidenceRefs})"), 'Recovery renderer must preserve the existing reconciliation IPC payload.');
assert(source.includes("if(disposition==='proven_complete')"), 'Proven-complete recovery must keep its evidence-specific path.');
assert(source.includes('RECOVERY_EVIDENCE_INVALID'), 'Malformed recovery evidence must be rejected before reconciliation IPC.');

const start = source.indexOf('async function reconcileRecoveryAction(button) {');
const end = source.indexOf('\n\n  function diagnosticMatches', start);
assert(start >= 0 && end > start, 'Recovery reconciliation handler must remain extractable for focused behavior testing.');
const handlerSource = source.slice(start, end);

function makeHarness(inputs) {
  const calls = [];
  const queue = [...inputs];
  const context = {
    requestRecoveryInput: async () => queue.shift(),
    api: {
      browserRecoveryReconcile: async payload => {
        calls.push(payload);
        return { receipt:{ instructionId:'turn-test' } };
      },
    },
    Projection: { withEvent: value => value },
    state: {},
    render: () => {},
    refreshStatus: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(`${handlerSource}; this.reconcileRecoveryAction = reconcileRecoveryAction;`, context);
  return { context, calls };
}

(async () => {
  {
    const { context, calls } = makeHarness(['evidence-backed abandonment']);
    await context.reconcileRecoveryAction({ dataset:{ recoveryKey:'journal-key', recoveryAction:'abandoned' } });
    assert.strictEqual(calls.length, 1, 'Abandon with a reason must invoke reconciliation exactly once.');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0])), {
      key:'journal-key',
      disposition:'abandoned',
      reason:'evidence-backed abandonment',
      operator:'local-operator',
      evidenceRefs:[],
    });
  }

  {
    const { context, calls } = makeHarness(['   ']);
    await context.reconcileRecoveryAction({ dataset:{ recoveryKey:'journal-key', recoveryAction:'abandoned' } });
    assert.strictEqual(calls.length, 0, 'Blank recovery reason must not invoke reconciliation.');
  }

  {
    const { context, calls } = makeHarness([null]);
    await context.reconcileRecoveryAction({ dataset:{ recoveryKey:'journal-key', recoveryAction:'quarantined' } });
    assert.strictEqual(calls.length, 0, 'Cancelled recovery input must not invoke reconciliation.');
  }

  {
    const { context, calls } = makeHarness(['completion reason', '{not-json']);
    await assert.rejects(
      () => context.reconcileRecoveryAction({ dataset:{ recoveryKey:'journal-key', recoveryAction:'proven_complete' } }),
      error => error?.code === 'RECOVERY_EVIDENCE_INVALID',
      'Malformed proven-complete evidence must fail before IPC.',
    );
    assert.strictEqual(calls.length, 0, 'Malformed proven-complete evidence must not invoke reconciliation.');
  }

  console.log('recovery-renderer-input-smoke: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
