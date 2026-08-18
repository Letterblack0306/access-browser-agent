'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const ESCAPE_HTML = /[&<>"]/g;
  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const escapeHtml = str => String(str).replace(ESCAPE_HTML, c => ESCAPE_MAP[c]);

  let mounted = false;
  let chatContainer = null;
  let currentThinkingText = '';
  let thinkingTimer = null;
  let toolCalls = new Map();
  let isAgentRunning = false;
  let activeObjective = '';
  let messageCount = 0;
  let startTime = null;
  let timerInterval = null;
  let unsubscribeAgent = null;
  let elements = {};

  const template = () => `
    <div class="agent-header">
      <div class="agent-header-left">
        <span class="agent-status-dot idle" id="agentStatusDot"></span>
        <h2>Agent</h2>
        <span class="agent-status-text" id="agentStatusText">Ready</span>
      </div>
      <div class="agent-header-right">
        <span class="agent-timer" id="agentTimer">--:--</span>
        <button class="agent-control-btn stop" id="agentStopBtn" disabled>Stop</button>
        <button class="agent-control-btn clear" id="agentClearBtn">Clear</button>
      </div>
    </div>
    <div class="agent-current-task" id="agentCurrentTask" hidden aria-live="polite"></div>
    <div class="agent-chat-container" id="agentChatContainer">
      <div class="agent-empty-state" id="agentEmptyState">
        <div class="empty-icon">Agent</div>
        <h3>Ready to help</h3>
        <p>Ask me anything about your workspace.</p>
      </div>
    </div>
    <div class="agent-input-container">
      <div class="agent-input-wrapper">
        <textarea id="agentInput" rows="1" placeholder="Ask the agent..." spellcheck="false"></textarea>
        <button class="send-btn" id="agentSendBtn" title="Send">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>

    <!-- Browser Tools -->
    <div class="agent-browser-tools" id="agentBrowserTools">
      <button class="browser-tools-toggle" id="browserToolsToggle" onclick="document.getElementById('browserToolsContent').classList.toggle('open')">
        <span class="browser-tools-icon">[B]</span>
        <span>Browser Tools</span>
        <span class="browser-tools-arrow">v</span>
      </button>
      <div class="browser-tools-content" id="browserToolsContent">
        <div class="browser-tools-row">
          <button class="browser-btn primary" id="startManagedChrome">Launch Chrome</button>
          <button class="browser-btn secondary" id="stopManagedChrome">Stop Chrome</button>
          <select id="openManagedProviderKind" class="browser-select">
            <option value="chatgpt">ChatGPT</option>
            <option value="gemini">Gemini</option>
            <option value="copilot">Copilot</option>
          </select>
          <button class="browser-btn secondary" id="openManagedProvider">Open provider</button>
        </div>
        <div class="browser-tools-row">
          <label class="browser-label">Provider tab</label>
          <select id="browserProviderTab" class="browser-select">
            <option value="">Find provider tabs after launching Chrome</option>
          </select>
          <button class="browser-btn secondary" id="refreshBrowserProviderTabs">Find tabs</button>
        </div>
        <div class="browser-tools-row">
          <button class="browser-btn primary" id="startBrowserRelay">Start relay</button>
          <button class="browser-btn secondary" id="stopBrowserRelay">Stop relay</button>
          <span id="browserRelayStatus" class="browser-status"></span>
        </div>
        <div id="browserSessionStatus" class="browser-notice" hidden></div>
      </div>
    </div>

    <div class="agent-status-bar" id="agentStatusBar">
      <span class="status-item">
        <span class="status-dot idle" id="statusBarDot"></span>
        <span id="statusBarLabel">Idle</span>
      </span>
      <span class="status-divider">|</span>
      <span class="status-item"><span id="statusBarTools">0 tools</span></span>
      <span class="status-divider">|</span>
      <span class="status-item"><span id="statusBarTokens">0 tokens</span></span>
    </div>
  `;

  function initElements() {
    elements = {
      chatContainer: byId('agentChatContainer'),
      emptyState: byId('agentEmptyState'),
      statusDot: byId('agentStatusDot'),
      statusText: byId('agentStatusText'),
      timer: byId('agentTimer'),
      stopBtn: byId('agentStopBtn'),
      clearBtn: byId('agentClearBtn'),
      input: byId('agentInput'),
      sendBtn: byId('agentSendBtn'),
      statusBarDot: byId('statusBarDot'),
      statusBarLabel: byId('statusBarLabel'),
      statusBarTools: byId('statusBarTools'),
      statusBarTokens: byId('statusBarTokens'),
      currentTask: byId('agentCurrentTask'),
    };
  }

      function formatCodeBlocks(text) {
    return text.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
      return '<pre><code class="language-' + (lang || 'text') + '">' + escapeHtml(code) + '</code></pre>';
    }).replace(/\n/g, '<br>');
  }

  function addMessage(element) {
    if (elements.emptyState) elements.emptyState.hidden = true;
    elements.chatContainer.appendChild(element);
    scrollToBottom();
    messageCount++;
    updateStatusBar();
  }

  function scrollToBottom() {
    setTimeout(function() {
      elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
    }, 50);
  }

  function updateStatusBar() {
    var toolCount = toolCalls.size;
    elements.statusBarTools.textContent = toolCount + ' tool' + (toolCount !== 1 ? 's' : '');
    elements.statusBarTokens.textContent = '~' + Math.max(0, messageCount * 50) + ' tokens';
  }

  function setStatus(status, text) {
    var dot = elements.statusDot;
    var label = elements.statusText;
    var barDot = elements.statusBarDot;
    dot.className = 'agent-status-dot ' + status;
    barDot.className = 'status-dot ' + status;
    label.textContent = text;
    elements.statusBarLabel.textContent = text;
    var running = status === 'thinking' || status === 'running';
    if (elements.stopBtn) elements.stopBtn.disabled = !running;
    if (running) startTimer(); else stopTimer();
  }

  function setCurrentTask(text) {
    activeObjective = String(text || '').trim();
    if (!elements.currentTask) return;
    elements.currentTask.hidden = !activeObjective;
    elements.currentTask.textContent = activeObjective ? 'Working on: ' + activeObjective : '';
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (elements.timer) elements.timer.textContent = '--:--';
  }

  function updateTimer() {
    if (!startTime || !elements.timer) return;
    var elapsed = Date.now() - startTime;
    var secs = Math.floor(elapsed / 1000);
    var mins = Math.floor(secs / 60);
    var remSecs = secs % 60;
    elements.timer.textContent = mins + ':' + (remSecs < 10 ? '0' : '') + remSecs;
  }

  function startThinking() {
    if (thinkingTimer) return;
    setStatus('thinking', 'Thinking...');
    var existing = document.getElementById('thinkingStream');
    if (existing) existing.remove();
    currentThinkingText = '';
    elements.chatContainer.appendChild(renderThinkingStream(''));
    scrollToBottom();
    thinkingTimer = setInterval(function() {
      currentThinkingText += '.';
      var el = document.getElementById('thinkingStream');
      if (el) {
        el.querySelector('.stream-bubble').innerHTML =
          '> ' + escapeHtml(currentThinkingText) + '<span class="cursor-blink"></span>';
      }
      if (currentThinkingText.length > 20) currentThinkingText = '';
    }, 300);
  }

  function updateThinking(text) {
    currentThinkingText = text;
    if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = null; }
    var el = document.getElementById('thinkingStream');
    if (el) {
      el.querySelector('.stream-bubble').innerHTML =
        '> ' + escapeHtml(text) + '<span class="cursor-blink"></span>';
      scrollToBottom();
    }
  }

  function renderUserMessage(text) {
    var div = document.createElement('div');
    div.className = 'agent-message user';
    div.innerHTML =
      '<div class="message-bubble">' +
        '<div class="message-header">You</div>' +
        '<div class="message-content">' + escapeHtml(text) + '</div>' +
      '</div>' +
      '<div class="message-timestamp">' + new Date().toLocaleTimeString() + '</div>';
    return div;
  }

  function renderAssistantMessage(text, isStreaming) {
    var div = document.createElement('div');
    div.className = 'agent-message assistant';
    div.dataset.streaming = isStreaming ? 'true' : 'false';
    var formatted = formatCodeBlocks(escapeHtml(text));
    div.innerHTML =
      '<div class="message-bubble">' +
        '<div class="message-header"><span>Agent</span>' +
        (isStreaming ? '<span class="typing-indicator">[typing]</span>' : '') +
        '</div>' +
        '<div class="message-content">' + formatted + '</div>' +
      '</div>' +
      '<div class="message-timestamp">' + new Date().toLocaleTimeString() + '</div>';
    return div;
  }

  function renderThinkingStream(text) {
    var div = document.createElement('div');
    div.className = 'agent-thinking-stream';
    div.id = 'thinkingStream';
    div.innerHTML =
      '<div class="stream-bubble">> ' + escapeHtml(text) + '<span class="cursor-blink"></span></div>';
    return div;
  }

  function renderToolCall(tool) {
    var div = document.createElement('div');
    div.className = 'agent-tool-call';
    div.dataset.toolId = tool.id;
    var statusClass = tool.status || 'running';
    var statusLabel = tool.status === 'completed' ? 'OK' :
                     tool.status === 'error' ? 'ERR' :
                     tool.status === 'waiting' ? 'Wait' : 'Run';
    div.innerHTML =
      '<div class="tool-call-header" onclick="this.nextElementSibling.classList.toggle(\'open\')">' +
        '<span class="tool-icon">[T]</span>' +
        '<span class="tool-name">' + escapeHtml(tool.name) + '</span>' +
        '<span class="tool-status ' + statusClass + '">' + statusLabel + '</span>' +
        '<span style="margin-left:auto;color:#6b7280;font-size:10px;">' + (tool.duration || '') + '</span>' +
      '</div>' +
      '<div class="tool-call-details open">' +
        (tool.input ? '<div class="detail-label">Input</div><pre>' + escapeHtml(JSON.stringify(tool.input, null, 2)) + '</pre>' : '') +
        (tool.output ? '<div class="detail-label">Output</div><pre>' + escapeHtml(typeof tool.output === 'string' ? tool.output : JSON.stringify(tool.output, null, 2)) + '</pre>' : '') +
        (tool.error ? '<div class="detail-label" style="color:#f87171;">Error</div><pre style="color:#f87171;">' + escapeHtml(tool.error) + '</pre>' : '') +
      '</div>';
    return div;
  }

  // ============================================================
  // PLAN CHECKLIST — Cline-style task progress in the chat
  // ============================================================

  function renderPlanChecklist(plan) {
    var card = document.createElement('div');
    card.className = 'agent-plan-card';
    card.id = 'agentPlanCard';
    var progress = plan && plan.progress ? plan.progress : { total: 0, completed: 0, percent: 0 };
    var percent = Math.min(100, Math.max(0, progress.percent || 0));
    var statusClass = plan && plan.phase ? plan.phase === 'completed' ? 'completed' : plan.phase === 'blocked' ? 'blocked' : plan.phase === 'failed' ? 'failed' : 'active' : 'active';
    card.dataset.phase = statusClass;

    var header =
      '<div class="plan-header">' +
        '<span class="plan-icon">[P]</span>' +
        '<span class="plan-title">Plan</span>' +
        '<span class="plan-progress-text">' + (progress.completed || 0) + '/' + (progress.total || 0) + ' · ' + percent + '%</span>' +
      '</div>' +
      '<div class="plan-progress-track"><div class="plan-progress-fill" style="width:' + percent + '%"></div></div>' +
      '<ol class="plan-steps">';

    var steps = plan && plan.steps ? plan.steps : [];
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      var stepStatus = step.status || 'pending';
      var icon = stepStatus === 'completed' ? '✓' : stepStatus === 'running' ? '→' : stepStatus === 'failed' ? '!' : stepStatus === 'blocked' ? '✕' : '○';
      var classes = 'plan-step ' + stepStatus;
      var detail = step.detail ? '<span class="plan-step-detail">' + escapeHtml(step.detail) + '</span>' : '';
      var error = step.error ? '<span class="plan-step-error">' + escapeHtml(step.error) + '</span>' : '';
      header += '<li class="' + classes + '" data-step-id="' + escapeHtml(step.id || '') + '">' +
        '<span class="plan-step-icon">' + icon + '</span>' +
        '<span class="plan-step-title">' + escapeHtml(step.title || 'Step ' + (step.index || i + 1)) + '</span>' +
        detail + error +
      '</li>';
    }

    header += '</ol></div>';
    card.innerHTML = header;
    return card;
  }

  function upsertPlanChecklist(plan) {
    if (!plan) return;
    var existing = document.getElementById('agentPlanCard');
    var rendered = renderPlanChecklist(plan);
    if (existing) {
      existing.replaceWith(rendered);
    } else {
      if (elements.emptyState) elements.emptyState.hidden = true;
      elements.chatContainer.appendChild(rendered);
    }
    messageCount++;
    scrollToBottom();
  }

  // ============================================================
  // DIFF PREVIEW — Cline-style file change preview
  // ============================================================

  function renderDiffPreview(review) {
    if (!review) return null;
    var div = document.createElement('div');
    div.className = 'agent-diff-preview';
    div.dataset.fileKey = review.fileKey || '';
    var action = review.action || 'change';
    var statusLabel = review.status || 'proposed';
    var stats = review.diffStats || {};
    var additions = stats.additions || 0;
    var deletions = stats.deletions || 0;
    var changes = stats.changes || 0;

    var header =
      '<div class="diff-preview-header">' +
        '<span class="diff-icon">[D]</span>' +
        '<span class="diff-file">' + escapeHtml(review.filePath || review.fileKey || '') + '</span>' +
        '<span class="diff-badge diff-badge-' + statusLabel + '">' + escapeHtml(statusLabel) + '</span>' +
        '<span class="diff-stats">+<span style="color:#34d399;">' + additions + '</span> −<span style="color:#f87171;">' + deletions + '</span> · ' + changes + ' changes</span>' +
      '</div>';

    var body = '<div class="diff-preview-body">';
    if (review.diff) {
      body += '<pre class="diff-text">' + escapeHtml(review.diff) + '</pre>';
    } else {
      body += '<pre class="diff-text">No diff available.</pre>';
    }
    if (review.diffStats && review.diffStats.truncated) {
      body += '<div class="diff-truncated-note">Diff truncated — showing first section.</div>';
    }
    body += '</div>';

    div.innerHTML = header + body;
    return div;
  }

  function upsertDiffPreview(review) {
    if (!review) return;
    var fileKey = review.fileKey || '';
    var existing = elements.chatContainer.querySelector('.agent-diff-preview[data-file-key="' + fileKey + '"]');
    var rendered = renderDiffPreview(review);
    if (!rendered) return;
    if (existing) {
      existing.replaceWith(rendered);
    } else {
      if (elements.emptyState) elements.emptyState.hidden = true;
      elements.chatContainer.appendChild(rendered);
    }
    messageCount++;
    scrollToBottom();
  }

  function markDiffApplied(review) {
    if (!review) return;
    var fileKey = review.fileKey || '';
    var existing = elements.chatContainer.querySelector('.agent-diff-preview[data-file-key="' + fileKey + '"]');
    if (!existing) {
      upsertDiffPreview(review);
      return;
    }
    var badge = existing.querySelector('.diff-badge');
    if (badge) {
      badge.className = 'diff-badge diff-badge-verified';
      badge.textContent = 'verified';
    }
  }

  function stopThinking(keepMessage) {
    if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = null; }
    var el = document.getElementById('thinkingStream');
    if (el && !keepMessage) {
      el.remove();
    } else if (el && currentThinkingText) {
      el.className = 'agent-message assistant';
      el.innerHTML =
        '<div class="message-bubble">' +
          '<div class="message-header">Agent</div>' +
          '<div class="message-content">' + formatCodeBlocks(escapeHtml(currentThinkingText)) + '</div>' +
        '</div>' +
        '<div class="message-timestamp">' + new Date().toLocaleTimeString() + '</div>';
      el.id = '';
      currentThinkingText = '';
      scrollToBottom();
    } else if (el) {
      el.remove();
    }
    currentThinkingText = '';
  }

  function addToolCall(toolId, name, input) {
    var tool = { id: toolId, name: name, input: input, status: 'running' };
    toolCalls.set(toolId, tool);
    var el = renderToolCall(tool);
    el.dataset.toolId = toolId;
    elements.chatContainer.appendChild(el);
    scrollToBottom();
    updateStatusBar();
    return tool;
  }

  function updateToolCall(toolId, updates) {
    var tool = toolCalls.get(toolId);
    if (!tool) return;
    Object.assign(tool, updates);
    var el = elements.chatContainer.querySelector('[data-tool-id="' + toolId + '"]');
    if (el) {
      var newEl = renderToolCall(tool);
      el.replaceWith(newEl);
      scrollToBottom();
    }
    updateStatusBar();
  }

  function completeToolCall(toolId, output) {
    updateToolCall(toolId, { status: 'completed', output: output });
  }


  function handleAgentEvent(event) {
    var phase = event.phase || event.type || '';

    switch (phase) {
      case 'session.created':
        isAgentRunning = true;
        setStatus('running', 'Starting task...');
        if (event.objective) setCurrentTask(event.objective);
        if (elements.stopBtn) elements.stopBtn.disabled = false;
        if (event.instruction) addMessage(renderUserMessage(event.instruction));
        break;

      case 'agent.intent':
        if (event.detail) { startThinking(); updateThinking(event.detail); }
        break;

      case 'agent.status':
        // FIX #7: Render the generalized AGENT_STATUS transitions so the UI
        // reflects runtime state (planning, executing, reviewing, completed...).
        if (event.status) {
          const statusMap = {
            planning: ['thinking', 'Planning...'],
            awaiting_plan_approval: ['thinking', 'Plan created — awaiting approval...'],
            executing: ['running', 'Executing plan...'],
            reviewing: ['thinking', 'Reviewing file change...'],
            completed: ['completed', 'Task complete'],
            failed: ['error', 'Task failed'],
            stopped: ['idle', 'Stopped'],
          };
          const mapped = statusMap[event.status] || ['running', event.detail || 'Working...'];
          setStatus(mapped[0], mapped[1]);
        }
        break;

      case 'plan.started':
        setStatus('running', 'Planning...');
        startThinking();
        break;

      case 'plan.created':
        stopThinking(true);
        if (event.plan) upsertPlanChecklist(event.plan);
        setStatus('thinking', 'Plan created — awaiting approval...');
        break;

      case 'plan.approved':
        setStatus('running', 'Executing plan...');
        if (event.plan) upsertPlanChecklist(event.plan);
        break;

      case 'plan.rejected':
        stopThinking(true);
        setStatus('idle', 'Plan rejected');
        break;

      case 'plan.step.running':
        if (event.plan) upsertPlanChecklist(event.plan);
        else if (event.step) {
          var stepLabel = event.step.title || 'Working...';
          setStatus('running', stepLabel);
        }
        break;

      case 'plan.step.completed':
        if (event.plan) upsertPlanChecklist(event.plan);
        break;

      case 'plan.step.failed':
        if (event.plan) upsertPlanChecklist(event.plan);
        setStatus('error', 'Step failed');
        break;

      case 'plan.completed':
        if (event.plan) upsertPlanChecklist(event.plan);
        setStatus('completed', 'Plan complete');
        break;

      case 'execution.tool.preview':
        stopThinking(true);
        if (event.review) upsertDiffPreview(event.review);
        setStatus('thinking', 'Reviewing file change...');
        break;

      case 'execution.tool.applied':
        if (event.review) markDiffApplied(event.review);
        setStatus('running', 'Change applied');
        break;

      case 'provider_connecting':
        setStatus('thinking', event.detail || 'Checking provider connection...');
        break;

      case 'provider_reconnecting':
        setStatus('thinking', event.detail || 'Reconnecting to provider...');
        break;

      case 'provider_ready':
        setStatus('thinking', event.detail || 'Preparing task...');
        break;

      case 'provider_unavailable':
        isAgentRunning = false;
        stopThinking(true);
        setStatus('error', event.detail || 'Provider is unavailable');
        if (elements.stopBtn) elements.stopBtn.disabled = true;
        break;

      case 'execution.tool.started':
        stopThinking(true);
        addToolCall(
          event.toolCallId || ('tool-' + Date.now()),
          event.tool || 'unknown',
          event.inputSummary || event.input || {}
        );
        setStatus('running', 'Using ' + (event.tool || 'tool') + '...');
        break;

      case 'execution.tool.completed':
        if (event.toolCallId) completeToolCall(event.toolCallId, event.outputSummary || event.output || 'Done');
        setStatus('running', 'Processing...');
        break;

      case 'execution.tool.failed':
        if (event.toolCallId) failToolCall(event.toolCallId, event.error || 'Tool execution failed');
        setStatus('error', 'Tool failed');
        break;

      case 'execution.tool.approval_requested':
        if (event.toolCallId) updateToolCall(event.toolCallId, { status: 'waiting' });
        setStatus('thinking', 'Waiting for approval...');
        break;


      case 'agent.stream':
        if (event.text) {
          var streamText = event.text;
          var msg = elements.chatContainer.querySelector('.agent-message.assistant[data-streaming="true"]');
          if (!msg) {
            msg = renderAssistantMessage('', true);
            addMessage(msg);
            if (elements.emptyState) elements.emptyState.hidden = true;
          }
          var msgContent = msg.querySelector('.message-content');
          if (msgContent) { msgContent.innerHTML = formatCodeBlocks(escapeHtml(streamText)); scrollToBottom(); }
        }
        break;

      case 'session.completed':
      case 'turn_completed':
      case 'objective.completed':
        isAgentRunning = false;
        stopThinking(true);
        setStatus('completed', 'Done');
        if (elements.stopBtn) elements.stopBtn.disabled = true;
        if (event.summary || event.detail) {
          var summary = event.summary || event.detail;
          var existing = elements.chatContainer.querySelector('.agent-message.assistant[data-streaming="true"]');
          if (existing) {
            existing.dataset.streaming = 'false';
            var headerSpan = existing.querySelector('.message-header span:last-child');
            if (headerSpan) headerSpan.remove();
          } else {
            addMessage(renderAssistantMessage(summary, false));
          }
        }
        break;

      case 'session.stopped':
      case 'session.cancelled':
        isAgentRunning = false;
        stopThinking(true);
        setStatus('idle', 'Stopped');
        if (elements.stopBtn) elements.stopBtn.disabled = true;
        break;

      case 'step.failed':
        isAgentRunning = false;
        stopThinking(true);
        setStatus('error', 'Step failed');
        if (elements.stopBtn) elements.stopBtn.disabled = true;
        break;

      default:
        break;
    }
  }

  function setupInputHandlers() {
    if (!elements.input || !elements.sendBtn) return;
    elements.input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey && !isAgentRunning) {
        e.preventDefault();
        sendMessage();
      }
    });
    elements.sendBtn.addEventListener('click', sendMessage);
    if (elements.clearBtn) {
      elements.clearBtn.addEventListener('click', function() {
        elements.chatContainer.replaceChildren();
        var empty = document.createElement('div');
        empty.className = 'agent-empty-state';
        empty.id = 'agentEmptyState';
        empty.innerHTML =
          '<div class="empty-icon">Agent</div>' +
          '<h3>Ready to help</h3>' +
          '<p>Ask me anything about your workspace.</p>';
        elements.chatContainer.appendChild(empty);
        elements.emptyState = empty;
        messageCount = 0;
        toolCalls.clear();
        updateStatusBar();
      });
    }
    if (elements.stopBtn) {
      elements.stopBtn.addEventListener('click', async function() {
        if (window.accessIde && window.accessIde.agentStop) {
          await window.accessIde.agentStop();
        }
        stopThinking(true);
        setStatus('idle', 'Stopped');
        elements.stopBtn.disabled = true;
        isAgentRunning = false;
      });
    }
  }

  async function sendMessage() {
    var text = (elements.input ? elements.input.value : '').trim();
    if (!text || isAgentRunning) return;
    if (elements.input) elements.input.value = '';
    addMessage(renderUserMessage(text));
    isAgentRunning = true;
    setCurrentTask(text);
    setStatus('thinking', 'Checking provider connection...');
    if (window.accessIde && window.accessIde.agentRun) {
      try {
        const result = await window.accessIde.agentRun({ instruction: text });
        if (result && result.ok === false && result.error) {
          isAgentRunning = false;
          stopThinking(true);
          setStatus('error', String(result.error));
          if (elements.stopBtn) elements.stopBtn.disabled = true;
        }
      } catch (error) {
        isAgentRunning = false;
        stopThinking(true);
        setStatus('error', error && error.message ? error.message : 'Could not start the task');
        if (elements.stopBtn) elements.stopBtn.disabled = true;
      }
    }
  }

  function mount() {
    if (mounted) return;
    var container = document.querySelector('.module-agent');
    if (!container) {
      console.warn('AgentWorkflowView: .module-agent not found, retrying...');
      setTimeout(mount, 100);
      return;
    }
    container.innerHTML = template();
    mounted = true;
    initElements();
    setupInputHandlers();
    if (window.accessIde) {
      unsubscribeAgent = window.accessIde.onAgentEvent(handleAgentEvent);
    }
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    if (unsubscribeAgent) { unsubscribeAgent(); unsubscribeAgent = null; }
    if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = null; }
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  window.AgentWorkflowView = { mount, unmount };

  function watchForModule() {
    if (document.querySelector('.module-agent') && !mounted) {
      mount();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForModule);
  } else {
    watchForModule();
  }
})();
