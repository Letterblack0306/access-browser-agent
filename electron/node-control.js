
(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const state = {
    runtime: null,
    browserAuthority: null,
    tabs: [],
    skills: [],
    mcp: null,
    receipts: [],
    diagnostics: [],
    selected: 'agent',
    drag: null,
    refreshTimer: null,
  };

  const nodes = [
    { id:'provider', label:'Provider / Model', kind:'CAPABILITY', x:70, y:55 },
    { id:'agent', label:'Agent Runtime', kind:'AUTHORITY', x:410, y:55 },
    { id:'evidence', label:'Evidence / Receipts', kind:'PROOF', x:750, y:55 },
    { id:'control', label:'Provider Control Target', kind:'TARGET', x:70, y:255 },
    { id:'browser', label:'Managed Browser', kind:'AUTHORITY', x:410, y:255 },
    { id:'work', label:'Work Target', kind:'TARGET', x:750, y:255 },
    { id:'workspace', label:'Workspace', kind:'CAPABILITY', x:70, y:475 },
    { id:'tools', label:'Tool Surface', kind:'REGISTRY', x:410, y:475 },
    { id:'terminal', label:'Terminal', kind:'CAPABILITY', x:750, y:475 },
    { id:'recovery', label:'Recovery', kind:'CONTROL', x:410, y:650 },
  ];

  const edges = [
    ['provider','agent'],
    ['control','browser'],
    ['browser','agent'],
    ['work','browser'],
    ['agent','tools'],
    ['tools','workspace'],
    ['tools','terminal'],
    ['agent','evidence'],
    ['agent','recovery'],
  ];

  function safe(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback === undefined ? '—' : String(fallback);
    return String(value);
  }

  function escapeHtml(value) {
    return safe(value, '').replace(/[&<>"']/g, (char) => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#039;',
    }[char]));
  }

  function truncate(value, length) {
    const text = safe(value);
    const max = Number(length) || 48;
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  function runtimeAgent() {
    return state.runtime && (state.runtime.agent || (state.runtime.status && state.runtime.status.agent)) || {};
  }

  function browserState() {
    return state.runtime && state.runtime.browser || {};
  }

  function relayState() {
    return state.runtime && state.runtime.browserRelay || {};
  }

  function providerState() {
    return state.runtime && state.runtime.provider || {};
  }

  function selectedControlTarget() {
    const relay = relayState();
    return relay.target || relay.selectedTarget || null;
  }

  function generalBrowserState() {
    return state.browserAuthority && state.browserAuthority.generalBrowser || {};
  }

  function inferredWorkTarget() {
    const general = generalBrowserState();
    if (!general.currentTargetId) return null;
    return {
      targetId: general.currentTargetId,
      ownedTargetCount: general.ownedTargetCount || 0,
      type: 'owned-page',
    };
  }

  function keyValues(rows) {
    return '<div class="node-kv">' + rows.map((row) => {
      const key = row[0];
      const value = row[1];
      return '<span>' + escapeHtml(key) + '</span><b title="' + escapeHtml(value) + '">' + escapeHtml(value) + '</b>';
    }).join('') + '</div>';
  }

  function nodeContent(id) {
    const runtime = state.runtime || {};
    const agent = runtimeAgent();
    const browser = browserState();
    const relay = relayState();
    const provider = providerState();
    const control = selectedControlTarget();
    const work = inferredWorkTarget();

    if (id === 'provider') {
      return {
        state: provider.healthy === true ? 'good' : (provider.failureReason ? 'warn' : 'idle'),
        html: keyValues([
          ['kind', safe(provider.kind || provider.providerKind)],
          ['model', safe(provider.model)],
          ['healthy', safe(provider.healthy)],
          ['reason', truncate(provider.failureReason, 36)],
        ]),
        chips: ['readiness', 'tool calling', 'image input'],
      };
    }

    if (id === 'agent') {
      return {
        state: agent.running ? 'good' : (agent.status === 'degraded' ? 'warn' : 'idle'),
        html: keyValues([
          ['status', safe(agent.status, agent.running ? 'running' : 'idle')],
          ['session', safe(agent.sessionId)],
          ['turn', safe(agent.turnId)],
          ['runtime', runtime.running === false ? 'stopped' : 'active'],
        ]),
        chips: ['one runtime', 'state events', 'stop'],
      };
    }

    if (id === 'evidence') {
      return {
        state: state.receipts.length || state.diagnostics.length ? 'good' : 'idle',
        html: keyValues([
          ['receipts', String(state.receipts.length)],
          ['events', String(state.diagnostics.length)],
          ['capture', 'evidence IDs'],
          ['trace', 'session scoped'],
        ]),
        chips: ['SHA-256', 'diagnostics', 'screenshots'],
      };
    }

    if (id === 'control') {
      return {
        state: control ? 'good' : 'idle',
        html: keyValues([
          ['title', truncate(control && control.title, 32)],
          ['provider', safe(control && (control.providerId || control.provider))],
          ['target', truncate(control && control.targetId, 32)],
          ['url', truncate(control && control.url, 38)],
        ]),
        chips: ['protected', 'relay', 'same conversation'],
      };
    }

    if (id === 'browser') {
      const good = browser.running === true || browser.connected === true || browser.status === 'running' || browser.status === 'ready';
      return {
        state: good ? 'good' : (browser.status === 'failed' ? 'bad' : 'idle'),
        html: keyValues([
          ['status', safe(browser.status, browser.running ? 'running' : 'stopped')],
          ['endpoint', truncate(browser.endpoint || browser.cdpEndpoint, 34)],
          ['profile', truncate(browser.profilePath, 34)],
          ['targets', String(state.tabs.length)],
        ]),
        chips: ['CDP', 'managed profile', 'start / stop'],
      };
    }

    if (id === 'work') {
      return {
        state: work ? 'good' : 'idle',
        html: keyValues([
          ['target', truncate(work && work.targetId, 32)],
          ['owned', work ? String(work.ownedTargetCount) : '0'],
          ['type', safe(work && work.type)],
          ['source', 'browser authority'],
        ]),
        chips: ['explicit target', 'inspect', 'navigate', 'capture'],
      };
    }

    if (id === 'workspace') {
      const root = runtime.workspaceRoot || (runtime.status && runtime.status.workspaceRoot);
      return {
        state: root ? 'good' : 'idle',
        html: keyValues([
          ['root', truncate(root, 38)],
          ['sync', runtime.workspaceSync && runtime.workspaceSync.running ? 'running' : 'idle'],
          ['MCP', safe(state.mcp && state.mcp.status)],
          ['writes', 'governed'],
        ]),
        chips: ['read', 'search', 'git', 'mutation guard'],
      };
    }

    if (id === 'tools') {
      const mcpTools = state.mcp && Array.isArray(state.mcp.tools) ? state.mcp.tools.length : 0;
      return {
        state: 'good',
        html: keyValues([
          ['skills', String(state.skills.length)],
          ['MCP', safe(state.mcp && state.mcp.status)],
          ['MCP tools', String(mcpTools)],
          ['owner', 'ToolRegistry'],
        ]),
        chips: ['readFile','createFile','writeFile','applyPatch','listFiles','searchFiles','inspectWorkspace','inspectEnvironment','gitStatus','runCommand','askUser','browserConversationRead','restoreCheckpoint','listCheckpoints','browserOpen','browserTabs','browserNavigate','browserSnapshot','browserScreenshot','browserCompareScreenshots','browserClick','browserType','browserScroll','browserClose'],
      };
    }

    if (id === 'terminal') {
      return {
        state: 'good',
        html: keyValues([
          ['owner', 'PTY manager'],
          ['shell', 'runtime resolved'],
          ['writes', 'governed'],
          ['proof', 'events / receipts'],
        ]),
        chips: ['create', 'write', 'resize', 'kill'],
      };
    }

    return {
      state: relay.recoveryRequired || relay.status === 'recovery_required' ? 'warn' : 'idle',
      html: keyValues([
        ['relay', safe(relay.status)],
        ['pending', safe(relay.pendingResult || relay.pending)],
        ['recovery', relay.recoveryRequired ? 'required' : 'not reported'],
        ['policy', 'fail closed'],
      ]),
      chips: ['read', 'reconcile', 'no replay'],
    };
  }

  function renderNodes() {
    const canvas = byId('nodeCanvas');
    if (!canvas) return;

    nodes.forEach((definition) => {
      let element = byId('node-' + definition.id);
      if (!element) {
        element = document.createElement('div');
        element.id = 'node-' + definition.id;
        element.className = 'node-card';
        element.dataset.id = definition.id;
        element.style.left = definition.x + 'px';
        element.style.top = definition.y + 'px';
        element.innerHTML = '<div class="node-head"><span class="node-led"></span><span class="node-name"></span><span class="node-kind"></span></div><div class="node-body"></div>';
        element.addEventListener('mousedown', beginDrag);
        element.addEventListener('click', () => selectNode(definition.id));
        canvas.appendChild(element);
      }

      const content = nodeContent(definition.id);
      element.dataset.state = content.state;
      element.classList.toggle('selected', state.selected === definition.id);
      element.querySelector('.node-name').textContent = definition.label;
      element.querySelector('.node-kind').textContent = definition.kind;
      element.querySelector('.node-body').innerHTML =
        content.html +
        '<div class="node-chip-row">' +
        content.chips.map((chip) => '<span class="node-chip">' + escapeHtml(chip) + '</span>').join('') +
        '</div>';
    });

    drawEdges();
    renderInspector();
  }

  function drawEdges() {
    const svg = byId('nodeEdges');
    const canvas = byId('nodeCanvas');
    if (!svg || !canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    svg.innerHTML = '';

    edges.forEach((edge) => {
      const from = byId('node-' + edge[0]);
      const to = byId('node-' + edge[1]);
      if (!from || !to) return;

      const fromRect = from.getBoundingClientRect();
      const toRect = to.getBoundingClientRect();
      const x1 = fromRect.left - canvasRect.left + fromRect.width / 2;
      const y1 = fromRect.top - canvasRect.top + fromRect.height / 2;
      const x2 = toRect.left - canvasRect.left + toRect.width / 2;
      const y2 = toRect.top - canvasRect.top + toRect.height / 2;
      const middle = (x1 + x2) / 2;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'node-edge');
      path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + middle + ' ' + y1 + ', ' + middle + ' ' + y2 + ', ' + x2 + ' ' + y2);
      svg.appendChild(path);
    });
  }

  function beginDrag(event) {
    if (!event.target.closest('.node-head')) return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    state.drag = {
      element,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    };
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', endDrag, { once:true });
  }

  function dragMove(event) {
    if (!state.drag) return;
    const canvas = byId('nodeCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    state.drag.element.style.left = Math.max(8, event.clientX - rect.left - state.drag.dx) + 'px';
    state.drag.element.style.top = Math.max(8, event.clientY - rect.top - state.drag.dy) + 'px';
    drawEdges();
  }

  function endDrag() {
    state.drag = null;
    document.removeEventListener('mousemove', dragMove);
  }

  function selectNode(id) {
    state.selected = id;
    renderNodes();
  }

  function normalizeCollection(value, keys) {
    if (Array.isArray(value)) return value;
    for (const key of keys) {
      if (value && Array.isArray(value[key])) return value[key];
    }
    return [];
  }

  async function refreshAll() {
    if (!window.accessIde) return;

    const calls = [
      ['runtime', () => window.accessIde.status()],
      ['browserAuthority', () => window.accessIde.browserStatus()],
      ['tabs', () => window.accessIde.browserProviderTabs()],
      ['skills', () => window.accessIde.skills()],
      ['mcp', () => window.accessIde.mcpStatus()],
      ['receipts', () => window.accessIde.agentReceipts()],
      ['diagnostics', () => window.accessIde.diagnosticRecent(80)],
    ];

    await Promise.all(calls.map(async (entry) => {
      const key = entry[0];
      const call = entry[1];
      try {
        const value = await call();
        if (key === 'tabs') state.tabs = normalizeCollection(value, ['tabs','targets','items']);
        else if (key === 'skills') state.skills = normalizeCollection(value, ['skills','items']);
        else if (key === 'receipts') state.receipts = normalizeCollection(value, ['receipts','items']);
        else if (key === 'diagnostics') state.diagnostics = normalizeCollection(value, ['records','items']);
        else state[key] = value;
      } catch (error) {
        if (key === 'runtime') {
          state.runtime = { status:'unavailable', error:safe(error && error.message, error) };
        }
      }
    }));

    renderNodes();
    renderTargets();
    renderLog();
    renderHeadline();
  }

  function renderHeadline() {
    const target = byId('nodeHeadline');
    if (!target) return;
    const agent = runtimeAgent();
    const browser = browserState();
    const control = selectedControlTarget();
    target.textContent =
      'agent:' + safe(agent.status, agent.running ? 'running' : 'idle') +
      ' · browser:' + safe(browser.status, browser.running ? 'running' : 'idle') +
      ' · target:' + (control && control.targetId ? 'selected' : 'none');
  }

  function renderTargets() {
    const box = byId('nodeTargetList');
    if (!box) return;

    if (!state.tabs.length) {
      box.innerHTML = '<div class="node-empty">No provider/browser targets reported.</div>';
      return;
    }

    box.innerHTML = state.tabs.map((target, index) => {
      return '<div class="node-target" data-target-index="' + index + '">' +
        '<strong>' + escapeHtml(target.title || target.provider || 'Untitled target') + '</strong>' +
        '<span>' + escapeHtml(target.targetId || '') + ' · ' + escapeHtml(truncate(target.url, 45)) + '</span>' +
        '</div>';
    }).join('');

    box.querySelectorAll('.node-target').forEach((element) => {
      element.addEventListener('click', async () => {
        const target = state.tabs[Number(element.dataset.targetIndex)];
        try {
          const selected = await window.accessIde.browserRelaySelect(target);
          const selectedTarget = selected && (selected.selectedTarget || (selected.relay && selected.relay.target));
          const url = selectedTarget && selectedTarget.url || target.url || '';
          if (byId('chatUrlInput') && url) byId('chatUrlInput').value = url;
          await refreshAll();
        } catch (error) {
          window.alert('Target selection failed: ' + safe(error && error.message, error));
        }
      });
    });
  }

  function renderInspector() {
    const definition = nodes.find((node) => node.id === state.selected);
    if (!definition || !byId('nodeInspectorTitle') || !byId('nodeInspectorBody')) return;
    const content = nodeContent(definition.id);
    byId('nodeInspectorTitle').textContent = definition.label;
    byId('nodeInspectorBody').innerHTML =
      '<div class="node-sub">Projection of an existing runtime owner. This node does not own a duplicate agent, browser, or tool state machine.</div>' +
      '<div style="margin-top:12px">' + content.html + '</div>';
  }

  function renderLog() {
    const log = byId('nodeEventLog');
    if (!log) return;
    const rows = state.diagnostics.slice(-20).map((event) => {
      return safe(event.timestamp || event.at, '') + '  ' +
        safe(event.source || event.category, 'event') + '  ' +
        safe(event.action || event.phase, '');
    });
    log.textContent = rows.join('\n') || 'No recent diagnostics.';
  }

  async function act(name) {
    try {
      if (name === 'refresh') {
        await refreshAll();
        return;
      }
      if (name === 'runtime-start') await window.accessIde.runtimeStart();
      if (name === 'runtime-stop') await window.accessIde.runtimeStop();
      if (name === 'browser-start') await window.accessIde.browserStart();
      if (name === 'browser-stop') await window.accessIde.browserStop();
      if (name === 'relay-start') await window.accessIde.browserRelayStart();
      if (name === 'relay-stop') await window.accessIde.browserRelayStop();
      if (name === 'workspace') await window.accessIde.selectWorkspace();
      if (name === 'terminal') {
        await window.accessIde.terminalCreate();
        window.toggleNodeControl(false);
      }
      if (name === 'stop-agent') await window.accessIde.agentStop();
      if (name === 'run-loop') {
        const url = byId('chatUrlInput') && byId('chatUrlInput').value.trim();
        if (!url) throw new Error('Select a provider control target first.');
        if (typeof window.startAgent !== 'function') throw new Error('The existing agent start control is unavailable.');
        await window.startAgent();
      }
      await refreshAll();
    } catch (error) {
      window.alert(safe(error && error.message, error));
    }
  }

  function mount() {
    const surface = byId('nodeControlSurface');
    if (!surface) return;

    surface.innerHTML =
      '<div class="node-ui">' +
        '<aside class="node-rail">' +
          '<div class="node-section"><div class="node-eyebrow">Access Agent</div><div class="node-title">Node Control</div><div class="node-sub">Operator projection over the authoritative runtime.</div></div>' +
          '<div class="node-section"><div class="node-eyebrow">Runtime</div>' +
            '<button class="node-btn primary" data-act="refresh">Refresh truth</button>' +
            '<button class="node-btn" data-act="runtime-start">Start runtime</button>' +
            '<button class="node-btn" data-act="runtime-stop">Stop runtime</button>' +
          '</div>' +
          '<div class="node-section"><div class="node-eyebrow">Browser</div>' +
            '<button class="node-btn" data-act="browser-start">Start managed browser</button>' +
            '<button class="node-btn" data-act="browser-stop">Stop managed browser</button>' +
            '<button class="node-btn" data-act="relay-start">Start provider relay</button>' +
            '<button class="node-btn" data-act="relay-stop">Stop provider relay</button>' +
          '</div>' +
          '<div class="node-section"><div class="node-eyebrow">Agent</div>' +
            '<button class="node-btn primary" data-act="run-loop">Run selected provider loop</button>' +
            '<button class="node-btn danger" data-act="stop-agent">Stop active agent</button>' +
          '</div>' +
          '<div class="node-section"><div class="node-eyebrow">Workspace</div>' +
            '<button class="node-btn" data-act="workspace">Select workspace</button>' +
            '<button class="node-btn" data-act="terminal">Open terminal</button>' +
          '</div>' +
          '<div class="node-section"><div class="node-eyebrow">Targets</div><div id="nodeTargetList"></div></div>' +
        '</aside>' +
        '<main class="node-canvas-wrap">' +
          '<div class="node-topbar"><div class="node-topbar-title">Execution topology</div><div id="nodeHeadline" class="node-inline-status">loading…</div></div>' +
          '<div id="nodeCanvas" class="node-canvas"><svg id="nodeEdges" class="node-edges"></svg></div>' +
        '</main>' +
        '<aside class="node-inspector">' +
          '<div class="node-section"><div class="node-eyebrow">Selected node</div><div id="nodeInspectorTitle" class="node-title">Agent Runtime</div><div id="nodeInspectorBody"></div></div>' +
          '<div class="node-section"><div class="node-eyebrow">Recent evidence events</div><div id="nodeEventLog" class="node-log"></div></div>' +
          '<div class="node-section"><div class="node-eyebrow">Boundary</div><div class="node-sub">Green means observed runtime state. It is never inferred from saved configuration or a static UI toggle.</div></div>' +
        '</aside>' +
      '</div>';

    surface.querySelectorAll('[data-act]').forEach((button) => {
      button.addEventListener('click', () => act(button.dataset.act));
    });

    renderNodes();
  }

  window.toggleNodeControl = function toggleNodeControl(force) {
    const surface = byId('nodeControlSurface');
    if (!surface) return;

    const active = typeof force === 'boolean' ? force : !surface.classList.contains('active');
    surface.classList.toggle('active', active);

    const icon = byId('icon-nodes');
    if (icon) icon.classList.toggle('active', active);

    if (active) {
      refreshAll();
      if (state.refreshTimer) clearInterval(state.refreshTimer);
      state.refreshTimer = setInterval(refreshAll, 5000);
    } else if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  };

  window.addEventListener('DOMContentLoaded', mount);

  if (window.accessIde && window.accessIde.onAgentEvent) {
    window.accessIde.onAgentEvent(() => {
      const surface = byId('nodeControlSurface');
      if (surface && surface.classList.contains('active')) refreshAll();
    });
  }

  if (window.accessIde && window.accessIde.onAgentState) {
    window.accessIde.onAgentState(() => {
      const surface = byId('nodeControlSurface');
      if (surface && surface.classList.contains('active')) refreshAll();
    });
  }
})();
