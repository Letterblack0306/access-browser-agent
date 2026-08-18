'use strict';

(() => {
  const PRESS_MS = 180;
  const STATUS_MS = 900;
  const byId = id => document.getElementById(id);
  let clearStatusTimer = null;

  function actionLabel(button) {
    return String(
      button.getAttribute('aria-label') ||
      button.title ||
      button.textContent ||
      button.id ||
      'Action'
    ).replace(/\s+/gu, ' ').trim();
  }

  function ensureStatusSurface() {
    const statusbar = document.querySelector('.statusbar');
    if (!statusbar) return null;
    let status = byId('uiActionStatus');
    if (status) return status;
    status = document.createElement('span');
    status.id = 'uiActionStatus';
    status.hidden = true;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    statusbar.append(status);
    return status;
  }

  function showStatus(message, state = 'active') {
    const status = ensureStatusSurface();
    if (!status) return;
    status.textContent = message;
    status.dataset.uiState = state;
    status.hidden = false;
    clearTimeout(clearStatusTimer);
    clearStatusTimer = setTimeout(() => {
      status.hidden = true;
      status.textContent = '';
      status.dataset.uiState = 'idle';
    }, STATUS_MS);
  }

  function watchBusy(button, label) {
    if (!button.disabled) return false;
    button.dataset.actionFeedback = 'busy';
    showStatus(`WORKING · ${label}`, 'active');

    const observer = new MutationObserver(() => {
      if (button.disabled) return;
      observer.disconnect();
      button.dataset.actionFeedback = 'resolved';
      window.setTimeout(() => {
        if (button.dataset.actionFeedback === 'resolved') delete button.dataset.actionFeedback;
      }, PRESS_MS);
    });
    observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
    return true;
  }

  function acknowledge(button) {
    if (!button || button.disabled || button.dataset.actionFeedback === 'busy') return;
    const label = actionLabel(button);
    button.dataset.actionFeedback = 'pressed';
    showStatus(`ACTION · ${label}`, 'active');

    window.setTimeout(() => {
      if (watchBusy(button, label)) return;
      if (button.dataset.actionFeedback === 'pressed') delete button.dataset.actionFeedback;
    }, 0);
  }

  function start() {
    ensureStatusSurface();
    document.addEventListener('click', event => {
      const button = event.target?.closest?.('button');
      if (!button) return;
      acknowledge(button);
    }, { capture: true });
  }

  window.ActionFeedback = Object.freeze({ actionLabel, acknowledge, start });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
