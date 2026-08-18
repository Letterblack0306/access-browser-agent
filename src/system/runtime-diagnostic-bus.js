'use strict';

const { compactCorrelation } = require('./runtime-correlation');
const { currentCorrelation } = require('./runtime-correlation-context');

let sink = null;
const listeners = new Set();

function setDiagnosticSink(next) {
  sink = next && typeof next.write === 'function' ? next : null;
  return Boolean(sink);
}

function diagnosticSink() {
  return sink;
}

function subscribeDiagnostic(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(record) {
  if (!record || record.suppressed === true) return;
  for (const listener of listeners) {
    try { listener(record); } catch { /* diagnostics must never own runtime lifecycle */ }
  }
}

function emitDiagnostic(input = {}) {
  if (!sink) return null;
  try {
    const inherited = compactCorrelation(currentCorrelation());
    const explicit = compactCorrelation(input.correlation || {});
    const record = sink.write({
      ...input,
      correlation: { ...inherited, ...explicit },
    });
    notify(record);
    return record;
  } catch {
    return null;
  }
}

function diagnosticProducer(source, defaults = {}) {
  return (input = {}) => emitDiagnostic({
    ...defaults,
    ...input,
    source: input.source || source,
    correlation: { ...(defaults.correlation || {}), ...(input.correlation || {}) },
  });
}

module.exports = { setDiagnosticSink, diagnosticSink, subscribeDiagnostic, emitDiagnostic, diagnosticProducer };
