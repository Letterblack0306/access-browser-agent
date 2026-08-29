'use strict';

(() => {
  const rail = document.querySelector('[data-ide-activity-rail]');
  if (!rail) return;

  const targets = Object.freeze({
    files: null,
    agent: '[data-center-tab][data-view="task"]',
    execution: '[data-center-tab][data-view="execution"]',
    editor: '[data-center-tab][data-view="editor"]',
    browser: '[data-center-tab][data-view="loop"]',
    runtime: '[data-center-tab][data-view="runtime"]',
    settings: '[data-center-tab][data-view="settings"]'
  });

  function activate(name) {
    for (const button of rail.querySelectorAll('[data-ide-target]')) {
      const isActive = button.dataset.ideTarget === name;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  rail.addEventListener('click', event => {
    const button = event.target.closest('[data-ide-target]');
    if (!button) return;
    const name = button.dataset.ideTarget;
    const selector = targets[name];
    if (selector) {
      const target = document.querySelector(selector);
      if (target) target.click();
    }
    activate(name);
  });

  activate('files');
})();
