'use strict';

/**
 * Task State panel — right-side workbench module.
 * Shows current goal, active level, level list, evidence, decisions,
 * and the four state cards (blocked / needs_decision / level_complete / complete).
 *
 * Mount contract:
 *   window.TaskStatePanel.mount(selector, { ipc })
 * ipc must expose:
 *   ipc.invoke('task-state:snapshot') -> Promise<Snapshot>
 *   ipc.on('task-state:update', (snapshot) => {})
 *
 * ASSUMPTION: element ids below (taskState*) are new — not present anywhere
 * else in the app yet. They must be added to ui-id-registry.js (done in the
 * companion patch) before assertAllowedUiId() will allow them.
 */
(function () {
  const ROOT_HTML = `
    <div id="taskStatePanel" class="ts-panel">
      <div class="ts-header">
        <div class="ts-goal-row">
          <span class="ts-label">Goal</span>
          <span id="taskStateGoal" class="ts-goal">No active goal</span>
        </div>
        <div class="ts-level-row">
          <span class="ts-label">Level</span>
          <span id="taskStateLevel" class="ts-level">—</span>
        </div>
      </div>

      <div id="taskStateEmpty" class="ts-empty">No active task session.</div>

      <div class="ts-body" hidden>
        <section class="ts-section">
          <h4 class="ts-section-title">Levels</h4>
          <ul id="taskStateLevelsList" class="ts-list"></ul>
        </section>

        <section class="ts-section">
          <h4 class="ts-section-title">Evidence</h4>
          <ul id="taskStateEvidenceList" class="ts-list ts-list--evidence"></ul>
        </section>

        <section class="ts-section">
          <h4 class="ts-section-title">Decisions</h4>
          <ul id="taskStateDecisionsList" class="ts-list ts-list--decisions"></ul>
        </section>

        <div id="taskStateBlockerCard" class="ts-card ts-card--blocked" hidden>
          <div class="ts-card-title">Blocked</div>
          <div class="ts-card-body"></div>
        </div>
        <div id="taskStateDecisionCard" class="ts-card ts-card--decision" hidden>
          <div class="ts-card-title">Needs decision</div>
          <div class="ts-card-body"></div>
        </div>
        <div id="taskStateLevelCompleteCard" class="ts-card ts-card--level-complete" hidden>
          <div class="ts-card-title">Level complete</div>
          <div class="ts-card-body"></div>
        </div>
        <div id="taskStateCompleteCard" class="ts-card ts-card--complete" hidden>
          <div class="ts-card-title">Complete</div>
          <div class="ts-card-body"></div>
        </div>
      </div>
    </div>
  `;

  function mount(selector, { ipc } = {}) {
    const host = document.querySelector(selector);
    if (!host) throw new Error(`task-state-panel: mount target "${selector}" not found`);
    if (!ipc || typeof ipc.invoke !== 'function' || typeof ipc.on !== 'function') {
      throw new Error('task-state-panel: mount requires an ipc bridge with invoke() and on()');
    }
    host.innerHTML = ROOT_HTML;

    const els = {
      goal: host.querySelector('#taskStateGoal'),
      level: host.querySelector('#taskStateLevel'),
      empty: host.querySelector('#taskStateEmpty'),
      body: host.querySelector('.ts-body'),
      levelsList: host.querySelector('#taskStateLevelsList'),
      evidenceList: host.querySelector('#taskStateEvidenceList'),
      decisionsList: host.querySelector('#taskStateDecisionsList'),
      blockerCard: host.querySelector('#taskStateBlockerCard'),
      decisionCard: host.querySelector('#taskStateDecisionCard'),
      levelCompleteCard: host.querySelector('#taskStateLevelCompleteCard'),
      completeCard: host.querySelector('#taskStateCompleteCard'),
    };

    function render(snapshot) {
      const hasTask = Boolean(snapshot && snapshot.goal);
      els.empty.hidden = hasTask;
      els.body.hidden = !hasTask;
      if (!hasTask) return;

      els.goal.textContent = snapshot.goal || 'No active goal';
      els.level.textContent = snapshot.activeLevel != null ? String(snapshot.activeLevel) : '—';

      renderList(els.levelsList, snapshot.levels, level => `${level.done ? '✓' : '○'} ${level.title || level.id}`);
      renderList(els.evidenceList, snapshot.evidence, item => String(item));
      renderList(els.decisionsList, snapshot.decisions, item => String(item.summary || item));

      setCard(els.blockerCard, snapshot.blocked);
      setCard(els.decisionCard, snapshot.needsDecision);
      setCard(els.levelCompleteCard, snapshot.levelComplete);
      setCard(els.completeCard, snapshot.complete);
    }

    function renderList(listEl, items, formatter) {
      listEl.innerHTML = '';
      (items || []).forEach(item => {
        const li = document.createElement('li');
        li.textContent = formatter(item);
        listEl.appendChild(li);
      });
    }

    function setCard(cardEl, data) {
      if (!data) {
        cardEl.hidden = true;
        return;
      }
      cardEl.hidden = false;
      cardEl.querySelector('.ts-card-body').textContent = typeof data === 'string' ? data : (data.summary || JSON.stringify(data));
    }

    ipc.invoke('task-state:snapshot').then(render).catch(() => render(null));
    ipc.on('task-state:update', render);

    return { render, els };
  }

  window.TaskStatePanel = { mount };
})();
