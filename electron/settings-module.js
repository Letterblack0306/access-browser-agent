'use strict';

function template() {
  return `
    <div class="settings-hero"><p class="eyebrow">SETUP</p><h1>Configure only what this workspace needs.</h1><p>Choose a reasoning provider without changing the Access Agent runtime or tool architecture.</p></div>
    <section class="settings-card provider-settings">
      <div><p class="eyebrow">01 · PROVIDER</p><h2>LM Studio</h2><p class="muted">Local OpenAI-compatible model connection. Saving this provider makes LM Studio active.</p></div>
      <div class="settings-grid">
        <section class="settings-section"><h3>Connection</h3><label>LM Studio base URL<input id="baseUrl" autocomplete="url" placeholder="http://127.0.0.1:1234/v1"></label><div class="button-row"><button id="testConnection" class="secondary-button" type="button">Test connection</button></div></section>
        <section class="settings-section"><h3>Model</h3><label>Selected model<select id="model"><option value="">Select model</option></select></label><div class="button-row"><button id="refreshModels" class="secondary-button" type="button">Discover models</button></div></section>
        <section id="lmStudioSecurityFields" class="settings-section"><h3>Access</h3><p class="muted">Optional credentials and endpoint scope.</p></section>
        <section id="lmStudioRuntimeFields" class="settings-section"><h3>Runtime</h3><p class="muted">Model context and idle lifetime.</p></section>
      </div>
      <div class="settings-actions"><button id="saveSettings" class="primary-button" type="button">Use LM Studio</button></div>
    </section>
    <section class="settings-card provider-settings">
      <div><p class="eyebrow">02 · PROVIDER</p><h2>Cline account</h2><p class="muted">Experimental provider path through @cline/llms. OAuth credentials are persisted in local IDE preferences on this PC, restored after restart, and cleared on sign out.</p></div>
      <div class="settings-grid">
        <section class="settings-section"><h3>Account</h3><div class="button-row"><button id="clineLogin" class="secondary-button" type="button">Sign in with Cline</button><button id="clineLogout" class="secondary-button" type="button">Sign out</button></div><p id="clineAuthStatus" class="muted">Not signed in</p><label id="clineAuthUrlLabel" hidden>Authorization URL<input id="clineAuthUrl" readonly></label></section>
        <section class="settings-section"><h3>Model</h3><label>Selected Cline model<select id="clineModel"><option value="">Select model</option></select></label><div class="button-row"><button id="clineRefreshModels" class="secondary-button" type="button">Discover models</button><button id="clineTest" class="secondary-button" type="button">Test READY</button></div><p class="muted">Models with zero-cost metadata from the installed Cline catalog are marked FREE. Availability still depends on the signed-in account and live provider.</p></section>
      </div>
      <div class="settings-actions"><button id="clineSave" class="primary-button" type="button">Use Cline provider</button></div>
    </section>
    <details class="settings-disclosure"><summary>Tool server</summary><p>Optional. Configure this only when you operate a local MCP tool server.</p><label>MCP server command<input id="mcpServerCommand" placeholder="e.g. npx -y @modelcontextprotocol/server-filesystem ."></label><p class="muted">Enable or disable it from the top bar after saving.</p></details>
    <details class="settings-disclosure"><summary>Runtime controls</summary><p>Use the top-bar controls to stop or recreate the current local runtime. Those actions do not alter provider settings.</p></details>
    <details class="settings-disclosure"><summary>Agent engine</summary><p>The provider is separate from the agent/session runtime. The legacy Cline-style planning engine toggle remains independent of Cline provider selection.</p><label><input id="useClineStyle" type="checkbox"> Use Cline-style agent engine</label></details>
    <section class="settings-card browser-settings">
      <div><p class="eyebrow">03 · BROWSER</p><h2>Managed Chrome defaults</h2><p class="muted">These are saved for future runs. Open the managed browser from Task.</p></div>
      <label>Profile folder<div class="settings-path-row"><input id="browserProfilePath" autocomplete="off" placeholder="Choose a dedicated Chrome profile folder"><button id="chooseChromeProfile" class="secondary-button" type="button">Choose…</button></div></label>
      <label>Chrome executable (optional)<input id="browserExecutable" autocomplete="off" placeholder="Auto-detect Google Chrome"></label>
      <div class="button-row"><button id="saveBrowserSettings" class="primary-button" type="button">Save browser defaults</button></div>
      <div id="browserSettingsStatus" class="notice" hidden></div>
    </section>
    <div id="settingsStatus" class="notice" hidden></div>
  `;
}

