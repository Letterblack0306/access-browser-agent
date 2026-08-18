'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const POLL_MS = 5000;
  let pollTimer = null;

  function elements() {
    return {
      button: byId('sendBirdEye'),
      status: byId('birdEyeStatus')
    };
  }

  function labelFor(result = {}) {
    if (result.state === 'idle') return 'BirdEye idle';
    if (result.state === 'local_created') return 'BirdEye local only';
    if (result.state === 'queued') return 'BirdEye queued';
    if (result.state === 'failed') return 'BirdEye failed';
    if (result.state === 'status_failed') return 'BirdEye status failed';
    if (result.responseAvailable && result.indexed) return 'BirdEye indexed';
    if (result.responseAvailable || result.received) return 'BirdEye received';
    return `BirdEye ${String(result.state || 'unknown').replaceAll('_', ' ')}`;
  }

  function titleFor(result = {}) {
    return [
      result.requestId ? `request ${result.requestId}` : '',
      result.machineId ? `machine ${result.machineId}` : '',
      result.verdict ? `verdict ${result.verdict}` : '',
      result.error || ''
    ].filter(Boolean).join(' · ') || 'No BirdEye request yet';
  }

  function render(result = {}) {
    const { status } = elements();
    if (!status) return;
    status.textContent = labelFor(result);
    status.title = titleFor(result);
    status.dataset.state = String(result.state || 'unknown');
    status.dataset.received = String(result.received === true);
    status.dataset.indexed = String(result.indexed === true);
  }

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function shouldPoll(result = {}) {
    return result.state === 'queued' && result.responseAvailable !== true;
  }

  async function refresh() {
    let result;
    try {
      result = await window.accessIde.birdEyeStatus();
    } catch (error) {
      result = { ok: false, state: 'status_failed', error: error?.message || String(error) };
    }
    render(result);
    stopPolling();
    if (shouldPoll(result)) pollTimer = setTimeout(refresh, POLL_MS);
    return result;
  }

  async function send(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const { button, status } = elements();
    if (button) button.disabled = true;
    if (status) {
      status.textContent = 'BirdEye sending…';
      status.dataset.state = 'sending';
    }
    stopPolling();
    try {
      const result = await window.accessIde.sendBirdEye();
      render(result);
      if (shouldPoll(result)) pollTimer = setTimeout(refresh, POLL_MS);
    } catch (error) {
      render({ ok: false, state: 'failed', error: error?.message || String(error) });
    } finally {
      if (button) button.disabled = false;
    }
  }

  function start() {
    const { button } = elements();
    if (!button || !window.accessIde?.birdEyeStatus) return;
    // Capture-phase ownership supersedes the legacy renderer click listener
    // without creating a second BirdEye transport or handoff service.
    button.addEventListener('click', send, { capture: true });
    refresh();
  }

  window.BirdEyeStatusView = Object.freeze({ labelFor, titleFor, render, refresh, start });
  start();
})();
