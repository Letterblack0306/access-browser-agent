'use strict';
// Rebuild UI zoom — a footer slider that scales the whole workbench with CSS
// `zoom` on the root element, persisted across launches via localStorage.
// CSP-safe: all logic lives in this external file (script-src 'self'); styling
// lives in rebuild-ui-stability.css (style-src 'self'); no inline handlers.
(function attachRebuildZoom(root) {
  const STORAGE_KEY = 'access-agent.rebuild-ui-zoom.v1';
  const MIN = 70;
  const MAX = 150;
  const STEP = 5;

  function clamp(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 100;
    const stepped = Math.round(numeric / STEP) * STEP;
    return Math.min(MAX, Math.max(MIN, stepped));
  }

  function apply(percent, { persist = true } = {}) {
    const pct = clamp(percent);
    if (root.document && document.documentElement) {
      // Chromium's `zoom` property scales layout + text for the entire app.
      document.documentElement.style.zoom = String(pct / 100);
    }
    const valueNode = document.getElementById('uiZoomValue');
    if (valueNode) valueNode.textContent = `${pct}%`;
    const range = document.getElementById('uiZoomRange');
    if (range) range.value = String(pct);
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, String(pct)); } catch { /* best-effort */ }
    }
  }

  function current() {
    const range = document.getElementById('uiZoomRange');
    const base = Number(range ? range.value : NaN);
    if (Number.isFinite(base)) return clamp(base);
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(stored)) return clamp(stored);
    } catch { /* ignore */ }
    return 100;
  }

  function init() {
    apply(current(), { persist: false });
    const range = document.getElementById('uiZoomRange');
    const out = document.getElementById('uiZoomOut');
    const inBtn = document.getElementById('uiZoomIn');
    range?.addEventListener('input', () => apply(Number(range.value)));
    out?.addEventListener('click', () => apply(current() - STEP));
    inBtn?.addEventListener('click', () => apply(current() + STEP));
  }

  if (root.document && (document.readyState === 'loading')) {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else if (root.document) {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);