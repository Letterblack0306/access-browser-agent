'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Classification patterns
// ---------------------------------------------------------------------------

const BLOCKED_PATTERNS = [
  /\b(blocked|blocking|cannot (proceed|continue)|required before|need.*before|waiting on|awaiting (input|answer|decision))\b/i,
];

const DECISION_PATTERNS = [
  /\b(should (i|we|it)|do you want|which (approach|option|method)|choose|prefer|decide|pick)\b/i,
  /\?\s*$/m,
  /\b(option [a-d]|approach [a-d]|\d\.\s)/i,
];

const TASK_COMPLETE_PATTERNS = [/\b(task complete|all done|overall complete|mission complete)\b/i];

const LEVEL_COMPLETE_PATTERNS = [/\bDONE\b/, /\b(level complete|phase complete|step complete)\b/i];

const ACTIONABLE_PATTERNS = [
  /```[\s\S]*?```/,
  /\b(create|write|implement|add|remove|update|delete|run|execute|install|build|fix|refactor|move|rename)\b/i,
  /\b(step \d|do the following|here('s| is) what|next:|action:)\b/i,
];

const CONTEXT_DECISION_RE   = /\b(decided|agreed|confirmed|using|we('ll| will) use|going with|chosen)\b.*[.!]/gi;
const CONTEXT_CONSTRAINT_RE = /\b(must|should not|never|always|required|constraint|limit|boundary)\b.*[.!]/gi;
const CONTEXT_ARTIFACT_RE   = /`([^`]+\.(ts|js|json|md|jsx|tsx|py|sh))`/g;
const CONTEXT_EVIDENCE_RE   = /\b(passed|verified|confirmed|test|result|output|logged|observed)\b.*[.!]/gi;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesAny(text, patterns) {
  return patterns.some(p => p.test(text));
}

function extractFragments(text) {
  const fragments = [];
  for (const m of text.matchAll(CONTEXT_DECISION_RE))   fragments.push({ type: 'decision',    text: m[0].trim() });
  for (const m of text.matchAll(CONTEXT_CONSTRAINT_RE)) fragments.push({ type: 'constraint',  text: m[0].trim() });
  for (const m of text.matchAll(CONTEXT_ARTIFACT_RE))   fragments.push({ type: 'artifact',    text: m[1] });
  for (const m of text.matchAll(CONTEXT_EVIDENCE_RE))   fragments.push({ type: 'evidence',    text: m[0].trim() });
  return fragments;
}

function extractIntent(text) {
  const codeBlocks = [...text.matchAll(/```[\s\S]*?```/g)].map(m => m[0]);
  const imperativeLines = text.split('\n').filter(l =>
    /^\s*[-*\d.]\s/.test(l) ||
    /\b(create|write|implement|add|remove|update|delete|run|execute|install|build|fix|refactor)\b/i.test(l)
  ).slice(0, 20);
  return [...codeBlocks, ...imperativeLines].join('\n').trim();
}

function extractDecisionPrompt(text) {
  const questions = text.split('\n').filter(l => l.trim().endsWith('?')).slice(0, 3);
  return questions.join('\n').trim() || text.slice(0, 200);
}

function extractBlockerDescription(text) {
  const blockerLines = text.split('\n').filter(l => BLOCKED_PATTERNS.some(p => p.test(l))).slice(0, 3);
  return blockerLines.join('\n').trim() || text.slice(0, 200);
}

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// TaskStateController
// ---------------------------------------------------------------------------

class TaskStateController {
  constructor(workspace) {
    const dir = path.join(workspace, '.gpt-sync');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this._statePath = path.join(dir, 'task-state.json');
    this._state = this._load(workspace);
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  _load(workspace) {
    if (fs.existsSync(this._statePath)) {
      try { return JSON.parse(fs.readFileSync(this._statePath, 'utf8')); } catch {}
    }
    return {
      version: 1,
      workspace,
      goal: null,
      levels: [],
      context: { decisions: [], constraints: [], artifacts: [], evidence: [] },
      history: [],
      lastClassification: null,
    };
  }

  _save() {
    fs.writeFileSync(this._statePath, JSON.stringify(this._state, null, 2), 'utf8');
  }

  // -------------------------------------------------------------------------
  // Classification
  // Priority: blocked → needs_decision → task_complete → level_complete → actionable → conversational → unknown
  // -------------------------------------------------------------------------

  classify(reply) {
    const flags = {
      hasBlocker:      matchesAny(reply, BLOCKED_PATTERNS),
      hasDecision:     matchesAny(reply, DECISION_PATTERNS),
      hasTaskComplete: matchesAny(reply, TASK_COMPLETE_PATTERNS),
      hasLevelComplete:matchesAny(reply, LEVEL_COMPLETE_PATTERNS),
      hasActionable:   matchesAny(reply, ACTIONABLE_PATTERNS),
    };

    let kind;
    if (flags.hasTaskComplete) {
      // An explicit completion must win over an incidental status word; a
      // replied "all done" is not a blocker just because it also says "error"
      // or "failed" while describing prior work.
      kind = 'task_complete';
    } else if (flags.hasLevelComplete) {
      kind = 'level_complete';
    } else if (flags.hasBlocker) {
      kind = 'blocked';
    } else if (flags.hasDecision && !flags.hasTaskComplete && !flags.hasLevelComplete) {
      kind = 'needs_decision';
    } else if (flags.hasActionable) {
      kind = 'actionable';
    } else if (reply.trim().length > 0) {
      kind = 'conversational';
    } else {
      kind = 'unknown';
    }

    const classification = { kind, flags, contextFragments: extractFragments(reply), at: new Date().toISOString() };

    if (kind === 'actionable' || flags.hasActionable) classification.intent = extractIntent(reply);
    if (kind === 'needs_decision') classification.decisionPrompt = extractDecisionPrompt(reply);
    if (kind === 'blocked') classification.blockerDescription = extractBlockerDescription(reply);

    return classification;
  }

  // -------------------------------------------------------------------------
  // Main entry — classify + update state + persist
  // -------------------------------------------------------------------------

  process(reply) {
    const classification = this.classify(reply);
    this._applyFragments(classification.contextFragments);

    if (classification.kind === 'level_complete') this._completeActiveLevel();
    if (classification.kind === 'task_complete')  this._completeGoal();

    this._state.history.push({
      at: classification.at,
      kind: classification.kind,
      summary: reply.slice(0, 120).replace(/\n/g, ' '),
    });
    if (this._state.history.length > 200) this._state.history.shift();

    this._state.lastClassification = classification;
    this._save();
    return classification;
  }

  // -------------------------------------------------------------------------
  // Goal / level management
  // -------------------------------------------------------------------------

  setGoal(text) {
    this._state.goal = { id: newId('goal'), text: String(text || ''), status: 'active' };
    this._save();
  }

  addLevel(title) {
    const level = { id: newId('level'), title: String(title || ''), status: 'pending' };
    this._state.levels.push(level);
    this._save();
    return level;
  }

  activateLevel(levelId) {
    for (const l of this._state.levels) {
      if (l.id === levelId) l.status = 'active';
    }
    this._save();
  }

  _completeActiveLevel() {
    const active = this._state.levels.find(l => l.status === 'active');
    if (active) active.status = 'complete';
  }

  _completeGoal() {
    this._completeActiveLevel();
    if (this._state.goal) this._state.goal.status = 'complete';
  }

  // -------------------------------------------------------------------------
  // Context
  // -------------------------------------------------------------------------

  _applyFragments(fragments) {
    for (const f of fragments) {
      const key = `${f.type}s`;
      const list = this._state.context[key];
      if (Array.isArray(list) && !list.includes(f.text)) list.push(f.text);
    }
  }

  // -------------------------------------------------------------------------
  // Read (for UI / router)
  // -------------------------------------------------------------------------

  getState() { return this._state; }

  getActiveLevel() {
    return this._state.levels.find(l => l.status === 'active') || null;
  }

  getUISnapshot() {
    const level = this.getActiveLevel();
    const last  = this._state.lastClassification;
    return {
      goal:              this._state.goal?.text ?? null,
      goalStatus:        this._state.goal?.status ?? null,
      activeLevel:       level?.title ?? null,
      activeLevelStatus: level?.status ?? null,
      phase:             last?.kind ?? null,
      lastAt:            last?.at ?? null,
      evidence:          this._state.context.evidence.slice(-5),
      decisions:         this._state.context.decisions.slice(-5),
      blockers:          last?.kind === 'blocked'        ? [last.blockerDescription ?? ''] : [],
      pendingDecision:   last?.kind === 'needs_decision' ? (last.decisionPrompt ?? null)   : null,
      levels:            this._state.levels.map(l => ({ title: l.title, status: l.status })),
    };
  }

  reset() {
    const workspace = this._state.workspace;
    this._state = {
      version: 1,
      workspace,
      goal: null,
      levels: [],
      context: { decisions: [], constraints: [], artifacts: [], evidence: [] },
      history: [],
      lastClassification: null,
    };
    this._save();
  }
}

module.exports = { TaskStateController };
