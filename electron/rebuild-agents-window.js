'use strict';

/**
 * Agents Window - VSCode-like multi-session management
 */

(function() {
  const AgentsWindow = {
    storageKey: 'access-agent.agent-sessions.v1',
    sessions: [],
    activeId: null,
    container: null,
    onSelect: null,

    init(containerId, options = {}) {
      this.container = document.getElementById(containerId);
      this.onSelect = options.onSelect;
      this.loadSessions();
      if (this.container) this.render();
    },

    loadSessions() {
      try {
        const saved = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
        this.sessions = Array.isArray(saved) ? saved.slice(0, 50) : [];
      } catch { this.sessions = []; }
    },

    saveSessions() {
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.sessions.slice(0, 50))); } catch {}
    },

    render() {
      if (!this.container) return;
      this.container.innerHTML = `
        <div class="agents-window">
          <div class="agents-header">
            <span class="icon agent-avatar"></span>
            <span class="agents-title">Agent Sessions</span>
            <div class="agents-toolbar">
              <button id="agentNew" title="New Session"><span class="icon plus"></span></button>
              <button id="agentRefresh" title="Refresh"><span class="icon refresh"></span></button>
              <button id="agentSettings" title="Settings"><span class="icon settings"></span></button>
            </div>
          </div>
          <div class="agents-list" id="agentsList">
            <div class="agents-section">
              <div class="agents-section-title">Active</div>
              <div id="agentsActive"></div>
            </div>
            <div class="agents-section">
              <div class="agents-section-title">Recent</div>
              <div id="agentsRecent"></div>
            </div>
          </div>
        </div>
      `;
      document.getElementById('agentNew')?.addEventListener('click', () => this.newSession());
      document.getElementById('agentRefresh')?.addEventListener('click', () => this.refresh());
      this.renderList();
    },

    renderList() {
      const active = this.sessions.filter(s => s.status === 'active' || s.status === 'running');
      const recent = this.sessions.filter(s => s.status !== 'active' && s.status !== 'running').slice(0, 10);
      const activeEl = document.getElementById('agentsActive');
      const recentEl = document.getElementById('agentsRecent');
      if (activeEl) activeEl.innerHTML = active.length ? active.map(s => this.renderCard(s)).join('') : '<div class="notification-empty">No active sessions</div>';
      if (recentEl) recentEl.innerHTML = recent.length ? recent.map(s => this.renderCard(s)).join('') : '<div class="notification-empty">No recent sessions</div>';
      this.bindCardEvents();
    },

    renderCard(session) {
      const isActive = session.id === this.activeId;
      const statusIcon = session.status === 'running' ? 'spinner' : session.status === 'completed' ? 'success' : session.status === 'error' ? 'error' : 'pending';
      return `<div class="agent-card ${isActive ? 'active' : ''}" data-session-id="${session.id}">
        <div class="agent-card-header">
          <div class="agent-card-avatar"><span class="icon agent-avatar icon-xs"></span></div>
          <span class="agent-card-name">${this.escapeHtml(session.name || 'Session')}</span>
          <span class="agent-card-status"><span class="icon ${statusIcon} icon-xs"></span> ${session.status || 'idle'}</span>
        </div>
        <div class="agent-card-task">${this.escapeHtml(session.task || 'No active task')}</div>
        <div class="agent-card-meta">
          <span class="agent-card-badge"><span class="icon model icon-xs"></span> ${this.escapeHtml(session.model || 'default')}</span>
          <span>${this.formatTime(session.updatedAt)}</span>
        </div>
      </div>`;
    },

    bindCardEvents() {
      document.querySelectorAll('.agent-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.getAttribute('data-session-id');
          this.selectSession(id);
        });
      });
    },

    selectSession(id) {
      this.activeId = id;
      this.renderList();
      if (this.onSelect) this.onSelect(id);
    },

    addSession(session) {
      session.id = session.id || `session-${Date.now()}`;
      session.updatedAt = session.updatedAt || new Date().toISOString();
      this.sessions.unshift(session);
      this.saveSessions();
      this.renderList();
    },

    updateSession(id, updates) {
      const session = this.sessions.find(s => s.id === id);
      if (session) {
        Object.assign(session, updates, { updatedAt: new Date().toISOString() });
        this.saveSessions();
        this.renderList();
      }
    },

    newSession() { this.addSession({ name: 'New Session', task: 'Ready', status: 'idle', model: 'default' }); },
    refresh() { this.renderList(); },

    formatTime(iso) {
      if (!iso) return '';
      const date = new Date(iso);
      const now = new Date();
      const diffMs = now - date;
      if (diffMs < 60000) return 'just now';
      if (diffMs < 3600000) return Math.floor(diffMs / 60000) + 'm ago';
      if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + 'h ago';
      return date.toLocaleDateString();
    },

    escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/gu, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  };

  if (typeof window !== 'undefined') window.AgentsWindow = AgentsWindow;
  if (typeof module !== 'undefined' && module.exports) module.exports = AgentsWindow;
})();
