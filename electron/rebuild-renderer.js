'use strict';

(() => {
  // Minimal, stable UI wrapper for the Access Agent Loop
  const $ = (id) => document.getElementById(id);

  // --- UI State ---
  let isRunning = false;

  // --- Initialization ---
  async function init() {
    console.log('New Clean UI Loaded.');

    // Load models using the safe handler
    try {
      const models = await window.accessAgentRuntime.getModels();
      const modelSelect = $('model-select');
      if (modelSelect && models && models.length > 0) {
        modelSelect.innerHTML = '';
        models.forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m.id || m.name;
          opt.textContent = m.name || m.id;
          modelSelect.appendChild(opt);
        });
        modelSelect.disabled = false;
      }
    } catch (e) {
      console.error('Failed to load models:', e);
    }

    // Bind buttons
    $('btn-start')?.addEventListener('click', async () => {
      try {
        const url = $('chat-url')?.value || '';
        const model = $('model-select')?.value;
        isRunning = true;
        updateUI();
        await window.accessAgentRuntime.start({ chatUrl: url, model });
      } catch (e) {
        console.error('Failed to start agent:', e);
        alert('Error starting agent: ' + e.message);
        isRunning = false;
        updateUI();
      }
    });

    $('btn-stop')?.addEventListener('click', async () => {
      try {
        isRunning = false;
        updateUI();
        await window.accessAgentRuntime.stop();
      } catch (e) {
        console.error('Failed to stop agent:', e);
      }
    });

    // Poll for status every 5 seconds
    setInterval(async () => {
      try {
        const status = await window.accessAgentRuntime.getStatus();
        const statusEl = $('status-text');
        if (statusEl) {
          statusEl.textContent = status?.state?.status?.toUpperCase() || 'UNKNOWN';
        }
      } catch (e) {
        // Ignore status polling errors
      }
    }, 5000);
  }

  function updateUI() {
    const startBtn = $('btn-start');
    const stopBtn = $('btn-stop');
    if (startBtn) startBtn.disabled = isRunning;
    if (stopBtn) stopBtn.disabled = !isRunning;
  }

  // --- Auto-Init ---
  document.addEventListener('DOMContentLoaded', init);
})();
