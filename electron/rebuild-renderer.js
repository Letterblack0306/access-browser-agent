'use strict';

(() => {
  const api = window.accessIde;
  const Projection = window.RebuildRuntimeState;
  const shell = new window.RebuildShell(document).mount();
  let state = Projection.create();
  let latestSnapshot = {};
  let latestStatusFingerprint = '';
  let terminal = null;
  let fitAddon = null;
  let terminalId = null;
  let currentFile = null;
  let statusTimer = null;
  let diagnosticRecords = [];
  let executionTraceRecords = [];

  const $ = id => document.getElementById(id);
  const text = (id, value) => { const node = $(id); if (node) node.textContent = String(value ?? ''); };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const fmt = value => String(value || 'unknown').replaceAll('_', ' ');
  const toneFor = value => {
    const v = String(value || '').toLowerCase();
    if (['agent_ready','ready','running','accepted','connected','delivered','open','attached','success','complete','completed','pass'].some(k => v.includes(k))) return 'ok';
    if (['executing','queued','delivering','retry','waiting','attaching','starting','reachable_unverified','start'].some(k => v.includes(k))) return 'busy';
    if (['failed','degraded','unavailable','blocked','stopped','missing','capability_failed','error'].some(k => v.includes(k))) return 'bad';
    return 'info';
  };

  function ensureStabilityStyles() {
    if (document.querySelector('link[data-rebuild-ui-stability]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './rebuild-ui-stability.css';
    link.dataset.rebuildUiStability = 'true';
    document.head.append(link);
  }

  function uiDiagnostic(action, phase = 'event', data = {}, error = null) {
    api?.diagnosticEvent?.({ source:'renderer', category:'ui', action, phase, severity:error ? 'error' : 'info', data, error });
  }

  function setHealth(id, label, value) {
    const node = $(id); if (!node) return;
    node.dataset.tone = toneFor(value);
    const target = node.querySelector('[data-value]'); if (target) target.textContent = label || fmt(value);
  }

  function setBadge(id, value) {
    const node = $(id); if (!node) return;
    const tone = toneFor(value);
    node.className = `badge ${tone === 'ok' ? 'ok' : tone === 'busy' ? 'warn' : tone === 'bad' ? 'bad' : 'info'}`;
    node.textContent = fmt(value);
  }

  function setDeliveryProgress(ratio) {
    const meter = $('deliveryMeter');
    if (!meter) return;
    const bucket = Math.max(0, Math.min(10, Math.round(Number(ratio || 0) / 10)));
    meter.dataset.progress = String(bucket);
  }

  function render() {
    text('workspacePath', state.workspace.root || 'No workspace');
    if ($('workspacePath')) $('workspacePath').title = state.workspace.root || 'No workspace selected';
    setHealth('runtimeHealth', fmt(state.runtime.state), state.runtime.state);
    setHealth('providerHealth', fmt(state.provider.state), state.provider.state);
    setHealth('loopHealth', fmt(state.loop.state), state.loop.state);
    text('summaryAgent', fmt(state.agentSession.state));
    text('summaryOperation', fmt(state.operation.state));
    text('summaryDelivery', fmt(state.browserDelivery.state));
    text('runtimeDetail', `${fmt(state.runtime.state)}${state.runtime.detail ? ` — ${state.runtime.detail}` : ''}`);
    text('providerDetail', `${fmt(state.provider.state)}${state.provider.detail ? ` — ${state.provider.detail}` : ''}`);
    text('agentDetail', fmt(state.agentSession.state));
    text('turnDetail', state.agentSession.turnId || '—');
    text('targetDetail', state.browserTarget.target ? `${state.browserTarget.target.title || '(untitled)'} · ${state.browserTarget.target.url || ''}` : 'Not selected');
    text('loopDetail', `${fmt(state.loop.state)}${state.loop.detail ? ` — ${state.loop.detail}` : ''}`);
    text('cdpDetail', latestSnapshot?.browser?.endpoint || 'Not connected');
    text('instructionDetail', state.operation.instructionId || '—');
    setBadge('loopBadge', state.loop.state);
    setBadge('deliveryBadge', state.browserDelivery.state);
    setBadge('browserBadge', state.browserTarget.target ? 'ready' : latestSnapshot?.browser?.lifecycle || 'stopped');
    text('deliveryState', fmt(state.browserDelivery.state));
    text('deliveryAttempts', `${state.browserDelivery.attempts} / ${state.browserDelivery.maxAttempts || 0}`);
    text('deliveryDetail', state.browserDelivery.detail || (state.browserDelivery.instructionId ? `Instruction ${state.browserDelivery.instructionId}` : 'No queued browser result.'));
    const ratio = state.browserDelivery.maxAttempts ? Math.min(100, state.browserDelivery.attempts / state.browserDelivery.maxAttempts * 100) : 0;
    setDeliveryProgress(ratio);
    if ($('loopStart')) {
      $('loopStart').disabled = !state.loop.running && !$('chatUrl')?.value.trim();
      $('loopStart').textContent = state.loop.running ? 'Stop' : 'Start';
      $('loopStart').className = state.loop.running ? 'control danger compact' : 'control primary compact';
    }
    if ($('recoverLoop')) $('recoverLoop').disabled = !$('chatUrl')?.value.trim();
    if ($('stopAll')) $('stopAll').disabled = !state.runtime.active && !state.loop.running && !latestSnapshot?.browser?.endpoint && !terminalId;
    if ($('checkTarget')) $('checkTarget').disabled = !state.browserTarget.target;
    text('statusDetail', state.problems[0]?.message || state.operation.detail || state.loop.detail || 'Runtime state is current');
    if ($('statusRuntime')) $('statusRuntime').innerHTML = `<span class="dot ${toneFor(state.runtime.state)}"></span>Runtime ${escapeHtml(fmt(state.runtime.state))}`;
    if ($('statusLoop')) $('statusLoop').innerHTML = `<span class="dot ${toneFor(state.loop.state)}"></span>Loop ${escapeHtml(fmt(state.loop.state))}`;
    text('statusTarget', state.browserTarget.target?.title || 'No target');
    text('eventCount', state.events.length);
    text('problemCount', state.problems.length);
    renderEvents(); renderProblems();
  }

  function renderEvents() {
    const host = $('eventList'); if (!host) return;
    if (!state.events.length) { host.innerHTML = '<div class="empty-state compact-empty"><strong>No events yet</strong>Browser instructions, runtime and loop events will appear here.</div>'; return; }
    host.innerHTML = state.events.map(event => `<div class="event-row"><div class="event-phase">${escapeHtml(event.phase || event.type || 'event')}</div><div class="event-meta">${escapeHtml(event.at || '')}${event.instructionId ? ` · ${escapeHtml(event.instructionId)}` : ''}${event.detail ? ` · ${escapeHtml(event.detail)}` : ''}</div></div>`).join('');
  }

  function renderProblems() {
    const host = $('problemList'); if (!host) return;
    if (!state.problems.length) { host.innerHTML = '<div class="empty-state problem-empty"><strong>No current problems</strong>Failures and blocked boundaries will be shown here.</div>'; return; }
 host.innerHTML = state.problems.map(item => '<div class="problem-row"><div class="problem-source">'+escapeHtml(item.source)+(item.code ? ' - '+escapeHtml(item.code) : '')+'</div><div class="problem-message">'+escapeHtml(item.message)+'</div>'+renderRecoveryActions(item)+'<div class="event-meta">'+escapeHtml(item.at)+'</div></div>').join('');
  }

function renderRecoveryActions(item) {
const data=item.data||{};
if(!data.journalKey)return '';
const recovery=data.recovery||{};
const record=recovery.record||{};
const evidence={
journalKey:data.journalKey,
instructionId:data.instructionId||record.instructionId||null,
state:data.journalState||record.state||null,
workspaceRoot:record.workspaceRoot||null,
conversationId:record.conversationId||null,
observedAt:record.observedAt||null,
executingAt:record.executingAt||null,
rawSha256:record.rawSha256||null,
availableEvidence:recovery.availableEvidence||null,
missingEvidence:recovery.missingEvidence||null,
};
const key=escapeHtml(data.journalKey);
return '<pre class="recovery-evidence">'+escapeHtml(JSON.stringify(evidence,null,2))+'</pre><div class="panel-actions recovery-actions">'
+'<button type="button" class="control compact" data-recovery-action="abandoned" data-recovery-key="'+key+'">Abandon</button>'
+'<button type="button" class="control compact" data-recovery-action="quarantined" data-recovery-key="'+key+'">Quarantine</button>'
+'<button type="button" class="control compact" data-recovery-action="proven_complete" data-recovery-key="'+key+'">Proven complete</button>'
+'</div>';
}

function requestRecoveryInput({title='Recovery evidence',description='',initialValue=''}={}) {
return new Promise(resolve=>{
const existing=document.querySelector('[data-recovery-input-overlay]');
if(existing)existing.remove();
const overlay=document.createElement('div');overlay.dataset.recoveryInputOverlay='true';
Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'10000',display:'grid',placeItems:'center',background:'rgba(0,0,0,.72)',padding:'24px'});
const panel=document.createElement('div');
Object.assign(panel.style,{width:'min(620px,92vw)',background:'#141416',border:'1px solid #2a2a2d',borderRadius:'8px',boxShadow:'0 24px 60px rgba(0,0,0,.55)',padding:'18px'});
const heading=document.createElement('div');heading.textContent=title;Object.assign(heading.style,{fontSize:'15px',fontWeight:'600',marginBottom:'8px'});
const detail=document.createElement('div');detail.textContent=description;Object.assign(detail.style,{fontSize:'12px',lineHeight:'1.45',opacity:'.78',marginBottom:'12px'});
const input=document.createElement('textarea');input.value=String(initialValue??'');input.rows=8;
Object.assign(input.style,{boxSizing:'border-box',width:'100%',resize:'vertical',minHeight:'120px',background:'#0b0b0c',color:'inherit',border:'1px solid #343438',borderRadius:'6px',padding:'10px',font:'inherit'});
const actions=document.createElement('div');Object.assign(actions.style,{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'12px'});
const cancel=document.createElement('button');cancel.type='button';cancel.className='control compact';cancel.textContent='Cancel';
const confirm=document.createElement('button');confirm.type='button';confirm.className='control primary compact';confirm.textContent='Continue';
actions.append(cancel,confirm);panel.append(heading,detail,input,actions);overlay.append(panel);document.body.append(overlay);
let settled=false;
const finish=value=>{if(settled)return;settled=true;document.removeEventListener('keydown',onKey,true);overlay.remove();resolve(value);};
const onKey=event=>{if(event.key==='Escape'){event.preventDefault();finish(null);}else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();finish(input.value);}};
cancel.addEventListener('click',()=>finish(null),{once:true});confirm.addEventListener('click',()=>finish(input.value),{once:true});document.addEventListener('keydown',onKey,true);queueMicrotask(()=>input.focus());
});
}

async function reconcileRecoveryAction(button) {
const key=String(button?.dataset?.recoveryKey||'');
const disposition=String(button?.dataset?.recoveryAction||'');
if(!key||!disposition)return;
const reasonInput=await requestRecoveryInput({title:'Reconcile durable recovery',description:'Record the evidence-backed reason for this operator decision.'});
if(reasonInput===null)return;
const reason=String(reasonInput||'').trim();
if(!reason)return;
let evidenceRefs=[];
if(disposition==='proven_complete'){
const evidence=await requestRecoveryInput({title:'Durable completion evidence',description:'Enter a JSON array of durable evidence objects. Each object requires artifactId or path plus sha256.',initialValue:'[]'});
if(evidence===null)return;
try{evidenceRefs=JSON.parse(String(evidence||'[]').trim()||'[]');}
catch(error){const invalid=new Error('Evidence references must be valid JSON.');invalid.code='RECOVERY_EVIDENCE_INVALID';throw invalid;}
}
const result=await api.browserRecoveryReconcile({key,disposition,reason,operator:'local-operator',evidenceRefs});
state=Projection.withEvent(state,{phase:'browser_relay.recovery_reconciled',status:'completed',journalKey:key,instructionId:result?.receipt?.instructionId||null,detail:'Recovery reconciled as '+disposition+'.',receipt:result?.receipt||null});
render();
await refreshStatus({quiet:true,force:true});
}

  function diagnosticMatches(record, filter) {
    if (!filter || filter === 'all') return true;
    const haystack = `${record.source || ''} ${record.category || ''} ${record.action || ''} ${record.phase || ''} ${record.severity || ''}`.toLowerCase();
    if (filter === 'error') return ['error','fatal','failed'].some(value => haystack.includes(value));
    return haystack.includes(filter);
  }

  function diagnosticDetail(record) {
    const value = record?.error?.message
      || record?.data?.message
      || record?.data?.detail
      || record?.data?.observation
      || record?.data?.toolName
      || record?.data?.classification
      || record?.data?.command
      || record?.data?.path
      || '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  function runtimeTruthRecord(record) {
    const category = String(record?.category || '').toLowerCase();
    const source = String(record?.source || '').toLowerCase();
    return ['agent','tool','terminal','provider','browser','loop','governance','workspace'].includes(category)
      || ['tool-registry','openai-provider','cline-provider','terminal','browser-relay','module-registry'].some(value => source.includes(value));
  }

  function correlationSummary(record) {
    const c = record?.correlation || {};
    return [
      c.operationId ? `op=${c.operationId}` : '',
      c.toolCallId ? `tool=${c.toolCallId}` : '',
      c.instructionId ? `instruction=${c.instructionId}` : '',
      c.turnId ? `turn=${c.turnId}` : '',
      c.providerRequestId ? `request=${c.providerRequestId}` : '',
    ].filter(Boolean).join(' · ');
  }

  function liveStreamRecord(record) {
    const category = String(record?.category || '').toLowerCase();
    const source = String(record?.source || '').toLowerCase();
    const action = String(record?.action || '').toLowerCase();
    if (source === 'preload' || source === 'renderer') return false;
    if (action === 'status' || action.includes('module-registry-status') || action === 'output' || action === 'stdout' || action === 'write' || action === 'resize') return false;
    if (category === 'process-stream' || category === 'console') return false;
    if (category === 'tool') return ['start','success','failed','blocked','observed'].includes(String(record?.phase || '').toLowerCase());
    return ['agent','provider','browser','loop','governance'].includes(category)
      || source.includes('tool-registry')
      || source.includes('quick-command')
      || source.includes('browser-relay')
      || source.includes('exact-chat');
  }

  function liveStreamRole(record) {
    const category = String(record?.category || '').toLowerCase();
    const source = String(record?.source || '').toLowerCase();
    if (category === 'agent' || source.includes('agent')) return 'agent';
    if (category === 'tool' || source.includes('tool') || source.includes('quick-command')) return 'tool';
    return 'runtime';
  }

  function liveStreamTitle(record) {
    const data = record?.data || {};
    return data.toolName
      || data.command
      || data.path
      || record?.action
      || record?.source
      || 'runtime event';
  }

  function liveStreamBody(record) {
    const detail = diagnosticDetail(record);
    if (detail) return detail;
    const data = record?.data || {};
    const useful = [];
    if (data.cwd) useful.push(`cwd ${data.cwd}`);
    if (data.exitCode !== undefined && data.exitCode !== null) useful.push(`exit ${data.exitCode}`);
    if (data.targetId) useful.push(`target ${data.targetId}`);
    if (data.providerId) useful.push(`provider ${data.providerId}`);
    return useful.join(' · ') || fmt(record?.phase || 'event');
  }

  function renderLiveSessionStream() {
    const host = $('conversation'); if (!host) return;
    const records = diagnosticRecords.filter(liveStreamRecord).slice(-80);
    if (!records.length) {
      host.innerHTML = '<div id="conversationEmpty" class="empty-state"><strong>Waiting for browser work</strong>Paste the exact supported chat URL in Browser Loop and press Start. Real agent and tool activity will appear here as it occurs.</div>';
      return;
    }
    host.innerHTML = `<div class="live-session-stream">${records.map(record => {
      const role = liveStreamRole(record);
      const tone = toneFor(record?.severity || record?.phase || record?.action);
      const actor = role === 'agent' ? 'A' : role === 'tool' ? 'T' : 'R';
      const who = role === 'agent' ? 'agent' : role === 'tool' ? 'tool call' : 'runtime';
      const correlation = correlationSummary(record);
      const time = String(record?.timestamp || '').slice(11,19);
      return `<article class="live-stream-message ${role}"><div class="live-stream-avatar ${role}">${actor}</div><div class="live-stream-content"><div class="live-stream-who">${who}${time ? ` · ${escapeHtml(time)}` : ''}</div><div class="live-tool-cell" data-tone="${tone}"><div class="live-tool-head"><span class="live-tool-name">${escapeHtml(liveStreamTitle(record))}</span><span class="live-tool-state">${escapeHtml(fmt(record?.phase || 'event'))}</span></div><div class="live-tool-body">${escapeHtml(liveStreamBody(record))}</div><div class="live-tool-foot"><span>${escapeHtml(record?.source || record?.category || 'runtime')}</span><span>${escapeHtml(correlation || 'evidence in Complete Log')}</span></div></div></div></article>`;
    }).join('')}</div>`;
    host.scrollTop = host.scrollHeight;
  }

  function renderRuntimeTruth() {
    const host = $('executionList'); if (!host) return;
    const live = diagnosticRecords.filter(runtimeTruthRecord).slice(-120);
    const trace = executionTraceRecords.slice(-60);
    const rows = [];
    if (trace.length) {
      rows.push('<div class="runtime-truth-heading">Session trace</div>');
      for (const item of trace) {
        const phase = item.type || item.phase || 'event';
        const detail = item.summary || item.message || item.detail || JSON.stringify(item);
        rows.push(`<div class="runtime-truth-row" data-tone="${toneFor(item.status || phase)}"><span class="runtime-truth-time">${escapeHtml((item.timestamp || item.at || '').slice(11,23))}</span><span class="runtime-truth-source">agent trace</span><span class="runtime-truth-phase">${escapeHtml(fmt(phase))}</span><span class="runtime-truth-detail">${escapeHtml(detail)}</span></div>`);
      }
    }
    if (live.length) {
      rows.push('<div class="runtime-truth-heading">Live runtime evidence</div>');
      for (const record of live) {
        const correlation = correlationSummary(record);
        rows.push(`<div class="runtime-truth-row" data-tone="${toneFor(record.severity || record.phase || record.action)}"><span class="runtime-truth-time">${escapeHtml((record.timestamp || '').slice(11,23))}</span><span class="runtime-truth-source">${escapeHtml(record.source || record.category || 'runtime')}</span><span class="runtime-truth-phase">${escapeHtml(fmt(record.action || record.phase || 'event'))}</span><span class="runtime-truth-detail">${escapeHtml(diagnosticDetail(record) || record.phase || '')}</span>${correlation ? `<span class="runtime-truth-correlation">${escapeHtml(correlation)}</span>` : ''}</div>`);
      }
    }
    host.innerHTML = rows.join('') || '<div class="empty-state compact-empty"><strong>No runtime evidence yet</strong>Real browser, agent, tool, provider and terminal events will appear here.</div>';
    host.scrollTop = host.scrollHeight;
  }

  function renderDiagnostics() {
    const host = $('diagnosticList'); if (!host) return;
    const filter = $('diagnosticFilter')?.value || 'all';
    const rows = diagnosticRecords.filter(record => diagnosticMatches(record, filter)).slice(-2000);
    text('diagnosticCount', diagnosticRecords.length);
    host.innerHTML = rows.map(record => {
      const detail = diagnosticDetail(record);
      return `<div class="diagnostic-row" data-severity="${escapeHtml(record.severity || 'info')}"><span class="diagnostic-seq">#${String(record.seq || 0).padStart(6,'0')}</span><span class="diagnostic-time">${escapeHtml((record.timestamp || '').slice(11,23))}</span><span class="diagnostic-source">${escapeHtml(record.source || 'unknown')}</span><span class="diagnostic-action">${escapeHtml(record.action || record.phase || 'event')}</span><span class="diagnostic-phase">${escapeHtml(record.phase || '')}</span><span class="diagnostic-detail">${escapeHtml(detail)}</span></div>`;
    }).join('') || '<div class="empty-state"><strong>No matching diagnostics</strong>Change the filter or perform an action.</div>';
    host.scrollTop = host.scrollHeight;
  }

  async function refreshDiagnostics() {
    const [session, records] = await Promise.all([api.diagnosticSession(), api.diagnosticRecent(5000)]);
    diagnosticRecords = Array.isArray(records) ? records : [];
    text('diagnosticSessionPath', session?.path || 'Diagnostic session unavailable');
    renderDiagnostics();
    renderRuntimeTruth();
    renderLiveSessionStream();
  }

  function statusFingerprint(snapshot) {
    try { return JSON.stringify(snapshot || {}); } catch { return String(Date.now()); }
  }

  async function refreshStatus({ quiet = false, force = false } = {}) {
    try {
      const snapshot = await api.status();
      const next = snapshot || {};
      const fingerprint = statusFingerprint(next);
      latestSnapshot = next;
      if (force || fingerprint !== latestStatusFingerprint) {
        latestStatusFingerprint = fingerprint;
        state = Projection.fromSnapshot(state, next);
        render();
      }
      return snapshot;
    } catch (error) { if (!quiet) recordUiProblem('status', error); return null; }
  }

  function recordUiProblem(source, error) {
    uiDiagnostic('operation_failed', 'failed', { source, code:error?.code || null, classification:error?.classification || 'UNKNOWN' }, error);
    const event = { phase:'ui.operation_failed', status:'failed', detail:error?.message || String(error), code:error?.code || null, timestamp:new Date().toISOString() };
    state = Projection.withEvent(state, { ...event, source }); render(); shell.showBottom('problems');
  }

  async function withBusy(button, task) {
    if (button) button.disabled = true;
    try { return await task(); } catch (error) { recordUiProblem(button?.id || 'ui', error); throw error; } finally { render(); }
  }

  async function ensureRuntimeActive() {
    if (state.runtime.active) return latestSnapshot;
    uiDiagnostic('runtime_auto_start', 'start', { trigger:'browser_loop_start' });
    await api.runtimeStart();
    const snapshot = await refreshStatus({ force:true });
    uiDiagnostic('runtime_auto_start', 'success', { trigger:'browser_loop_start' });
    return snapshot;
  }

  async function stopAllOwned() {
    uiDiagnostic('stop_all', 'start', { relayRunning:state.loop.running, runtimeActive:state.runtime.active, browserEndpoint:latestSnapshot?.browser?.endpoint || null, terminalId });
    const outcomes = {};
    try { outcomes.relay = await api.browserRelayStop(); } catch (error) { outcomes.relay = { ok:false, error:error.message }; }
    try {
      const agent = await api.agentStatus();
      if (agent?.turnId && agent?.running) outcomes.agent = await api.agentStop(agent.turnId);
      else outcomes.agent = { ok:true, skipped:true };
    } catch (error) { outcomes.agent = { ok:false, error:error.message }; }
    try { outcomes.runtime = await api.runtimeStop(); } catch (error) { outcomes.runtime = { ok:false, error:error.message }; }
    try { outcomes.browser = await api.browserStop(); } catch (error) { outcomes.browser = { ok:false, error:error.message }; }
    if (terminalId) {
      try { outcomes.terminal = await api.terminalKill(terminalId); } catch (error) { outcomes.terminal = { ok:false, error:error.message }; }
      terminalId = null;
      state = Projection.withTerminal(state, {});
    }
    await refreshStatus({ quiet:true, force:true });
    const failed = Object.entries(outcomes).filter(([,value]) => value?.ok === false);
    if (failed.length) {
      const error = Object.assign(new Error(`Stop All completed with ${failed.length} failure(s): ${failed.map(([key,value]) => `${key}: ${value.error || 'failed'}`).join('; ')}`), { code:'STOP_ALL_PARTIAL_FAILURE', classification:'INTERNAL' });
      uiDiagnostic('stop_all', 'failed', { outcomes }, error);
      throw error;
    }
    uiDiagnostic('stop_all', 'success', { outcomes });
    text('statusDetail', 'All Access-owned runtime, loop, browser, and terminal resources stopped.');
  }

  async function startExactLoop({ recover = false } = {}) {
    const chatUrl = $('chatUrl').value.trim();
    if (!chatUrl) throw Object.assign(new Error('Enter the exact chat URL first.'), { code:'CHAT_URL_MISSING', classification:'USER_SETUP' });
    let parsed;
    try { parsed = new URL(chatUrl); } catch { throw Object.assign(new Error('Enter a valid HTTP/HTTPS chat URL.'), { code:'CHAT_URL_INVALID', classification:'USER_SETUP' }); }
    if (!['http:','https:'].includes(parsed.protocol)) throw Object.assign(new Error('Chat URL must use HTTP or HTTPS.'), { code:'CHAT_URL_INVALID', classification:'USER_SETUP' });
    await ensureRuntimeActive();
    uiDiagnostic(recover ? 'reset_loop' : 'start_loop', 'start', { chatUrl:parsed.toString() });
    await api.savePreferences({ browserChatUrl:parsed.toString() });
    if (recover) {
      await api.browserRelayStop().catch(() => {});
      await api.browserStop().catch(() => {});
    }
    await api.browserStart();
    const snapshot = await api.status();
    const endpoint = snapshot?.browser?.endpoint;
    if (!endpoint) throw Object.assign(new Error('Managed Chrome started without a usable CDP endpoint.'), { code:'CDP_ENDPOINT_MISSING', classification:'BROWSER' });
    const opened = await api.browserOpenExactChat({ endpoint, chatUrl:parsed.toString() });
    if (!opened?.target?.targetId) throw Object.assign(new Error('Exact chat opener returned no target identity.'), { code:'TARGET_ID_MISSING', classification:'BROWSER' });
    await api.browserRelaySelect(opened.target);
    await api.browserRelayStart();
    await refreshStatus({ force:true });
    state = Projection.withTargets(state, [opened.target]);
    render();
    uiDiagnostic(recover ? 'reset_loop' : 'start_loop', 'success', { chatUrl:parsed.toString(), endpoint, targetId:opened.target.targetId, providerId:opened.target.providerId, waitingForBrowser:true });
  }

  async function toggleLoop() {
    if (state.loop.running) {
      uiDiagnostic('stop_loop', 'start', {});
      await api.browserRelayStop();
      await refreshStatus({ force:true });
      uiDiagnostic('stop_loop', 'success', {});
      return;
    }
    await startExactLoop({ recover:false });
  }

  async function checkTarget() {
    if (!state.browserTarget.target) throw new Error('No chat target is attached.');
    const result = await api.browserRelayCheck();
    const tabs = Array.isArray(result?.tabs) ? result.tabs : [];
    state = Projection.fromSnapshot(state, result?.status || {});
    const target = state.browserTarget.target;
    const current = tabs.find(item => item.targetId === target?.targetId && item.providerId === target?.providerId);
    if (!current) throw Object.assign(new Error('Selected conversation target is no longer available. Use Reset attachment.'), { code:'TARGET_UNAVAILABLE', classification:'TARGET' });
    if ($('chatUrl')?.value && current.url) {
      const expected = new URL($('chatUrl').value.trim()); const observed = new URL(current.url);
      const identity = u => `${u.origin}${u.pathname.replace(/\/+$/u,'') || '/'}`;
      if (identity(expected) !== identity(observed)) throw Object.assign(new Error(`Conversation identity changed. Expected ${identity(expected)}; observed ${identity(observed)}.`), { code:'CHAT_IDENTITY_CHANGED', classification:'TARGET' });
    }
    state = Projection.withTargets(state, [current]);
    render(); text('statusDetail', `Target verified: ${current.title || current.url}`);
  }

  async function refreshFiles() {
    try { const response = await api.list('.'); const items = Array.isArray(response) ? response : response?.entries || response?.items || response?.data || []; renderFileItems(items); }
    catch (error) { recordUiProblem('workspace', error); }
  }

  function renderFileItems(items) {
    const query = $('fileSearch').value.trim().toLowerCase();
    const filtered = items.filter(item => { const name = String(item.name || item.path || item.relativePath || ''); return !query || name.toLowerCase().includes(query); });
    $('fileList').innerHTML = filtered.map(item => { const name=String(item.name||item.path||item.relativePath||''); const rel=String(item.relativePath||item.path||name); const directory=item.type==='directory'||item.directory===true||item.isDirectory===true; return `<li class="file-row" data-path="${escapeHtml(rel)}" data-directory="${directory}"><span class="file-icon">${directory?'▸':'·'}</span><span>${escapeHtml(name)}</span></li>`; }).join('') || '<li class="file-row muted-row">No matching files</li>';
    for (const row of $('fileList').querySelectorAll('[data-path]')) row.addEventListener('dblclick', () => { if (row.dataset.directory !== 'true') openFile(row.dataset.path); });
  }

  async function openFile(relativePath) {
    try { const response=await api.read(relativePath); const content=String(response?.content??response?.text??response?.data??''); currentFile=relativePath; $('editorText').value=content; $('editorText').disabled=false; $('saveFile').disabled=false; text('editorPath',relativePath); shell.showCenter('editor'); }
    catch (error) { recordUiProblem('editor', error); }
  }
  async function saveFile() { if (!currentFile) return; await api.write({ path:currentFile, content:$('editorText').value }); text('statusDetail', `Saved ${currentFile}`); }
  async function refreshGit() { try { const result=await api.gitStatus(); text('gitSummary', typeof result==='string'?result:JSON.stringify(result,null,2)); } catch (error) { recordUiProblem('git',error); } }

  async function refreshExecution(sessionId = state.agentSession.sessionId) {
    if (!sessionId) { executionTraceRecords = []; renderRuntimeTruth(); return; }
    try {
      const trace=await api.agentExecutionTrace(sessionId);
      executionTraceRecords=Array.isArray(trace)?trace:trace?.events||trace?.trace||[];
      renderRuntimeTruth();
    } catch (error) { recordUiProblem('trace',error); }
  }

  function initTerminal() {
    if (!window.Terminal) { text('terminalBanner','xterm could not be loaded.'); $('terminalBanner').classList.add('is-visible'); return; }
    terminal=new window.Terminal({ cursorBlink:false, fontFamily:'Cascadia Code, Consolas, monospace', fontSize:11, theme:{ background:'#09090a', foreground:'#e1e1e6', cursor:'#ff3b3b', selectionBackground:'#34343a' } });
    if (window.FitAddon?.FitAddon) { fitAddon=new window.FitAddon.FitAddon(); terminal.loadAddon(fitAddon); }
    terminal.open($('terminalHost')); fitAddon?.fit();
    terminal.onData(data=>{ if (terminalId) api.terminalWrite(terminalId,data).catch(error=>recordUiProblem('terminal',error)); });
    const observer=new ResizeObserver(()=>{ fitAddon?.fit(); if (terminalId) api.terminalResize(terminalId,terminal.cols,terminal.rows).catch(()=>{}); }); observer.observe($('terminalHost'));
    api.terminalCreate().then(result=>{ terminalId=result?.terminalId||null; state=Projection.withTerminal(state,result||{}); if (result?.fallback) { text('terminalBanner',`Degraded terminal: ${result.mode||'fallback'} mode${result.error?` — ${result.error}`:''}`); $('terminalBanner').classList.add('is-visible'); } render(); }).catch(error=>recordUiProblem('terminal',error));
    api.onTerminalData(event=>{ if (event?.terminalId===terminalId) terminal.write(String(event.data||'')); });
    api.onTerminalExit(event=>{ if (event?.terminalId!==terminalId) return; terminal.write(`\r\n[process exited ${event.exitCode??''}]\r\n`); terminalId=null; state=Projection.withTerminal(state,{}); render(); });
  }

  function bindUiDiagnostics() {
    document.addEventListener('click', event => {
      const node = event.target?.closest?.('button,[role="tab"],summary'); if (!node) return;
      uiDiagnostic('click', 'event', { id:node.id || null, label:(node.textContent || '').trim().slice(0,120), tag:node.tagName, view:node.dataset?.view || null });
    }, true);
    document.addEventListener('change', event => {
      const node=event.target; if (!node?.id) return;
      const sensitive = node.type === 'password' || /token|secret|key|auth/i.test(node.id);
      const freeform = node.tagName === 'TEXTAREA';
      uiDiagnostic('change', 'event', { id:node.id, type:node.type || node.tagName, value:sensitive ? '[REDACTED]' : freeform ? `[${String(node.value||'').length} chars]` : String(node.value ?? '').slice(0,1000) });
    }, true);
    window.addEventListener('error', event => uiDiagnostic('window_error','failed',{ message:event.message, filename:event.filename, lineno:event.lineno, colno:event.colno },event.error || new Error(event.message)));
    window.addEventListener('unhandledrejection', event => uiDiagnostic('unhandled_rejection','failed',{},event.reason instanceof Error ? event.reason : new Error(String(event.reason))));
  }

  function bind() {
    bindUiDiagnostics();
    $('chooseWorkspace').addEventListener('click', async()=>{ const result=await api.selectWorkspace(); if(!result?.canceled){ await refreshStatus({ force:true }); await refreshFiles(); } });
    $('runtimeRestart')?.addEventListener('click',()=>withBusy($('runtimeRestart'),async()=>{await api.runtimeRestart();await refreshStatus({ force:true });}).catch(()=>{}));
    $('chatUrl').addEventListener('input',render);
    $('loopStart').addEventListener('click',()=>withBusy($('loopStart'),toggleLoop).catch(()=>{}));
    $('recoverLoop')?.addEventListener('click',()=>withBusy($('recoverLoop'),()=>startExactLoop({recover:true})).catch(()=>{}));
    $('stopAll')?.addEventListener('click',()=>withBusy($('stopAll'),stopAllOwned).catch(()=>{}));
    $('checkTarget')?.addEventListener('click',()=>withBusy($('checkTarget'),checkTarget).catch(()=>{}));
    $('refreshFiles').addEventListener('click',refreshFiles); $('fileSearch').addEventListener('input',refreshFiles);
    $('saveFile').addEventListener('click',()=>saveFile().catch(error=>recordUiProblem('editor',error))); $('refreshGit').addEventListener('click',refreshGit);
    $('refreshTrace').addEventListener('click',()=>refreshExecution()); $('refreshValidation').addEventListener('click',async()=>{const snapshot=await refreshStatus({ force:true });text('validationOutput',JSON.stringify(snapshot,null,2));});
    $('clearProblems').addEventListener('click',()=>{state=Projection.clearProblems(state);render();});
 problemList?.addEventListener('click',event=>{const button=event.target?.closest?.('[data-recovery-action]');if(button)reconcileRecoveryAction(button).catch(error=>recordUiProblem('recovery',error));});
    $('refreshDiagnostics').addEventListener('click',()=>refreshDiagnostics().catch(error=>recordUiProblem('diagnostics',error)));
    $('diagnosticFilter').addEventListener('change',renderDiagnostics);
    $('openDiagnosticFolder').addEventListener('click',()=>api.diagnosticReveal().catch(error=>recordUiProblem('diagnostics',error)));
    $('toggleMcp').addEventListener('click',async()=>{try{const current=await api.mcpStatus();const result=await api.setMcpEnabled(current?.enabled!==true);text('mcpDetail',`${result.status||'unknown'}${result.error?` — ${result.error}`:''}`);}catch(error){recordUiProblem('mcp',error);}});
    api.onAgentEvent(event=>{state=Projection.withEvent(state,event||{});render();if(['browser_relay.delivery_failed','browser_relay.instruction_recovery_required'].includes(event?.phase))shell.showBottom('problems');});
    api.onAgentState(event=>{state=Projection.withEvent(state,{phase:'agent.state',...event});refreshStatus({quiet:true,force:true});});
    api.onDiagnosticRecord?.(record=>{ diagnosticRecords.push(record); if(diagnosticRecords.length>5000) diagnosticRecords=diagnosticRecords.slice(-5000); renderDiagnostics(); renderRuntimeTruth(); renderLiveSessionStream(); });
  }

  async function boot() {
    if (!api||!Projection) throw new Error('Workbench preload/runtime projection is unavailable.');
    ensureStabilityStyles();
    bind(); initTerminal(); uiDiagnostic('renderer_boot','start',{readyState:document.readyState});
    const prefs=await api.preferences().catch(()=>({})); if($('chatUrl')) $('chatUrl').value=prefs.browserChatUrl||'';
    await refreshStatus({ force:true }); await Promise.allSettled([refreshFiles(),refreshGit(),refreshDiagnostics()]);
    try{const mcp=await api.mcpStatus();text('mcpDetail',`${mcp.status||'unknown'}${mcp.error?` — ${mcp.error}`:''}`);}catch{}
    statusTimer=setInterval(()=>refreshStatus({quiet:true}),2500);
    uiDiagnostic('renderer_boot','success',{chatUrlConfigured:Boolean($('chatUrl')?.value),instructionOwner:'browser',liveToolUi:'inline_truth'});
    window.addEventListener('beforeunload',()=>{uiDiagnostic('renderer_unload','event');if(statusTimer)clearInterval(statusTimer);if(terminalId)api.terminalKill(terminalId).catch(()=>{});shell.dispose();},{once:true});
  }

  boot().catch(error=>{console.error(error);uiDiagnostic('renderer_boot','failed',{},error);text('statusDetail',`Workbench failed: ${error.message}`);});
})();
