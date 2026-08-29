'use strict';

(() => {
  const api = window.accessIde;
  if (!api?.diagnosticRecent || !api?.onDiagnosticRecord) return;

  const records = new Map();
  const byId = id => document.getElementById(id);
  const short = value => {
    const text = String(value || '');
    return text.length > 18 ? `${text.slice(0,8)}…${text.slice(-6)}` : text;
  };

  function artifactFrom(record) {
    return record?.data?.artifact
      || record?.data?.delivery?.artifact
      || record?.data?.result?.artifact
      || record?.error?.diagnosticArtifact
      || null;
  }

  function correlationParts(record) {
    const c = record?.correlation || {};
    const keys = [
      ['op','operationId'], ['inst','instructionId'], ['session','sessionId'], ['turn','turnId'],
      ['tool','toolCallId'], ['target','targetId'], ['delivery','deliveryId'], ['req','providerRequestId'],
    ];
    return keys.filter(([,key]) => c[key]).map(([label,key]) => `${label}=${short(c[key])}`);
  }

  function enrich() {
    const host = byId('diagnosticList');
    if (!host) return;
    for (const row of host.querySelectorAll('.diagnostic-row')) {
      const seqText = row.querySelector('.diagnostic-seq')?.textContent || '';
      const seq = Number(seqText.replace(/\D/gu,''));
      const record = records.get(seq);
      if (!record) continue;
      const detail = row.querySelector('.diagnostic-detail');
      if (!detail) continue;
      const classification = record.classification && record.classification !== 'UNKNOWN' ? record.classification : '';
      const artifact = artifactFrom(record);
      const extras = [
        classification ? `class=${classification}` : '',
        ...correlationParts(record),
        artifact?.artifactId ? `artifact=${short(artifact.artifactId)}` : '',
      ].filter(Boolean);
      if (extras.length) {
        const suffix = `  ·  ${extras.join(' · ')}`;
        if (!detail.textContent.includes(suffix)) detail.append(document.createTextNode(suffix));
      }
      row.title = JSON.stringify(record, null, 2);
      row.dataset.correlation = correlationParts(record).join(' ');
      if (artifact?.artifactId) row.dataset.artifactId = String(artifact.artifactId);
    }
  }

  function ensureModuleRegistryPanel() {
    if (byId('moduleRegistryBadge')) return;
    const stack=document.querySelector('[data-center-view][data-view="runtime"] .right-stack');
    if(!stack)return;
    const section=document.createElement('section');
    section.className='section';
    section.dataset.maintenanceOnly='module-registry';
    section.innerHTML='<header class="section-head"><span class="section-title">Module maintenance</span><span id="moduleRegistryBadge" class="badge">Unknown</span></header><div class="section-body"><div id="moduleRegistryDetail" class="microcopy">Ownership registry status not checked.</div></div>';
    stack.prepend(section);
  }

  async function refreshModuleRegistryStatus() {
    ensureModuleRegistryPanel();
    if(!api?.moduleRegistryStatus)return;
    try{
      const status=await api.moduleRegistryStatus();
      const caution=status?.state==='caution';
      const badge=byId('moduleRegistryBadge');
      if(badge){badge.className=`badge ${caution?'warn':'ok'}`;badge.textContent=caution?'Caution':'Maintained';}
      const cautions=Array.isArray(status?.cautions)?status.cautions:[];
      const detail=byId('moduleRegistryDetail');
      if(detail)detail.textContent=caution?`${cautions.length} maintenance issue(s): ${cautions.slice(0,3).join(' · ')}`:`${status?.count||0} active runtime ownership modules maintained.`;
      if(caution)api.diagnosticEvent?.({source:'module-registry',category:'maintenance',action:'status',phase:'caution',severity:'warn',data:{count:status?.count||0,cautions}});
    }catch(error){
      const badge=byId('moduleRegistryBadge');if(badge){badge.className='badge warn';badge.textContent='Caution';}
      const detail=byId('moduleRegistryDetail');if(detail)detail.textContent=`Module maintenance status unavailable: ${error?.message||error}`;
    }
  }

  async function seed() {
    try {
      const recent = await api.diagnosticRecent(5000);
      for (const record of Array.isArray(recent) ? recent : []) records.set(Number(record.seq || 0), record);
      enrich();
    } catch { /* the base Complete Log remains available */ }
  }

  function start() {
    const host = byId('diagnosticList');
    if (!host) return;
    const observer = new MutationObserver(enrich);
    observer.observe(host, { childList:true, subtree:true });
    api.onDiagnosticRecord(record => {
      if (record?.seq != null) records.set(Number(record.seq), record);
      queueMicrotask(enrich);
    });
    seed();
    refreshModuleRegistryStatus();
    const registryTimer=setInterval(refreshModuleRegistryStatus,10000);
    window.addEventListener('beforeunload', () => { observer.disconnect(); clearInterval(registryTimer); }, { once:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
