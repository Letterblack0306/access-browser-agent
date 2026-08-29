'use strict';
const { AgentRuntimeAdapter } = require('./agent-runtime-adapter');

// --- PATCH: Loopback State & Feedback ---
AgentRuntimeAdapter.prototype.getState = function() {
    if (this.loopActive) return { status: 'running' };
    if (this.waitingForInstruction) return { status: 'waiting_for_instruction' };
    return { status: 'stopped' };
};

AgentRuntimeAdapter.prototype.checkForFeedback = async function() {
    const fs = require('fs');
    const path = require('path');
    const feedbackPath = path.join(this.workspaceRoot, 'pending_instruction.json');
    if (fs.existsSync(feedbackPath)) {
        try {
            const raw = fs.readFileSync(feedbackPath, 'utf8');
            const feedback = JSON.parse(raw);
            fs.renameSync(feedbackPath, feedbackPath + '.processed');
            return { newInstruction: feedback };
        } catch (e) {
            return { error: e.message };
        }
    }
    return null;
};

// --- PATCH: Model Fallback Rotation ---


AgentRuntimeAdapter.prototype.discoverModels = async function() {
    const settings = this.getSettings ? this.getSettings() : {};
    const baseUrl = settings.lmStudioBaseUrl || 'http://127.0.0.1:1234/v1';
    const configuredModel = settings.lmStudioModel || '';

    let lmModels = [];
    try {
        const lmRes = await this.updateProviderSettings({ providerKind: 'lm-studio', lmStudioBaseUrl: baseUrl, discoverOnly: true });
        lmModels = (lmRes.models || []).map(m => {
            if (typeof m === 'string') return { id: m, name: m, provider: 'lm-studio', status: 'available' };
            return { ...m, provider: 'lm-studio', status: 'available' };
        });
    } catch(e) { this.lastPoolError = e.message; }

    let clineModels = [];
    try {
        const clineRes = await this.updateProviderSettings({ providerKind: 'cline', clineProviderId: 'cline', discoverOnly: true });
        clineModels = (clineRes.models || []).map(m => {
            if (typeof m === 'string') return { id: m, name: m, provider: 'cline', status: 'available' };
            return { ...m, provider: 'cline', status: 'available' };
        });
    } catch(e) { this.lastPoolError = e.message; }

    this.modelPool = [...lmModels, ...clineModels].filter(m => m.pricing?.classification === 'free' || m.free === true || m.id.includes('gemma') || m.id.includes('qwen')).slice(0, 5); // Only free/small models
    this.currentPoolIndex = 0;
    this.roundExhausted = false;
    return this.modelPool;
};



AgentRuntimeAdapter.prototype.getNextAvailableModel = function() {
    if (this.modelPool.length === 0 || this.roundExhausted) return null;
    for (let i = 0; i < this.modelPool.length; i++) {
        const idx = (this.currentPoolIndex + i) % this.modelPool.length;
        if (this.modelPool[idx].status === 'available') {
            this.currentPoolIndex = (idx + 1) % this.modelPool.length;
            return this.modelPool[idx];
        }
    }
    this.roundExhausted = true;
    return null;
};

AgentRuntimeAdapter.prototype.markModelExhausted = function(modelId) {
    const model = this.modelPool.find(m => m.id === modelId);
    if (model) {
        model.status = 'exhausted';
        if (this.modelPool.every(m => m.status === 'exhausted')) {
            this.roundExhausted = true;
        }
    }
};


AgentRuntimeAdapter.prototype.executeWithFallback = async function(input) {
    let model = this.getNextAvailableModel();
    if (!model) {
        return { error: 'NO_AVAILABLE_MODEL', message: 'All models exhausted or unavailable.' };
    }

    // Set loop state to running
    this.loopActive = true;
    this.waitingForInstruction = false;

    try {
        // Use the actual base class run() method (not start())
        const result = await this.run({ ...input, model: model.id });
        
        // If the objective completed, set state to waiting for next instruction
        if (result?.ok === true || result?.terminalState === 'objective_completed') {
            this.waitingForInstruction = true;
        }
        
        this.roundExhausted = false;
        return result;
    } catch (e) {
        // If rate limited or exhausted, mark model and try next
        if (e.message.includes('429') || e.message.includes('rate') || e.message.includes('exhausted')) {
            this.markModelExhausted(model.id);
            return this.executeWithFallback(input);
        }
        throw e;
    } finally {
        this.loopActive = false;
    }
};


module.exports = { AgentRuntimeAdapter };

// --- PATCH: P2 Prompting Improvements ---
AgentRuntimeAdapter.prototype.injectPromptRules = function(basePrompt) {
    return basePrompt + "\n\nCRITICAL RULES:\n1. When searchFiles returns matches, read the most relevant file before searching for another term.\n2. You already searched for X and found nothing. Try a different approach.";
};

