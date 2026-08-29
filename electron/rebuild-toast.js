'use strict';

/**
 * Toast Notification System
 * VSCode-like non-intrusive notifications
 */

(function() {
  const TOAST_TYPES = {
    success: { icon: 'success', defaultTitle: 'Success' },
    error: { icon: 'error', defaultTitle: 'Error' },
    warning: { icon: 'warning', defaultTitle: 'Warning' },
    info: { icon: 'info', defaultTitle: 'Info' }
  };

  const DEFAULT_DURATION = 5000;
  const MAX_TOASTS = 5;

  let container = null;
  const toasts = new Map();
  let idCounter = 0;

  function ensureContainer() {
    if (container && document.body.contains(container)) return container;
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(container);
    return container;
  }

  function createToast(options) {
    const id = ++idCounter;
    const type = options.type || 'info';
    const typeConfig = TOAST_TYPES[type] || TOAST_TYPES.info;
    const duration = options.duration !== undefined ? options.duration : DEFAULT_DURATION;

    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', 'status');
    el.setAttribute('data-toast-id', id);
    el.innerHTML = `
      <span class="icon ${typeConfig.icon} toast-icon"></span>
      <div class="toast-body">
        <div class="toast-title">${escapeHtml(options.title || typeConfig.defaultTitle)}</div>
        ${options.message ? `<div class="toast-message">${escapeHtml(options.message)}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Dismiss">
        <span class="icon close"></span>
      </button>
    `;

    const close = () => removeToast(id);
    el.querySelector('.toast-close').addEventListener('click', close);

    if (duration > 0) {
      el.dataset.timeout = setTimeout(close, duration);
    }

    if (options.onClick) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        if (!e.target.closest('.toast-close')) options.onClick();
      });
    }

    return { id, el, type, close };
  }

  function addToast(options) {
    const c = ensureContainer();
    const toast = createToast(options);

    // Limit number of toasts
    if (toasts.size >= MAX_TOASTS) {
      const firstId = toasts.keys().next().value;
      removeToast(firstId);
    }

    c.appendChild(toast.el);
    toasts.set(toast.id, toast);
    return toast.id;
  }

  function removeToast(id) {
    const toast = toasts.get(id);
    if (!toast) return;

    if (toast.el.dataset.timeout) clearTimeout(Number(toast.el.dataset.timeout));
    toast.el.classList.add('removing');
    setTimeout(() => {
      toast.el.remove();
      toasts.delete(id);
    }, 200);
  }

  function clearAll() {
    for (const id of toasts.keys()) removeToast(id);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/gu, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  // Public API
  const api = {
    show: addToast,
    success: (message, title) => api.show({ type: 'success', message, title }),
    error: (message, title) => api.show({ type: 'error', message, title }),
    warning: (message, title) => api.show({ type: 'warning', message, title }),
    info: (message, title) => api.show({ type: 'info', message, title }),
    dismiss: removeToast,
    clear: clearAll
  };

  if (typeof window !== 'undefined') {
    window.Toast = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
