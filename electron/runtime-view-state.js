'use strict';

(function attachRuntimeViewState(root) {
  function create() {
    return {
      runtime: { status: 'starting', active: false },
      workspace: { status: 'unknown' },
      provider: { status: 'unknown' },
      browser: { lifecycle: 'unconfigured', endpoint: null, pid: null, selectedTarget: null, targets: [] },
      agent: { status: 'idle', running: false, waiting: null },
      browserSession: { status: 'idle', message: '' },
      relay: { status: 'stopped', message: '' },
      relayFeedback: { status: 'idle', message: '' },
    };
  }

  function fromSnapshot(previous, snapshot = {}) {
    const agent = snapshot.agent || {};
    const provider = snapshot.provider || {};
    const browser = snapshot.browser || previous.browser || {};
    const relay = snapshot.browserRelay || {};
    const running = agent.running === true;
    const active = snapshot.runtimeControl?.active === true;
    return {
      ...previous,
      runtime: { status: running ? 'running' : active ? 'ready' : String(agent.status || 'stopped'), active },
      workspace: { status: snapshot.workspaceRoot ? 'connected' : 'missing' },
      provider: { status: provider.healthy === true || provider.reachable === true ? 'ready' : provider.configured === false ? 'unconfigured' : 'unavailable' },
      browser: { lifecycle: String(browser.lifecycle || (browser.running ? 'ready' : 'unconfigured')), endpoint: browser.endpoint || null, pid: browser.pid || null, selectedTarget: relay.target || null, targets: Array.isArray(previous.browser?.targets) ? previous.browser.targets : [] },
      agent: { status: String(agent.status || 'idle'), running, waiting: agent.waiting || null },
      relay: { status: String(relay.lifecycle || (relay.running ? 'running' : 'stopped')), message: String(relay.error || previous.relay?.message || '') },
    };
  }

  function withBrowserSession(previous, status, message) {
    return { ...previous, browserSession: { status: String(status || 'idle'), message: String(message || '') } };
  }

  function withRelay(previous, status, message) {
    return { ...previous, relay: { status: String(status || 'stopped'), message: String(message || '') } };
  }

  function withRelayFeedback(previous, status, message) {
    return { ...previous, relayFeedback: { status: String(status || 'idle'), message: String(message || '') } };
  }

  function withBrowserTargets(previous, targets, selectedTarget = null) {
    const list = Array.isArray(targets) ? targets.map(target => ({ ...target })) : [];
    const selected = selectedTarget && list.some(target => target.targetId === selectedTarget.targetId && target.providerId === selectedTarget.providerId)
      ? { ...selectedTarget }
      : null;
    return { ...previous, browser: { ...previous.browser, targets:list, selectedTarget:selected } };
  }

  const api = Object.freeze({ create, fromSnapshot, withBrowserSession, withRelay, withRelayFeedback, withBrowserTargets });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RuntimeViewState = api;
})(typeof window !== 'undefined' ? window : globalThis);
