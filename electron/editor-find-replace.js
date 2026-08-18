'use strict';

(() => {
  let matches = [];
  let activeMatch = -1;
  let replaceVisible = false;

  const byId = id => document.getElementById(id);

  function editor() {
    return byId('editorInput');
  }

  function currentNeedle() {
    return String(byId('editorFindInput')?.value || '');
  }

  function caseSensitive() {
    return Boolean(byId('editorFindCase')?.checked);
  }

  function setStatus(message) {
    const status = byId('editorFindStatus');
    if (status) status.textContent = message;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function calculateMatches() {
    const input = editor();
    const needle = currentNeedle();
    matches = [];
    activeMatch = -1;

    if (!input || !needle) {
      setStatus('');
      return matches;
    }

    const flags = caseSensitive() ? 'g' : 'gi';
    const expression = new RegExp(escapeRegExp(needle), flags);
    let match;

    while ((match = expression.exec(input.value)) !== null) {
      matches.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) expression.lastIndex += 1;
    }

    setStatus(matches.length ? `0 / ${matches.length}` : 'No results');
    return matches;
  }

  function revealMatch(index) {
    const input = editor();
    if (!input || !matches.length) return;

    activeMatch = (index + matches.length) % matches.length;
    const match = matches[activeMatch];
    input.focus();
    input.setSelectionRange(match.start, match.end);

    const before = input.value.slice(0, match.start);
    const line = before.split(/\r?\n/).length;
    const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight) || 18;
    input.scrollTop = Math.max(0, (line - 3) * lineHeight);
    input.dispatchEvent(new Event('scroll'));
    setStatus(`${activeMatch + 1} / ${matches.length}`);
  }

  function findNext(direction = 1) {
    const needle = currentNeedle();
    if (!needle) return;
    if (!matches.length) calculateMatches();
    if (!matches.length) return;
    revealMatch(activeMatch + direction);
  }

  function replaceCurrent() {
    const input = editor();
    if (!input || input.readOnly) return;
    if (!matches.length || activeMatch < 0) findNext(1);
    if (!matches.length || activeMatch < 0) return;

    const replacement = String(byId('editorReplaceInput')?.value || '');
    const match = matches[activeMatch];
    input.setRangeText(replacement, match.start, match.end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    calculateMatches();
    if (matches.length) revealMatch(Math.min(activeMatch, matches.length - 1));
  }

  function replaceAll() {
    const input = editor();
    const needle = currentNeedle();
    if (!input || input.readOnly || !needle) return;

    const replacement = String(byId('editorReplaceInput')?.value || '');
    const flags = caseSensitive() ? 'g' : 'gi';
    const expression = new RegExp(escapeRegExp(needle), flags);
    const original = input.value;
    const updated = original.replace(expression, replacement);

    if (updated === original) {
      setStatus('No results');
      return;
    }

    const replacedCount = (original.match(expression) || []).length;
    input.value = updated;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    calculateMatches();
    setStatus(`Replaced ${replacedCount}`);
  }

  function toggleReplace(force) {
    replaceVisible = typeof force === 'boolean' ? force : !replaceVisible;
    const row = byId('editorReplaceRow');
    const toggle = byId('editorReplaceToggle');
    if (!row || !toggle) return;
    row.hidden = !replaceVisible;
    toggle.setAttribute('aria-expanded', String(replaceVisible));
    toggle.textContent = replaceVisible ? '⌄' : '›';
    if (replaceVisible) byId('editorReplaceInput')?.focus();
  }

  function openFind(showReplace = false) {
    const panel = byId('editorFindPanel');
    if (!panel || !editor() || editor().hidden) return;
    panel.hidden = false;
    toggleReplace(showReplace);
    const find = byId('editorFindInput');
    find.focus();
    find.select();
    calculateMatches();
  }

  function closeFind() {
    const panel = byId('editorFindPanel');
    if (panel) panel.hidden = true;
    matches = [];
    activeMatch = -1;
    editor()?.focus();
  }

  function buildPanel() {
    const toolbar = document.querySelector('.editor-toolbar');
    if (!toolbar || byId('editorFindPanel')) return;

    const panel = document.createElement('section');
    panel.id = 'editorFindPanel';
    panel.className = 'editor-find-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="editor-find-row">
        <button id="editorReplaceToggle" class="find-icon-button" type="button" aria-label="Toggle replace" aria-expanded="false">›</button>
        <input id="editorFindInput" type="text" autocomplete="off" spellcheck="false" placeholder="Find">
        <span id="editorFindStatus" class="editor-find-status"></span>
        <label class="editor-find-option" title="Match case"><input id="editorFindCase" type="checkbox">Aa</label>
        <button id="editorFindPrevious" class="find-icon-button" type="button" title="Previous match">↑</button>
        <button id="editorFindNext" class="find-icon-button" type="button" title="Next match">↓</button>
        <button id="editorFindClose" class="find-icon-button" type="button" title="Close">×</button>
      </div>
      <div id="editorReplaceRow" class="editor-find-row editor-replace-row" hidden>
        <span class="find-row-spacer"></span>
        <input id="editorReplaceInput" type="text" autocomplete="off" spellcheck="false" placeholder="Replace">
        <button id="editorReplaceOne" class="find-text-button" type="button">Replace</button>
        <button id="editorReplaceAll" class="find-text-button" type="button">All</button>
      </div>`;

    toolbar.insertAdjacentElement('afterend', panel);

    byId('editorFindInput').addEventListener('input', () => {
      calculateMatches();
      if (matches.length) revealMatch(0);
    });
    byId('editorFindInput').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        findNext(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeFind();
      }
    });
    byId('editorReplaceInput').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        replaceCurrent();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeFind();
      }
    });
    byId('editorFindCase').addEventListener('change', () => {
      calculateMatches();
      if (matches.length) revealMatch(0);
    });
    byId('editorReplaceToggle').addEventListener('click', () => toggleReplace());
    byId('editorFindPrevious').addEventListener('click', () => findNext(-1));
    byId('editorFindNext').addEventListener('click', () => findNext(1));
    byId('editorFindClose').addEventListener('click', closeFind);
    byId('editorReplaceOne').addEventListener('click', replaceCurrent);
    byId('editorReplaceAll').addEventListener('click', replaceAll);

    editor()?.addEventListener('input', () => {
      if (!panel.hidden) calculateMatches();
    });
  }

  function bindShortcuts() {
    document.addEventListener('keydown', event => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openFind(false);
      } else if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        openFind(true);
      }
    });
  }

  const observer = new MutationObserver(() => {
    if (document.querySelector('.editor-toolbar')) {
      buildPanel();
      observer.disconnect();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  bindShortcuts();
})();
