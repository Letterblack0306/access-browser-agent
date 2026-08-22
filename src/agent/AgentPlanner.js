'use strict';

/**
 * AgentPlanner — generates structured, checkable task plans from objectives.
 * Mirrors Cline-style plan mode: inspect → plan → checkable steps → execute.
 */

/**
 * Parse a plan from the model's structured response. The model returns a
 * plan envelope when it runs the `createPlan` tool. This module normalizes
 * that into checkable steps with status transitions.
 */

const PLAN_MARKERS = Object.freeze({
  START: '=== ACCESS AGENT PLAN START ===',
  END: '=== ACCESS AGENT PLAN END ===',
});

const STEP_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
});

class TaskPlan {
  constructor({ objective, steps = [], sessionId = 'session' } = {}) {
    this.planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessionId = sessionId;
    this.objective = String(objective || '').trim();
    this.phase = 'active';
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.steps = Array.isArray(steps) ? steps.map((step, index) => normalizeStep(step, index)) : [];
  }

  addStep(step) {
    const normalized = normalizeStep(step, this.steps.length);
    this.steps.push(normalized);
    this._touch();
    return normalized;
  }

  markRunning(index) {
    const step = this.steps[index];
    if (!step) return null;
    // FIX #4: No transition after terminal. A completed/failed/blocked step
    // cannot be re-marked running.
    if (step.status === STEP_STATUS.COMPLETED || step.status === STEP_STATUS.FAILED || step.status === STEP_STATUS.BLOCKED) {
      return step;
    }
    step.status = STEP_STATUS.RUNNING;
    step.startedAt = step.startedAt || new Date().toISOString();
    this._touch();
    return step;
  }

  markCompleted(index, detail = '') {
    const step = this.steps[index];
    if (!step) return null;
    if (step.status === STEP_STATUS.COMPLETED || step.status === STEP_STATUS.FAILED || step.status === STEP_STATUS.BLOCKED) {
      return step;
    }
    step.status = STEP_STATUS.COMPLETED;
    step.completedAt = new Date().toISOString();
    step.detail = String(detail || '');
    step.planNodeId = step.id;
    this._touch();
    if (this.steps.every(item => item.status === STEP_STATUS.COMPLETED)) {
      this.phase = 'completed';
    }
    return step;
  }

  markFailed(index, error = '') {
    const step = this.steps[index];
    if (!step) return null;
    if (isTerminalStep(step.status)) return step;
    step.status = STEP_STATUS.FAILED;
    step.error = String(error || '');
    step.completedAt = new Date().toISOString();
    this._touch();
    this.phase = 'failed';
    return step;
  }

  markBlocked(index, reason = '') {
    const step = this.steps[index];
    if (!step) return null;
    if (isTerminalStep(step.status)) return step;
    step.status = STEP_STATUS.BLOCKED;
    step.error = String(reason || '');
    this._touch();
    this.phase = 'blocked';
    return step;
  }

  progress() {
    const total = this.steps.length;
    const completed = this.steps.filter(step => step.status === STEP_STATUS.COMPLETED).length;
    return {
      total,
      completed,
      remaining: total - completed,
      percent: total ? Math.round((completed / total) * 100) : 0,
    };
  }

  serialize() {
    return {
      planId: this.planId,
      sessionId: this.sessionId,
      objective: this.objective,
      phase: this.phase,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      steps: this.steps,
      progress: this.progress(),
    };
  }

  /**
   * Build a TaskPlan from free-text plan output (Cline-style plan envelope).
   * The model produces numbered steps like:
   *   1. Inspect workspace structure
   *   2. Read package.json
   * Parsing tolerates markdown bullets, numbering, and sub-headers.
   */
  static fromRawPlan(rawText, meta = {}) {
    const text = String(rawText || '').trim();
    if (!text) return new TaskPlan({ objective: meta.objective || '', sessionId: meta.sessionId });

    // Extract plan envelope if present
    let planText = text;
    const startIndex = text.indexOf(PLAN_MARKERS.START);
    const endIndex = text.indexOf(PLAN_MARKERS.END);
    if (startIndex >= 0 && endIndex > startIndex) {
      planText = text.slice(startIndex + PLAN_MARKERS.START.length, endIndex).trim();
    }

    const lines = planText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const steps = [];
    const stepPattern = /^(?:\d+[.)]\s*|[-*•]\s*|(?:Step|Phase)\s*\d+[.:]\s*)/iu;

