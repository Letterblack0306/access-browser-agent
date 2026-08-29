'use strict';

/**
 * Chat View - VSCode-like conversation interface
 */

(function() {
  const ChatView = {
    messages: [], container: null, onSend: null,

    init(containerId, options = {}) {
      this.container = document.getElementById(containerId);
      if (!this.container) return;
      this.onSend = options.onSend;
      this.render();
      this.bindEvents();
    },

    render() {
      if (!this.container) return;
      this.container.innerHTML = `
        <div class="chat-view">
          <div class="chat-messages" id="chatMessages"></div>
          <div class="chat-input-area">
            <div class="chat-input-wrapper">
              <div class="context-mentions" id="chatMentions" hidden></div>
              <div class="chat-input-row">
                <textarea class="chat-input" id="chatInput" rows="1" placeholder="Ask Agent anything"></textarea>
                <div class="chat-input-actions">
                  <button class="chat-input-btn" id="chatAttach" title="Attach context"><span class="icon attach"></span></button>
                  <button class="chat-input-btn primary" id="chatSend" title="Send"><span class="icon send"></span></button>
                </div>
              </div>
              <div class="chat-input-hint"><span>Enter to send, Shift+Enter for new line</span><span style="margin-left:auto"><kbd>@</kbd> files</span></div>
            </div>
          </div>
        </div>
      `;
    },

    bindEvents() {
      const input = document.getElementById('chatInput');
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });
      }
      document.getElementById('chatSend')?.addEventListener('click', () => this.sendMessage());
      document.getElementById('chatAttach')?.addEventListener('click', () => console.log('Attach menu'));
      document.getElementById('chatMessages')?.addEventListener('click', (event) => {
        const detailHeader = event.target.closest('.tool-call-details-header');
        if (detailHeader) {
          const details = detailHeader.closest('.tool-call-details');
          details?.classList.toggle('open');
          const icon = detailHeader.querySelector('.icon');
          icon?.classList.toggle('chevron-down', !details?.classList.contains('open'));
          icon?.classList.toggle('chevron-up', details?.classList.contains('open'));
          return;
        }
        const stepsHeader = event.target.closest('.steps-header');
        if (stepsHeader) {
          const section = stepsHeader.closest('.steps-section');
          const list = section?.querySelector('.steps-list');
          const open = section?.classList.toggle('open') === true;
          if (list) list.hidden = !open;
          const icon = stepsHeader.querySelector('.icon');
          icon?.classList.toggle('chevron-down', !open);
          icon?.classList.toggle('chevron-up', open);
          return;
        }
        const action = event.target.closest('[data-chat-action]');
        if (!action) return;
        const block = action.closest('.message-code-block');
        const code = block?.querySelector('.message-code-body')?.textContent || '';
        if (action.dataset.chatAction === 'copy') {
          navigator.clipboard?.writeText(code).then(() => window.Toast?.success('Code copied', 'Chat'));
        } else if (action.dataset.chatAction === 'insert') {
          const input = document.getElementById('chatInput');
          if (input) { input.value += (input.value ? '\n\n' : '') + code; input.focus(); }
        }
      });
    },

    updateToolCall(id, updates = {}) {
      const message = this.messages.find(item => item.role === 'tool' && item.toolCall?.id === id);
      if (!message) return false;
      Object.assign(message.toolCall, updates);
      const node = document.querySelector(`[data-message-id="${message.id}"]`);
      if (node) node.innerHTML = this.buildMessageHTML(message);
      return true;
    },

    sendMessage() {
      const input = document.getElementById('chatInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      this.addMessage({ role: 'user', content: text, timestamp: new Date().toISOString() });
      input.value = '';
      input.style.height = 'auto';
      if (this.onSend) this.onSend(text);
    },

    addMessage(msg) {
      msg.id = msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      msg.timestamp = msg.timestamp || new Date().toISOString();
      this.messages.push(msg);
      this.renderMessage(msg);
      this.scrollToBottom();
    },

    addToolCall(toolCall) {
      const callId = toolCall.id || toolCall.callId || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const existing = this.messages.find(message => message.role === 'tool' && message.toolCall?.id === callId);
      if (existing) {
        Object.assign(existing.toolCall, toolCall, { id: callId });
        const node = document.querySelector(`[data-message-id="${existing.id}"]`);
        if (node) node.innerHTML = this.buildMessageHTML(existing);
        return existing.id;
      }
      this.addMessage({ role: 'tool', content: toolCall.name || 'Tool', toolCall: { ...toolCall, id: callId }, timestamp: new Date().toISOString() });
      return callId;
    },

    addSteps(steps = [], title = 'Completed steps') {
      this.addMessage({ role: 'agent', content: '', steps, stepsTitle: title, timestamp: new Date().toISOString() });
    },

    renderMessage(msg) {
      const container = document.getElementById('chatMessages');
      if (!container) return;
      const el = document.createElement('div');
      el.className = 'message ' + msg.role;
      el.setAttribute('data-message-id', msg.id);
      el.innerHTML = this.buildMessageHTML(msg);
      container.appendChild(el);
    },

    buildMessageHTML(msg) {
      const time = new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const roleLabel = { user: 'You', agent: 'Agent', tool: 'Tool', system: 'System' }[msg.role] || msg.role;
      const avatar = { user: 'user', agent: 'agent', tool: 'tool', system: 'system' }[msg.role] || 'system';
      let body = msg.role === 'tool' && msg.toolCall ? this.buildToolCallHTML(msg.toolCall) : '';
      if (Array.isArray(msg.codeBlocks)) body += msg.codeBlocks.map(block => this.buildCodeBlockHTML(block)).join('');
      if (msg.steps) body += this.buildStepsHTML(msg.steps, msg.stepsTitle);
      body += this.escapeHtml(msg.content || '');
      return `<div class="message-avatar ${msg.role}"><span class="icon ${avatar}"></span></div>
        <div class="message-content">
          <div class="message-header"><span class="message-role ${msg.role}">${roleLabel}</span><span class="message-time">${time}</span></div>
          <div class="message-body">${body}</div>
        </div>`;
    },

    buildToolCallHTML(tc) {
      const status = tc.status || 'running';
      const iconClass = status === 'success' ? 'success' : status === 'error' ? 'error' : status === 'running' ? 'spinner' : 'tool';
      const duration = tc.duration ? `<span class="tool-call-duration">${tc.duration}ms</span>` : '';
      const args = tc.arguments ? `<pre>${this.escapeHtml(JSON.stringify(tc.arguments, null, 2))}</pre>` : '';
      const result = tc.result ? `<div class="tool-call-details-section"><div class="tool-call-details-label">Result</div><pre>${this.escapeHtml(JSON.stringify(tc.result, null, 2))}</pre></div>` : '';
      return `<div class="tool-call-pill ${status}"><span class="icon ${iconClass}"></span><span class="tool-call-name">${this.escapeHtml(tc.name || 'Tool')}</span>${duration}</div>
        ${args || result ? `<div class="tool-call-details"><div class="tool-call-details-header"><span class="icon chevron-down"></span><span>Details</span></div><div class="tool-call-details-body">${args ? `<div class="tool-call-details-section"><div class="tool-call-details-label">Arguments</div>${args}</div>` : ''}${result}</div></div>` : ''}`;
    },

    buildStepsHTML(steps, title = 'Completed steps') {
      const rows = (Array.isArray(steps) ? steps : []).map((step, index) => {
        const status = String(step.status || 'success').toLowerCase();
        const icon = status === 'running' ? 'spinner' : status === 'error' || status === 'failed' ? 'error' : 'success';
        return `<div class="step-item"><span class="step-status"><span class="icon ${icon} icon-sm"></span></span><span class="step-name">${index + 1}. ${this.escapeHtml(step.name || step.tool || 'Step')}</span><span class="step-duration">${step.duration != null ? `${step.duration}ms` : ''}</span></div>`;
      }).join('');
      return `<div class="steps-section"><div class="steps-header"><span class="icon chevron-down"></span><span>${this.escapeHtml(title)}</span><span class="steps-count">${Array.isArray(steps) ? steps.length : 0}</span></div><div class="steps-list" hidden>${rows}</div></div>`;
    },

    buildCodeBlockHTML(block = {}) {
      const code = String(block.code ?? block.content ?? '');
      return `<div class="message-code-block"><div class="message-code-header"><span class="message-code-lang">${this.escapeHtml(block.lang || 'text')}</span><div class="message-code-actions"><button type="button" data-chat-action="copy"><span class="icon copy icon-xs"></span>Copy</button><button type="button" data-chat-action="insert"><span class="icon insert icon-xs"></span>Insert</button></div></div><pre class="message-code-body">${this.escapeHtml(code)}</pre></div>`;
    },

    scrollToBottom() {
      const container = document.getElementById('chatMessages');
      if (container) container.scrollTop = container.scrollHeight;
    },

    clear() { this.messages = []; const c = document.getElementById('chatMessages'); if (c) c.innerHTML = ''; },

    escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/gu, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  };

  if (typeof window !== 'undefined') window.ChatView = ChatView;
  if (typeof module !== 'undefined' && module.exports) module.exports = ChatView;
})();
