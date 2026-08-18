'use strict';

function normalized(value) {
  return String(value || '').trim();
}

function optionalPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function createField({ id, label, type = 'text', options = [], placeholder = '' }) {
  const wrapper = document.createElement('label');
  wrapper.dataset.lmStudioAdvanced = id;
  wrapper.append(document.createTextNode(label));
  let control;
  if (options.length) {
    control = document.createElement('select');
    for (const option of options) control.append(new Option(option.label, option.value));
  } else {
    control = document.createElement('input');
    control.type = type;
    control.placeholder = placeholder;
  }
  control.id = id;
  wrapper.append(control);
  return wrapper;
}

const lmSettingsById = id => document.getElementById(id);

function ensureAdvancedFields(ui) {
  if (lmSettingsById('lmStudioApiKey')) return;
  const access = document.getElementById('lmStudioSecurityFields');
  const runtime = document.getElementById('lmStudioRuntimeFields');
  if (!access || !runtime) return;
  const accessFields = [
    createField({ id: 'lmStudioApiKey', label: 'LM Studio API token', type: 'password', placeholder: 'Optional Bearer token' }),
    createField({
      id: 'lmStudioEndpointPolicy',
      label: 'Endpoint access policy',
      options: [
        { value: 'loopback', label: 'Loopback only' },
        { value: 'private-network', label: 'Loopback + private network' },
        { value: 'any-http', label: 'Any HTTP/HTTPS endpoint' },
      ],
    }),
  ];
  const runtimeFields = [
    createField({ id: 'lmStudioContextLength', label: 'Context length', type: 'number', placeholder: 'Provider/model default' }),
    createField({ id: 'lmStudioTtlSeconds', label: 'JIT idle TTL (seconds)', type: 'number', placeholder: 'LM Studio default' }),
  ];
  access.append(...accessFields);
  runtime.append(...runtimeFields);
}

async function loadAdvancedPreferences(api) {
  const preferences = await api.preferences();
  const values = {
    lmStudioApiKey: preferences?.lmStudioApiKey || '',
    lmStudioEndpointPolicy: preferences?.lmStudioEndpointPolicy || 'private-network',
    lmStudioContextLength: preferences?.lmStudioContextLength || '',
    lmStudioTtlSeconds: preferences?.lmStudioTtlSeconds || '',
  };
  for (const [id, value] of Object.entries(values)) {
    const element = lmSettingsById(id);
    if (element) element.value = String(value ?? '');
  }
  const clineCheckbox = document.getElementById('useClineStyle');
  if (clineCheckbox) clineCheckbox.checked = preferences?.useClineStyle === true;
}

function providerFields(ui) {
  return {
    providerKind: 'lm-studio',
    lmStudioBaseUrl: normalized(ui.baseUrl.value),
    lmStudioModel: normalized(ui.model.value),
    lmStudioApiKey: normalized(lmSettingsById('lmStudioApiKey')?.value),
    lmStudioEndpointPolicy: normalized(lmSettingsById('lmStudioEndpointPolicy')?.value) || 'private-network',
    lmStudioContextLength: optionalPositiveInteger(lmSettingsById('lmStudioContextLength')?.value),
    lmStudioTtlSeconds: optionalPositiveInteger(lmSettingsById('lmStudioTtlSeconds')?.value),
    lmStudioConversationMode: 'application',
    mcpServerCommand: normalized(ui.mcpServerCommand.value),
    useClineStyle: Boolean(document.getElementById('useClineStyle')?.checked),
  };
}

function completionText(completion) {
  const candidates = [
    completion?.summary,
    completion?.response,
    completion?.text,
    completion?.result?.summary,
    completion?.result?.response,
    completion?.result?.text,
    completion?.state?.completion?.summary,
  ];
  return candidates.map(normalized).find(Boolean) || '';
}

function replaceModelOptions(ui, models) {
  const previousModel = normalized(ui.model.value);
  const options = [new Option('Select model', '')];
  for (const model of models) options.push(new Option(model, model));
  if (previousModel && !models.includes(previousModel)) {
    options.push(new Option(`${previousModel} (saved, unavailable)`, previousModel));
  }
  ui.model.replaceChildren(...options);
  ui.model.value = previousModel && options.some(option => option.value === previousModel)
    ? previousModel
    : '';
}

