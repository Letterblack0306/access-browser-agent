'use strict';

(() => {
  const rail = document.querySelector('[data-ide-activity-rail]');
  if (!rail) return;

  const targets = Object.freeze({
    files: null,
    agent: '[data-center-tab][data-view="task"]',
    execution: '[data-center-tab][data-view="execution"]',
    editor: '[data-center-tab][data-view="editor"]',
    browser: '[data-right-tab][data-view="loop"]',
    runtime: '[data-right-tab][data-view="runtime"]',
    settings: '[data-right-tab][data-view="settings"]',
  });

  function activate(name) {
    for (const button of rail.querySelectorAll('[data-ide-target]')) {
      button.classList.toggle('is-active', button.dataset.ideTarget === name);
      button.setAttribute('aria-pressed', String(button.dataset.ideTarget === name));
    }
  }

  rail.addEventListener('click', event => {
    const button = event.target.closest('[data-ide-target]');
    if (!button) return;
    const name = button.dataset.ideTarget;
    const selector = targets[name];
    if (selector) document.querySelector(selector)?.click();
    activate(name);
  });

  document.addEventListener('click', event => {
    const center = event.target.closest('[data-center-tab]');
    if (center) {
      const view = center.dataset.view;
      activate(view === 'task' ? 'agent' : view);
      return;
    }
    const right = event.target.closest('[data-right-tab]');
    if (right) activate(right.dataset.view === 'loop' ? 'browser' : right.dataset.view);
  });

  activate('files');
})();
