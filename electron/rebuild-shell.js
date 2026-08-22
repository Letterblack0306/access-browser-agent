'use strict';

(function attachRebuildShell(root) {
  const STORAGE_KEY = 'access-agent.rebuild-layout.v1';
  const DEFAULTS = { leftWidth: 248, rightWidth: 332, bottomHeight: 230, centerView: 'task', rightView: 'loop', bottomView: 'terminal' };

  function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || min)); }

  class RebuildShell {
    constructor(doc = document) {
      this.doc = doc;
      this.root = doc.documentElement;
      this.state = this.load();
      this.unsubscribers = [];
      this.rootRule = null;
    }

    load() {
      try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
      catch { return { ...DEFAULTS }; }
    }

    save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); }
      catch { /* layout persistence is best-effort */ }
    }

    mount() {
      this.applyDimensions();
      this.bindTabs('[data-center-tab]', '[data-center-view]', 'centerView');
      this.bindTabs('[data-right-tab]', '[data-right-view]', 'rightView');
      this.bindTabs('[data-bottom-tab]', '[data-bottom-view]', 'bottomView');
      this.bindResizer('left', '--left-w', 'leftWidth', event => clamp(event.clientX, 190, Math.min(420, window.innerWidth * 0.36)));
      this.bindResizer('right', '--right-w', 'rightWidth', event => clamp(window.innerWidth - event.clientX, 260, Math.min(480, window.innerWidth * 0.42)));
      this.bindResizer('bottom', '--bottom-h', 'bottomHeight', event => clamp(window.innerHeight - event.clientY - 22, 150, Math.min(430, window.innerHeight * 0.52)));
      this.handleViewportChange = () => {
        if (this.viewportFrame) cancelAnimationFrame(this.viewportFrame);
        this.viewportFrame = requestAnimationFrame(() => {
          this.viewportFrame = null;
          this.applyDimensions(true);
        });
      };
      window.addEventListener('resize', this.handleViewportChange, { passive: true });
      window.visualViewport?.addEventListener('resize', this.handleViewportChange, { passive: true });
      this.resolutionQuery = window.matchMedia?.('(resolution: 1dppx)') || null;
      this.resolutionQuery?.addEventListener?.('change', this.handleViewportChange);
      const reset = this.doc.getElementById('resetLayout');
      reset?.addEventListener('click', () => this.reset());
      this.activateAll();
      return this;
    }

    findRootRule() {
      if (this.rootRule) return this.rootRule;
      for (const sheet of this.doc.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules || []) {
          if (rule.selectorText === ':root') {
            this.rootRule = rule;
            return rule;
          }
        }
      }
      throw new Error('CSP-safe rebuild :root stylesheet rule is unavailable.');
    }

    setLayoutVariable(name, value) {
      this.findRootRule().style.setProperty(name, `${value}px`);
    }

    viewportLimits() {
      const width = Math.max(960, Number(window.innerWidth) || 960);
      const height = Math.max(640, Number(window.innerHeight) || 640);
      return {
        left: { min: 190, max: Math.max(190, Math.min(420, width * 0.36)) },
        right: { min: 260, max: Math.max(260, Math.min(480, width * 0.42)) },
        bottom: { min: 150, max: Math.max(150, Math.min(430, height * 0.52)) },
      };
    }

    applyDimensions(persist = false) {
      const limits = this.viewportLimits();
      const next = {
        leftWidth: clamp(this.state.leftWidth, limits.left.min, limits.left.max),
        rightWidth: clamp(this.state.rightWidth, limits.right.min, limits.right.max),
        bottomHeight: clamp(this.state.bottomHeight, limits.bottom.min, limits.bottom.max),
      };
      const changed = next.leftWidth !== this.state.leftWidth || next.rightWidth !== this.state.rightWidth || next.bottomHeight !== this.state.bottomHeight;
      Object.assign(this.state, next);
      this.setLayoutVariable('--left-w', next.leftWidth);
      this.setLayoutVariable('--right-w', next.rightWidth);
      this.setLayoutVariable('--bottom-h', next.bottomHeight);
      if (persist && changed) this.save();
    }

    bindTabs(tabSelector, viewSelector, key) {
      for (const tab of this.doc.querySelectorAll(tabSelector)) {
        const handler = () => {
          this.state[key] = tab.dataset.view;
          this.activate(tabSelector, viewSelector, this.state[key]);
          this.save();
        };
        tab.addEventListener('click', handler);
        this.unsubscribers.push(() => tab.removeEventListener('click', handler));
      }
    }

    activate(tabSelector, viewSelector, value) {
      for (const tab of this.doc.querySelectorAll(tabSelector)) {
        const active = tab.dataset.view === value;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      }
      for (const view of this.doc.querySelectorAll(viewSelector)) {
        const active = view.dataset.view === value;
        view.hidden = !active;
        view.classList.toggle('is-active', active);
      }
    }

    activateAll() {
      this.activate('[data-center-tab]', '[data-center-view]', this.state.centerView);
      this.activate('[data-right-tab]', '[data-right-view]', this.state.rightView);
      this.activate('[data-bottom-tab]', '[data-bottom-view]', this.state.bottomView);
    }

    bindResizer(name, cssVar, key, resolve) {
      const handle = this.doc.querySelector(`[data-resizer="${name}"]`);
      if (!handle) return;
      let dragging = false;
      const move = event => {
        if (!dragging) return;
        this.state[key] = resolve(event);
        this.setLayoutVariable(cssVar, this.state[key]);
      };
      const up = () => {
        if (!dragging) return;
        dragging = false;
        this.doc.body.classList.remove('is-resizing');
        this.save();
      };
      const down = event => {
        event.preventDefault();
        dragging = true;
        this.doc.body.classList.add('is-resizing');
      };
      handle.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      handle.addEventListener('keydown', event => {
        const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -12 : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 12 : 0;
        if (!delta) return;
        event.preventDefault();
        const limits = this.viewportLimits()[name === 'bottom' ? 'bottom' : name];
        const { min, max } = limits;
        this.state[key] = clamp(this.state[key] + delta, min, max);
        this.setLayoutVariable(cssVar, this.state[key]);
        this.save();
      });
      this.unsubscribers.push(() => {
        handle.removeEventListener('pointerdown', down);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      });
    }

    showCenter(view) {
      this.state.centerView = view;
      this.activate('[data-center-tab]', '[data-center-view]', view);
      this.save();
    }

    showRight(view) {
      this.state.rightView = view;
      this.activate('[data-right-tab]', '[data-right-view]', view);
      this.save();
    }

    showBottom(view) {
      this.state.bottomView = view;
      this.activate('[data-bottom-tab]', '[data-bottom-view]', view);
      this.save();
    }

    reset() {
      this.state = { ...DEFAULTS };
      this.applyDimensions();
      this.activateAll();
      this.save();
    }

    dispose() {
      if (this.viewportFrame) cancelAnimationFrame(this.viewportFrame);
      window.removeEventListener('resize', this.handleViewportChange);
      window.visualViewport?.removeEventListener('resize', this.handleViewportChange);
      this.resolutionQuery?.removeEventListener?.('change', this.handleViewportChange);
      for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    }
  }

  const api = Object.freeze({ RebuildShell, DEFAULTS });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RebuildShell = RebuildShell;
})(typeof window !== 'undefined' ? window : globalThis);
