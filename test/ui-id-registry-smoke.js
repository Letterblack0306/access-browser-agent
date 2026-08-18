'use strict';

const assert = require('node:assert/strict');
const { assertAllowedUiId, allowedUiIds } = require('../src/system/ui-id-registry');

try {
  const ids = allowedUiIds();
  assert.ok(ids.length > 0, 'expected registered ui ids');

  // Known id must be allowed.
  assert.doesNotThrow(() => assertAllowedUiId('chooseWorkspace'));

  // Unknown id must be blocked.
  assert.throws(() => assertAllowedUiId('not-registered-button'), /blocked untracked element id/);

  console.log('ui-id-registry-smoke: PASS');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