function setBusy(button, busy) {
  if (button) button.disabled = busy === true;
}

function normalized(value) { return String(value || '').trim(); }
function messageFor(error, fallback) { return error && error.message ? error.message : fallback; }
const settingsById = id => document.getElementById(id);

function replaceClineModels(models = [], catalog = [], selected = '') {
  const select = settingsById('clineModel');
  if (!select) return;
  const freeById = new Map((Array.isArray(catalog) ? catalog : []).map(item => [item.id, item.free === true]));
  const options = [new Option('Select model', '')];
  for (const model of Array.isArray(models) ? models : []) {
    options.push(new Option(`${model}${freeById.get(model) ? ' · FREE' : ''}`, model));
  }
  if (selected && !models.includes(selected)) options.push(new Option(`${selected} (saved, unavailable)`, selected));
  select.replaceChildren(...options);
  select.value = selected && options.some(option => option.value === selected) ? selected : '';
}

function renderClineAuth(auth = {}) {
  const status = settingsById('clineAuthStatus');
  if (!status) return;
  status.textContent = auth.authenticated
    ? `Signed in${auth.email ? ` · ${auth.email}` : ''}${auth.persisted === false ? ' · session only' : ''}`
    : (auth.error || 'Not signed in');
}

async function bindClineSettings({ api, ui }) {
  const login = settingsById('clineLogin');
  const logout = settingsById('clineLogout');
  const refresh = settingsById('clineRefreshModels');
  const test = settingsById('clineTest');
  const save = settingsById('clineSave');
  const model = settingsById('clineModel');
  const authUrl = settingsById('clineAuthUrl');
  const authUrlLabel = settingsById('clineAuthUrlLabel');
  if (!login || !refresh || !test || !save || !model) return;

  const preferences = await api.preferences();
  let selected = normalized(preferences?.clineModel);
  replaceClineModels([], [], selected);

  api.onAgentEvent?.(event => {
    if (event?.phase === 'cline.auth.required') {
      if (authUrl) authUrl.value = normalized(event.url);
      if (authUrlLabel) authUrlLabel.hidden = !normalized(event.url);
      if (settingsById('clineAuthStatus')) {
        settingsById('clineAuthStatus').textContent = event.instructions || 'Open the authorization URL in your browser to finish sign-in.';
      }
    } else if (event?.phase === 'cline.auth.progress' && settingsById('clineAuthStatus')) {
      settingsById('clineAuthStatus').textContent = event.message || event.detail || 'Cline authentication in progress…';
    }
  });

  async function discover(extra = {}) {
    const result = await api.providerConfigure({
      providerKind: 'cline',
      clineProviderId: 'cline',
      clineModel: normalized(model.value) || selected,
      discoverOnly: true,
      persist: false,
      ...extra,
    });
    if (result?.error) throw new Error(result.error);
    selected = normalized(model.value) || selected;
    replaceClineModels(result.models || [], result.modelCatalog || [], selected);
    renderClineAuth(result.auth || {});
    return result;
  }

  login.addEventListener('click', async () => {
    setBusy(login, true);
    try {
      ui.footerProvider.textContent = 'Cline · waiting for sign-in…';
      const result = await discover({ clineLogin: true });
      renderClineAuth(result.auth || {});
      ui.footerProvider.textContent = result.auth?.authenticated ? 'Cline · signed in' : 'Cline · sign-in incomplete';
    } catch (error) {
      ui.footerProvider.textContent = messageFor(error, 'Cline sign-in failed');
      if (settingsById('clineAuthStatus')) settingsById('clineAuthStatus').textContent = messageFor(error, 'Cline sign-in failed');
    } finally {
      setBusy(login, false);
    }
  });

  logout?.addEventListener('click', async () => {
    setBusy(logout, true);
    try {
      const result = await discover({ clineLogout: true });
      renderClineAuth(result.auth || {});
      ui.footerProvider.textContent = 'Cline · signed out';
    } catch (error) {
      ui.footerProvider.textContent = messageFor(error, 'Cline sign-out failed');
    } finally {
      setBusy(logout, false);
    }
  });

  refresh.addEventListener('click', async () => {
    setBusy(refresh, true);
    try {
      ui.footerProvider.textContent = 'Cline · loading model catalog…';
      const result = await discover();
      ui.footerProvider.textContent = `Cline · ${result.models?.length || 0} model(s)`;
    } catch (error) {
      ui.footerProvider.textContent = messageFor(error, 'Could not load Cline models');
    } finally {
      setBusy(refresh, false);
    }
  });

  test.addEventListener('click', async () => {
    setBusy(test, true);
    try {
      const clineModel = normalized(model.value);
      if (!clineModel) throw new Error('Select a Cline model before testing.');
      const configured = await api.providerConfigure({ providerKind: 'cline', clineProviderId: 'cline', clineModel, persist: false });
      if (!configured.provider?.healthy) throw new Error(configured.provider?.failureReason || 'Cline provider is not ready.');
      const completion = await api.providerReadiness();
      const observed = normalized(completion?.text || completion?.summary);
      if (observed !== 'READY') throw new Error(`Readiness response mismatch. Expected READY; observed ${observed || '(empty)'}.`);
      ui.footerProvider.textContent = `${clineModel} · verified READY`;
    } catch (error) {
      ui.footerProvider.textContent = messageFor(error, 'Cline readiness failed');
    } finally {
      setBusy(test, false);
    }
  });

  save.addEventListener('click', async () => {
    setBusy(save, true);
    try {
      const clineModel = normalized(model.value);
      if (!clineModel) throw new Error('Select a Cline model before saving.');
      const requested = { providerKind: 'cline', clineProviderId: 'cline', clineModel };
      const configured = await api.providerConfigure({ ...requested, persist: false });
      if (!configured.provider?.healthy) throw new Error(configured.provider?.failureReason || 'Cline provider is not ready.');
      const persisted = await api.savePreferences(requested);
      if (persisted?.providerKind !== 'cline' || persisted?.clineModel !== clineModel) {
        throw new Error('Cline provider preference persistence verification failed.');
      }
      selected = clineModel;
      ui.footerProvider.textContent = `${clineModel} · Cline provider active`;
    } catch (error) {
      ui.footerProvider.textContent = messageFor(error, 'Could not activate Cline provider');
    } finally {
      setBusy(save, false);
    }
  });

  discover().catch(() => {});
}