    for (const line of lines) {
      // Skip section headers and non-step lines
      if (/^(objective|summary|overview|result|final|note|return)(\s*[:—-]|$)/iu.test(line)) continue;
      const match = stepPattern.exec(line);
      if (!match) continue;
      const title = line.slice(match[0].length).trim();
      if (!title) continue;
      steps.push({ title });
    }

    // Fallback: if no structured steps found, treat non-empty lines as steps
    if (!steps.length) {
      for (const line of lines) {
        if (/^[A-Z][^.]{3,}\.?$/u.test(line) || line.length > 8) {
          steps.push({ title: line.replace(/[.!]+$/u, '') });
        }
      }
    }

    const plan = new TaskPlan({ objective: meta.objective || '', steps: steps.slice(0, 40), sessionId: meta.sessionId });
    if (!steps.length && meta.fallbackSteps?.length) {
      meta.fallbackSteps.forEach((step, index) => plan.addStep({ title: step, status: index === 0 ? STEP_STATUS.PENDING : STEP_STATUS.PENDING }));
    }
    return plan;
  }

  _touch() {
    this.updatedAt = new Date().toISOString();
  }
}

function normalizeStep(step, index) {
  const source = typeof step === 'string' ? { title: step } : step || {};
  return {
    id: String(source.id || `step-${index + 1}`),
    index: index + 1,
    title: String(source.title || source.label || `Step ${index + 1}`).trim(),
    description: String(source.description || '').trim(),
    status: Object.values(STEP_STATUS).includes(source.status) ? source.status : STEP_STATUS.PENDING,
    detail: String(source.detail || '').trim(),
    error: String(source.error || '').trim(),
    startedAt: source.startedAt || null,
    completedAt: source.completedAt || null,
  };
}

function isTerminalStep(status) {
  return [STEP_STATUS.COMPLETED, STEP_STATUS.FAILED, STEP_STATUS.BLOCKED].includes(status);
}

/**
 * Derive a planner prompt for the LLM. The model sees the objective and the
 * registered tool manifest, then returns a plan envelope.
 */
function plannerSystemPrompt(registry, objective = '') {
  const tools = typeof registry.capabilityManifest === 'function' ? registry.capabilityManifest() : [];
  const toolLines = tools.map(tool => {
    const approval = tool.requiresApproval ? ' (approval required)' : '';
    return `- ${tool.name} — ${tool.description || tool.category || 'tool'}${approval}`;
  });
  return [
    'You are a task planner for an engineering agent.',
    `Objective: ${String(objective || '').trim()}`,
    '',
    'Available tools:',
    ...(toolLines.length ? toolLines : ['- (no tools registered)']),
    '',
    'Return EXACTLY one plan envelope with numbered, checkable steps.',
    'Each step must be a concrete action the agent can execute with the available tools.',
    'Keep the plan between 2 and 12 steps. Do not include explanation outside the envelope.',
    '',
    PLAN_MARKERS.START,
    `VERSION: 1`,
    `OBJECTIVE: ${String(objective || '').trim()}`,
    'STEPS:',
    '1. <concrete step>',
    '2. <concrete step>',
    PLAN_MARKERS.END,
  ].join('\n');
}

/**
 * Extract a plan envelope from assistant content if present.
 */
function extractPlanEnvelope(content) {
  const text = String(content || '');
  const startIndex = text.indexOf(PLAN_MARKERS.START);
  const endIndex = text.indexOf(PLAN_MARKERS.END);
  if (startIndex < 0 || endIndex <= startIndex) return null;
  return text.slice(startIndex + PLAN_MARKERS.START.length, endIndex).trim();
}

module.exports = {
  TaskPlan,
  STEP_STATUS,
  PLAN_MARKERS,
  plannerSystemPrompt,
  extractPlanEnvelope,
};
