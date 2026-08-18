'use strict';

const moduleRegistry = globalThis.__moduleRegistry || require('./module-registry');
const originalRequire = require('module').createRequire(__filename);

function createRequire(from) {
  const baseRequire = require('module').createRequire(from);
  return function require(id) {
    moduleRegistry.assertAllowed(id);
    return baseRequire(id);
  };
}

function createEvalRequire(filename) {
  const baseRequire = require('module').createRequire(filename);
  return function require(id) {
    moduleRegistry.assertAllowed(id);
    return baseRequire(id);
  };
}

module.exports = { createRequire, createEvalRequire };
