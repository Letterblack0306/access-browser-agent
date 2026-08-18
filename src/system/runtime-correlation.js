'use strict';

const { randomUUID, createHash } = require('node:crypto');

function newId(prefix) {
  return `${String(prefix || 'id')}-${randomUUID()}`;
}

function conversationIdFromUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const identity = `${url.origin}${url.pathname.replace(/\/+$/u, '') || '/'}`;
    return `conversation-${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
  } catch {
    return null;
  }
}

function createCorrelation(input = {}) {
  return Object.freeze({
    conversationId: input.conversationId || conversationIdFromUrl(input.chatUrl || input.url) || null,
    sessionId: input.sessionId || null,
    instructionId: input.instructionId || null,
    turnId: input.turnId || null,
    operationId: input.operationId || newId('operation'),
    toolCallId: input.toolCallId || null,
    browserInstanceId: input.browserInstanceId || null,
    targetId: input.targetId || null,
    deliveryId: input.deliveryId || null,
    providerRequestId: input.providerRequestId || null,
  });
}

function extendCorrelation(base = {}, patch = {}) {
  return createCorrelation({ ...base, ...patch, operationId: patch.operationId || base.operationId || undefined });
}

function compactCorrelation(value = {}) {
  const out = {};
  for (const key of [
    'conversationId','sessionId','instructionId','turnId','operationId','toolCallId',
    'browserInstanceId','targetId','deliveryId','providerRequestId',
  ]) {
    if (value[key]) out[key] = String(value[key]);
  }
  return out;
}

module.exports = { newId, conversationIdFromUrl, createCorrelation, extendCorrelation, compactCorrelation };
