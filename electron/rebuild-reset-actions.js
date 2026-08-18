'use strict';

(function attachResetActions(root) {
  const ACTION_TARGETS = Object.freeze({
    'browser-session':'recoverLoop',
    runtime:'runtimeRestart',
    layout:'resetLayout',
    'stop-all':'stopAll',
  });

  function bindResetActions(doc = document) {
    const select = doc.getElementById('resetActions');
    if (!select) return () => {};

    const onChange = () => {
      const action = String(select.value || '');
      select.value = '';
      if (!action) return;
      const targetId = ACTION_TARGETS[action];
      const target = targetId ? doc.getElementById(targetId) : null;
      if (!target || typeof target.click !== 'function') return;
      target.click();
    };

    select.addEventListener('change', onChange);
    return () => select.removeEventListener('change', onChange);
  }

  const api = Object.freeze({ ACTION_TARGETS, bindResetActions });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.RebuildResetActions = api;
    if (typeof document !== 'undefined') bindResetActions(document);
  }
})(typeof window !== 'undefined' ? window : globalThis);
