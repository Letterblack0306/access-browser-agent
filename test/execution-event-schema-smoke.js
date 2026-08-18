'use strict';

const assert = require('node:assert/strict');
const { createExecutionEvent } = require('../src/agent/executive/ExecutionEventSchema');

const event = createExecutionEvent({
  sessionId: 'session-1', turnId: 'turn-1', stepId: 'step-1', toolCallId: 'call-1',
  moduleId: 'browser-automation', type: 'execution.tool.started', status: 'running',
});
assert.equal(event.moduleId, 'browser-automation');
assert.deepEqual(event.blockerIds, []);

const phaseEvent = createExecutionEvent({
  sessionId: 'session-1', turnId: 'turn-1', stepId: 'step-1', toolCallId: 'phase-1',
  moduleId: 'agent-executive', type: 'execution.phase.changed', status: 'running',
  inputSummary: { from: 'planning', to: 'execution' },
});
assert.equal(phaseEvent.type, 'execution.phase.changed');
assert.deepEqual(phaseEvent.inputSummary, { from: 'planning', to: 'execution' });

for (const crossDomainStatus of ['observed','executing','result_queued','delivering','delivered','delivery_unverified','degraded','unverified']) {
  assert.throws(
    () => createExecutionEvent({ ...event, status: crossDomainStatus }),
    new RegExp(`Unsupported execution event status: ${crossDomainStatus}`),
    `${crossDomainStatus} belongs outside the execution lifecycle status domain`,
  );
}
assert.throws(() => createExecutionEvent({ ...event, status: 'unknown' }), /Unsupported execution event status/);
assert.throws(() => createExecutionEvent({ ...event, type: 'execution.invalid' }), /Unsupported execution event type/);
assert.throws(() => createExecutionEvent({ ...event, sessionId: '' }), /sessionId is required/);
console.log('execution-event-schema-smoke: PASS');