function bind({ api, ui }) {
  if (!api || !ui) throw new Error('Settings module requires api and ui.');
  if (!window.LmStudioSettingsBridge) throw new Error('LM Studio settings bridge is not loaded.');

  const lmStudio = window.LmStudioSettingsBridge.bindLmStudioSettings({ api, ui });
  bindClineSettings({ api, ui }).catch(error => {
    ui.footerProvider.textContent = messageFor(error, 'Could not initialize Cline settings');
  });
  const showBrowserStatus = (text, state = 'ready') => { const status = settingsById('browserSettingsStatus'); if (!status) return; status.hidden = false; status.dataset.state = state; status.textContent = text; };
  ui.chooseChromeProfile?.addEventListener('click', async () => { try { const result = await api.selectChromeProfile(ui.browserProfilePath?.value || ''); if (!result?.canceled) ui.browserProfilePath.value = result.path || ''; } catch (error) { showBrowserStatus(messageFor(error, 'Could not choose a profile folder.'), 'error'); } });
  ui.saveBrowserSettings?.addEventListener('click', async () => { setBusy(ui.saveBrowserSettings, true); showBrowserStatus('Saving browser defaults…', 'working'); try { const saved = await api.savePreferences({ browserMode: 'managed', browserProfilePath: ui.browserProfilePath.value, browserExecutable: ui.browserExecutable.value, browserCdpPort: null }); showBrowserStatus(saved.browserProfilePath ? 'Browser defaults saved. Open Task to launch Chrome.' : 'Choose a profile folder before launching managed Chrome.'); } catch (error) { showBrowserStatus(messageFor(error, 'Could not save browser defaults.'), 'error'); } finally { setBusy(ui.saveBrowserSettings, false); } });
  ui.testConnection.addEventListener('click', async () => {
    setBusy(ui.testConnection, true);
    try { await lmStudio.testConnection(); }
    catch (error) { ui.footerProvider.textContent = messageFor(error, 'LM Studio unavailable'); }
    finally { setBusy(ui.testConnection, false); }
  });

  ui.saveSettings.addEventListener('click', async () => {
    setBusy(ui.saveSettings, true);
    try { await lmStudio.save(); }
    catch (error) { ui.footerProvider.textContent = messageFor(error, 'Could not save settings'); }
    finally { setBusy(ui.saveSettings, false); }
  });
}

window.SettingsModule = Object.freeze({ template, bind });
