'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { createCorrelation, compactCorrelation } = require('./runtime-correlation');

const storage = new AsyncLocalStorage();

function runWithCorrelation(input, task) {
  if (typeof task !== 'function') throw new TypeError('Correlation task must be a function.');
  const parent = storage.getStore() || {};
  const correlation = createCorrelation({ ...parent, ...(input || {}), operationId:input?.operationId || parent.operationId || undefined });
  return storage.run(correlation, task);
}

function currentCorrelation() {
  return compactCorrelation(storage.getStore() || {});
}

module.exports = { runWithCorrelation, currentCorrelation };
