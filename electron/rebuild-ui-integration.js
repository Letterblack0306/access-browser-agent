'use strict';

/**
 * UI Integration - Wires ChatView, AgentsWindow, Toast, and notifications
 * into the workbench. Loaded after rebuild-renderer.js.
 */

(() => {
  const notifications = [];
  let unreadCount = 0;

  function $(id) { return document.getElementById(id); }

  // ── Toast → notification center bridge ──
  function recordNotification(type, title, message) {
    notifications.unshift({ type, title, message, time: new Date().toISOString(), read: false });
    if (notifications.length > 50) notifications.pop();
    unreadCount += 1;
    updateBadge();
  }

  function updateBadge() {
    const badge = $('notificationBadge');
    if (!badge) return;
    badge.hidden = unreadCount === 0;
    badge.textContent = String(unreadCount);
  }

  function renderNotificationCenter() {
    const center = $('notificationCenter');
    if (!center) return;
    if (center.hidden) { center.hidden = false; } else { center.hidden = true; return; }
    unreadCount = 0;
    updateBadge();

    const list = notifications.length
      ? notifications.map(n => {
          const time = new Date(n.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
          return `<div class="notification-item">
            <span class="icon ${n.type} notification-item-icon"></span>
            <div class="notification-item-body">
              <div class="notification-item-title">${escapeHtml(n.title || '')}</div>
              <div class="notification-item-message">${escapeHtml(n.message || '')}</div>
              <div class="notification-item-time">${time}</div>
            </div>
          </div>`;
        }).join('')
      : '<div class="notification-empty"><span class="icon bell icon-xl" style="opacity:.3"></span>No notifications</div>';

    center.innerHTML = `
      <div class="notification-center-header">
        <span class="icon bell icon-sm"></span>
        <span class="notification-center-title">Notifications</span>
        <button id="clearNotifications" class="control compact" type="button">Clear</button>
      </div>
      <div class="notification-center-list">${list}</div>
    `;

    $('clearNotifications')?.addEventListener('click', () => { notifications.length = 0; center.hidden = true; updateBadge(); });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/gu, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  // ── Boot integration ──
  function boot() {
    // Toast system
    if (window.Toast) {
      const originalShow = window.Toast.show.bind(window.Toast);
      const recordAndShow = (options) => {
        recordNotification(options.type || 'info', options.title || '', options.message || '');
        return originalShow(options);
      };
      window.Toast.show = recordAndShow;
      for (const type of ['success', 'error', 'warning', 'info']) {
        const original = window.Toast[type].bind(window.Toast);
        window.Toast[type] = (message, title) => {
          recordNotification(type, title || '', message || '');
          return original(message, title);
        };
      }
    }

    // Notification center toggle
    $('notificationsBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      renderNotificationCenter();
    });
    document.addEventListener('click', (e) => {
      const center = $('notificationCenter');
      if (center && !center.hidden && !e.target.closest('#notificationCenter') && !e.target.closest('#notificationsBtn')) {
        center.hidden = true;
      }
    });

    // Chat view
    if (window.ChatView) {
      window.ChatView.init('chatViewContainer', {
        onSend: async (text) => {
          if (window.Toast) window.Toast.info('Instruction queued', text.slice(0, 80));
          // Route to existing instruction path if available
          const input = $('instructionInput') || $('chatUrl');
          if (window.accessAgentRuntime?.start) {
            try { await window.accessAgentRuntime.start({ instruction: text, text, source: 'chat-view' }); } catch (error) {
              window.Toast.error('Instruction failed', error.message);
            }
          }
        }
      });
      // Seed chat with system message
      window.ChatView.addMessage({
        role: 'system',
        content: 'Chat view ready. Submit instructions here; agent and tool activity will stream inline.',
        timestamp: new Date().toISOString()
      });
    }

    // Agents window
    if (window.AgentsWindow) {
      window.AgentsWindow.init('agentsViewContainer', {
        onSelect: (id) => {
          if (window.Toast) window.Toast.info('Session selected', id);
        }
      });
      window.AgentsWindow.addSession({
        id: 'session-main',
        name: 'Main Session',
        task: 'Browser loop idle',
        status: 'idle',
        model: 'default'
      });
    }

    const settingsSearch = $('settingsSearch');
    const settingsClear = $('settingsSearchClear');
    const filterSettings = () => {
      const query = String(settingsSearch?.value || '').trim().toLowerCase();
      if (settingsClear) settingsClear.hidden = !query;
      document.querySelectorAll('[data-view="settings"] .section').forEach(section => {
        section.hidden = Boolean(query) && !section.textContent.toLowerCase().includes(query);
      });
    };
    settingsSearch?.addEventListener('input', filterSettings);
    settingsClear?.addEventListener('click', () => { if (settingsSearch) settingsSearch.value = ''; filterSettings(); settingsSearch?.focus(); });

    // Wire agent events into chat as tool calls
    if (window.ChatView && window.accessIde?.onDiagnosticRecord) {
      window.accessIde.onDiagnosticRecord((record) => {
        const category = String(record?.category || '').toLowerCase();
        if (category !== 'tool') return;
        const phase = String(record?.phase || '').toLowerCase();
        const name = record?.data?.toolName || 'Tool';
        const callId = record?.correlation?.requestId || record?.correlation?.turnId || record?.data?.requestId || record?.data?.turnId || name;
        if (phase === 'start') {
          window.ChatView.addToolCall({ id: callId, name, status: 'running', arguments: record.data });
        } else if (phase === 'success' || phase === 'failed' || phase === 'observed') {
          if (!window.ChatView.updateToolCall(callId, {
            name,
            status: phase === 'success' ? 'success' : phase === 'failed' ? 'error' : 'pending',
            duration: record.durationMs,
            result: record.error || { observation: record.data?.observation }
          })) window.ChatView.addToolCall({
            id: callId,
            name,
            status: phase === 'success' ? 'success' : phase === 'failed' ? 'error' : 'pending',
            duration: record.durationMs,
            arguments: record.data,
            result: record.error || { observation: record.data?.observation }
          });
        }
      });
    }

    window.accessIde?.onAgentEvent?.((event) => {
      const phase = String(event?.phase || event?.type || '').toLowerCase();
      const sessionId = event?.sessionId || event?.session_id || event?.correlation?.sessionId || 'session-main';
      const status = phase.includes('failed') || phase.includes('error') ? 'error'
        : phase.includes('completed') || phase.includes('complete') ? 'completed'
        : phase.includes('started') || phase.includes('running') || phase.includes('turn') ? 'running'
        : 'idle';
      const task = event?.detail || event?.message || event?.objective || phase.replaceAll('_', ' ');
      window.AgentsWindow?.updateSession(sessionId, { status, task });
      if (status === 'error') window.Toast?.error(task, 'Agent session');
      else if (status === 'completed') window.Toast?.success(task, 'Agent session');
      if (phase.includes('assistant') || phase.includes('agent') || phase.includes('final')) {
        const content = event?.content || event?.message || event?.detail || event?.text;
        if (content) window.ChatView?.addMessage({ role: 'agent', content, timestamp: new Date().toISOString() });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