function bindLmStudioSettings({ api, ui }) {
  if (!api || !ui) throw new Error('LM Studio settings bridge requires api and ui.');
  ensureAdvancedFields(ui);
  loadAdvancedPreferences(api).catch(error => {
    ui.footerProvider.textContent = error?.message || 'Could not load LM Studio preferences';
  });

  async function discoverModels() {
    const requested = providerFields(ui);
    if (!requested.lmStudioBaseUrl) throw new Error('LM Studio base URL is required.');
    const result = await api.providerConfigure({ ...requested, discoverOnly: true, persist: false });
    if (result?.error) throw new Error(result.error);
    if (!Array.isArray(result?.models)) throw new Error('LM Studio model discovery returned no model list.');
    return result;
  }

  async function testConnection() {
    const requested = providerFields(ui);
    if (!requested.lmStudioBaseUrl) throw new Error('LM Studio base URL is required.');
    if (!requested.lmStudioModel) throw new Error('Select a model before testing.');
    ui.footerProvider.textContent = `${requested.lmStudioModel} · testing selected model…`;
    const configured = await api.providerConfigure({ ...requested, persist: false });
    if (!configured.provider?.healthy || configured.provider?.modelAvailable === false) {
      throw new Error(configured.error || configured.provider?.failureReason || 'LM Studio unavailable.');
    }
    const completion = await api.providerReadiness();
    if (completion?.ok === false) {
      throw new Error(completion.error || completion.summary || 'The selected model did not complete the readiness request.');
    }
    const observed = completionText(completion);
    if (observed !== 'READY') {
      throw new Error(`Readiness response mismatch. Expected READY; observed ${observed || '(empty)'}.`);
    }
    ui.footerProvider.textContent = `${requested.lmStudioModel} · verified READY`;
    return { ...configured, completion, readinessVerified: true };
  }

  async function save() {
    const requested = providerFields(ui);
    if (!requested.lmStudioBaseUrl) throw new Error('LM Studio base URL is required.');
    if (!requested.lmStudioModel) throw new Error('Select a model before saving.');
    ui.footerProvider.textContent = `${requested.lmStudioModel} · saving…`;
    const previousPreferences = await api.preferences();
    const configured = await api.providerConfigure({ ...requested, persist: false });
    const persisted = await api.savePreferences(requested);
    const mismatches = Object.entries(requested)
      .filter(([key, value]) => normalized(persisted?.[key]) !== normalized(value))
      .map(([key]) => key);
    if (mismatches.length) {
      throw new Error(`Settings persistence verification failed: ${mismatches.join(', ')}.`);
    }
    const previousClineStyle = previousPreferences?.useClineStyle === true;
    const newClineStyle = requested.useClineStyle === true;
    if (previousClineStyle !== newClineStyle) {
      try {
        ui.footerProvider.textContent = `${requested.lmStudioModel} · restarting runtime…`;
        await api.runtimeRestart();
      } catch (error) {
        console.error('Failed to restart runtime after engine change:', error);
      }
    }
    ui.footerProvider.textContent = configured.provider?.healthy
      ? `${requested.lmStudioModel} · saved and active`
      : `${requested.lmStudioModel} · saved; provider unavailable`;
    return { ...configured, persisted, persistenceVerified: true };
  }

  ui.refreshModels.addEventListener('click', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    ui.refreshModels.disabled = true;
    ui.footerProvider.textContent = 'LM Studio · discovering models…';
    try {
      const result = await discoverModels();
      replaceModelOptions(ui, result.models);
      ui.footerProvider.textContent = result.models.length
        ? `${ui.model.value || 'LM Studio'} · ${result.models.length} model(s)`
        : 'LM Studio connected · no models';
    } catch (error) {
      ui.footerProvider.textContent = error?.message || 'Could not load models';
    } finally {
      ui.refreshModels.disabled = false;
    }
  }, { capture: true });

  return { discoverModels, testConnection, save, providerFields };
}

window.LmStudioSettingsBridge = Object.freeze({ bindLmStudioSettings, completionText });
