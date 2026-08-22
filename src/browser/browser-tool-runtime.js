'use strict';

const CDP = require('chrome-remote-interface');
const { endpointParts } = require('./provider-channel');

const DEFAULT_TEXT_LIMIT = 24000;
const DEFAULT_INTERACTIVE_LIMIT = 120;
const DEFAULT_ACCESSIBILITY_LIMIT = 240;

function normalizeWebUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch {
    const error = new Error('Browser URL is invalid.');
    error.code = 'BROWSER_URL_INVALID';
    error.classification = 'BROWSER';
    throw error;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    const error = new Error(`Browser navigation only supports HTTP/HTTPS URLs; received ${url.protocol || '(no protocol)'}.`);
    error.code = 'BROWSER_URL_SCHEME_BLOCKED';
    error.classification = 'BROWSER';
    throw error;
  }
  if (url.username || url.password) {
    const error = new Error('Credentials embedded in browser URLs are not accepted.');
    error.code = 'BROWSER_URL_CREDENTIALS_BLOCKED';
    error.classification = 'BROWSER';
    throw error;
  }
  return url.toString();
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function evaluateValue(client, expression) {
  const result = await client.Runtime.evaluate({ expression, returnByValue:true, awaitPromise:true });
  if (result?.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser page evaluation failed.';
    const error = new Error(description);
    error.code = 'BROWSER_EVALUATION_FAILED';
    throw error;
  }
  return result?.result?.value;
}

class BrowserToolRuntime {
  constructor({
    cdpFactory = CDP,
    getEndpoint,
    isProtectedUrl = null,
    readinessTimeoutMs = 7000,
    pollIntervalMs = 100,
    settlementQuietMs = 250,
    settlementTimeoutMs = 2000,
    textLimit = DEFAULT_TEXT_LIMIT,
    interactiveLimit = DEFAULT_INTERACTIVE_LIMIT,
    accessibilityLimit = DEFAULT_ACCESSIBILITY_LIMIT,
    requireIsolatedContext = false,
    evidenceStore = null,
  } = {}) {
    if (typeof getEndpoint !== 'function') throw new Error('BrowserToolRuntime requires getEndpoint().');
    this.cdpFactory = cdpFactory;
    this.getEndpoint = getEndpoint;
    this.isProtectedUrl = typeof isProtectedUrl === 'function' ? isProtectedUrl : () => false;
    this.readinessTimeoutMs = Math.max(500, Number(readinessTimeoutMs) || 7000);
    this.pollIntervalMs = Math.max(25, Number(pollIntervalMs) || 100);
    this.settlementQuietMs = Math.max(50, Number(settlementQuietMs) || 250);
    this.settlementTimeoutMs = Math.max(this.settlementQuietMs + this.pollIntervalMs, Number(settlementTimeoutMs) || 2000);
    this.textLimit = Math.max(1000, Number(textLimit) || DEFAULT_TEXT_LIMIT);
    this.interactiveLimit = Math.max(10, Math.min(500, Number(interactiveLimit) || DEFAULT_INTERACTIVE_LIMIT));
    this.accessibilityLimit = Math.max(20, Math.min(500, Number(accessibilityLimit) || DEFAULT_ACCESSIBILITY_LIMIT));
    this.requireIsolatedContext = requireIsolatedContext !== false;
    this.evidenceStore = evidenceStore;
    this.ownedTargets = new Map();
    this.currentTargetId = null;
    this.browserContextId = null;
    this.browserContextEndpoint = null;
  }

  _assertAllowedUrl(value) {
    const url = normalizeWebUrl(value);
    if (!this.isProtectedUrl(url)) return url;
    const error = new Error('The selected Browser Loop conversation is protected from general browser tools. Use browserConversationRead for bounded read-only conversation context.');
    error.code = 'BROWSER_PROTECTED_CONVERSATION';
    error.classification = 'TARGET';
    error.details = { url };
    throw error;
  }

  async _endpoint() {
    const endpoint = String(await this.getEndpoint() || '').trim();
    if (!endpoint) {
      const error = new Error('Managed browser CDP endpoint is unavailable.');
      error.code = 'BROWSER_ENDPOINT_UNAVAILABLE';
      error.classification = 'BROWSER';
      throw error;
    }
    endpointParts(endpoint);
    return endpoint;
  }

  _ownedTarget(targetId = '') {
    const id = String(targetId || this.currentTargetId || '').trim();
    const ownership = id ? this.ownedTargets.get(id) : null;
    if (!id || !ownership) {
      const error = new Error('Browser target is not owned by the general browser-tool runtime. Open a browsing tab with browserOpen first.');
      error.code = 'BROWSER_TARGET_NOT_OWNED';
      error.classification = 'TARGET';
      throw error;
    }
    return { id, ownership };
  }

  _assertEndpointOwnership(id, ownership, endpoint) {
    if (ownership.endpoint === endpoint) return;
    this.ownedTargets.delete(id);
    if (this.currentTargetId === id) this.currentTargetId = null;
    const error = new Error('Browser instance changed after this browsing target was created. Open a new browsing tab before continuing.');
    error.code = 'BROWSER_TARGET_GENERATION_CHANGED';
    error.classification = 'TARGET';
    error.details = { targetId:id, ownedEndpoint:ownership.endpoint, currentEndpoint:endpoint };
    throw error;
  }

  async _withTarget(targetId, callback) {
    const { id, ownership } = this._ownedTarget(targetId);
    const endpoint = await this._endpoint();
    this._assertEndpointOwnership(id, ownership, endpoint);
    const client = await this.cdpFactory({ ...endpointParts(endpoint), target:id });
    try {
      if (client.Runtime?.enable) await client.Runtime.enable();
      if (client.Page?.enable) await client.Page.enable();
      const current = await evaluateValue(client, '({url:location.href})').catch(() => null);
      if (current?.url) this._assertAllowedUrl(current.url);
      return await callback(client, id, endpoint);
    } catch (error) {
      if (error?.code === 'BROWSER_PROTECTED_CONVERSATION') {
        this.ownedTargets.delete(id);
        if (this.currentTargetId === id) this.currentTargetId = null;
      }
      throw error;
    } finally {
      await client.close();
    }
  }

  async _ensureIsolatedContext(client, endpoint) {
    if (this.browserContextId && this.browserContextEndpoint === endpoint) return this.browserContextId;
    if (this.browserContextId && this.browserContextEndpoint !== endpoint) {
      this.browserContextId = null;
      this.browserContextEndpoint = null;
    }
    if (typeof client.Target?.createBrowserContext !== 'function') {
      if (this.requireIsolatedContext) {
        const error = new Error('Managed Chrome does not expose CDP browser-context isolation for general browser tabs.');
        error.code = 'BROWSER_CONTEXT_ISOLATION_UNAVAILABLE';
        error.classification = 'BROWSER';
        throw error;
      }
      return null;
    }
    let result;
    try {
      result = await client.Target.createBrowserContext({ disposeOnDetach: false });
    } catch (cause) {
      if (!this.requireIsolatedContext) return null;
      const error = new Error('Managed Chrome rejected CDP browser-context isolation for general browser tabs.');
      error.code = 'BROWSER_CONTEXT_ISOLATION_UNAVAILABLE';
      error.classification = 'BROWSER';
      error.causeCode = cause?.code || null;
      throw error;
    }
    const contextId = String(result?.browserContextId || '').trim();
    if (!contextId) {
      const error = new Error('Managed Chrome did not return an owned CDP browser context.');
      error.code = 'BROWSER_CONTEXT_CREATE_FAILED';
      error.classification = 'BROWSER';
      throw error;
    }
    this.browserContextId = contextId;
    this.browserContextEndpoint = endpoint;
    return contextId;
  }

  async _disposeIsolatedContext(client, endpoint) {
    const contextId = this.browserContextId;
    if (!contextId || this.browserContextEndpoint !== endpoint) return;
    this.browserContextId = null;
    this.browserContextEndpoint = null;
    if (typeof client.Target?.disposeBrowserContext === 'function') {
      await client.Target.disposeBrowserContext({ browserContextId: contextId });
    }
  }

  async _accessibilitySnapshot(client) {
    if (typeof client.Accessibility?.getFullAXTree !== 'function') {
      return { status:'unavailable', code:'BROWSER_AX_UNAVAILABLE', nodes:[] };
    }
    try {
      await client.Accessibility.enable?.();
      const tree = await client.Accessibility.getFullAXTree();
      const nodes = (Array.isArray(tree?.nodes) ? tree.nodes : []).slice(0, this.accessibilityLimit).map(node => ({
        nodeId: String(node?.nodeId || ''),
        role: node?.role?.value == null ? null : String(node.role.value),
        name: node?.name?.value == null ? null : String(node.name.value).slice(0, 300),
        value: node?.value?.value == null ? null : String(node.value.value).slice(0, 300),
        ignored: node?.ignored === true,
        childIds: Array.isArray(node?.childIds) ? node.childIds.slice(0, 40).map(String) : [],
      }));
      return { status:'available', nodes, truncated:(tree?.nodes?.length || 0) > nodes.length };
    } catch (error) {
      return { status:'unavailable', code:'BROWSER_AX_READ_FAILED', nodes:[] };
    }
  }

  async _waitReady(client) {
    const deadline = Date.now() + this.readinessTimeoutMs;
    let last = null;
    do {
      try {
        last = await evaluateValue(client, '({readyState:document.readyState,url:location.href,title:document.title})');
        if (last?.readyState === 'complete' || last?.readyState === 'interactive') return last;
      } catch {}
      if (Date.now() >= deadline) break;
      await wait(this.pollIntervalMs);
    } while (Date.now() <= deadline);
    const error = new Error(`Browser page did not become ready${last?.url ? ` at ${last.url}` : ''}.`);
    error.code = 'BROWSER_READINESS_TIMEOUT';
    error.classification = 'BROWSER';
    error.details = last;
    throw error;
  }

  async _startSettlementObserver(client) {
    return evaluateValue(client, `(()=>{const key='__accessAgentSettlement';const prior=globalThis[key];try{prior?.observer?.disconnect?.();}catch{}const tracker={startedAt:Date.now(),lastMutationAt:Date.now(),revision:0,observer:null};if(typeof MutationObserver==='function'&&document.documentElement){const observer=new MutationObserver(()=>{tracker.revision+=1;tracker.lastMutationAt=Date.now();});observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});tracker.observer=observer;}globalThis[key]=tracker;return{startedAt:tracker.startedAt,url:location.href,title:document.title,readyState:document.readyState};})()`);
  }

  async _waitForSettlement(client) {
    const deadline = Date.now() + this.settlementTimeoutMs;
    let last = null;
    do {
      try {
        last = await evaluateValue(client, `(()=>{const tracker=globalThis.__accessAgentSettlement||null;return{url:location.href,title:document.title,readyState:document.readyState,settlementStartedAt:tracker?.startedAt||null,settlementLastMutationAt:tracker?.lastMutationAt||null,settlementRevision:tracker?.revision||0};})()`);
        if (last?.url) this._assertAllowedUrl(last.url);
        const ready = last?.readyState === 'complete' || last?.readyState === 'interactive';
        const startedAt = Number(last?.settlementStartedAt) || 0;
        const lastMutationAt = Number(last?.settlementLastMutationAt) || startedAt;
        const quietSince = Math.max(startedAt, lastMutationAt);
        if (ready && quietSince > 0 && Date.now() - quietSince >= this.settlementQuietMs) {
          return {
            status:'settled',
            url:last.url || null,
            title:last.title || null,
            readyState:last.readyState || null,
            revision:Number(last.settlementRevision) || 0,
            observedMutation:(Number(last.settlementRevision) || 0) > 0,
            quietMs:this.settlementQuietMs,
            timeoutMs:this.settlementTimeoutMs,
          };
        }
      } catch (error) {
        if (error?.code === 'BROWSER_PROTECTED_CONVERSATION') throw error;
      }
      if (Date.now() >= deadline) break;
      await wait(this.pollIntervalMs);
    } while (Date.now() <= deadline);
    const error = new Error(`Browser action did not settle within ${this.settlementTimeoutMs} ms${last?.url ? ` at ${last.url}` : ''}.`);
    error.code = 'BROWSER_SETTLEMENT_TIMEOUT';
    error.classification = 'BROWSER';
    error.details = { ...last, quietMs:this.settlementQuietMs, timeoutMs:this.settlementTimeoutMs };
    throw error;
  }

  async _waitReadyAndSettle(client) {
    const ready = await this._waitReady(client);
    if (ready?.url) this._assertAllowedUrl(ready.url);
    await this._startSettlementObserver(client);
    return this._waitForSettlement(client);
  }

  async open(input = {}) {
    const url = this._assertAllowedUrl(input.url);
    const endpoint = await this._endpoint();
    const client = await this.cdpFactory(endpointParts(endpoint));
    let targetId = '';
    try {
      const browserContextId = await this._ensureIsolatedContext(client, endpoint);
      const created = await client.Target.createTarget({ url, ...(browserContextId ? { browserContextId } : {}) });
      targetId = String(created?.targetId || '').trim();
      if (!targetId) throw new Error('Chrome did not return a target id for the new browsing tab.');
      this.ownedTargets.set(targetId, { targetId, endpoint, browserContextId:browserContextId || null, createdAt:new Date().toISOString(), requestedUrl:url });
      this.currentTargetId = targetId;
    } finally {
      await client.close();
    }
    const navigationClient = await this.cdpFactory({ ...endpointParts(endpoint), target:targetId });
    try {
      if (navigationClient.Page?.enable) await navigationClient.Page.enable();
      if (typeof navigationClient.Page?.navigate !== 'function') {
        const error = new Error('Managed Chrome does not expose CDP page navigation for the opened browser tab.');
        error.code = 'BROWSER_NAVIGATION_UNAVAILABLE';
        error.classification = 'BROWSER';
        throw error;
      }
      await navigationClient.Page.navigate({ url });
    } finally {
      await navigationClient.close();
    }
    const settlement = await this._withTarget(targetId, client => this._waitReadyAndSettle(client));
    return { ok:true, targetId, url:String(settlement?.url || url), title:String(settlement?.title || ''), readyState:settlement?.readyState || null, owned:true, settlement };
  }

  async tabs() {
    const endpoint = await this._endpoint();
    const targets = await this.cdpFactory.List(endpointParts(endpoint));
    const pages = (Array.isArray(targets) ? targets : []).filter(item => item?.type === 'page').map(item => {
      const targetId = String(item.id || '');
      const ownership = this.ownedTargets.get(targetId);
      const owned = Boolean(ownership && ownership.endpoint === endpoint);
      return {
        targetId,
        title:String(item.title || ''),
        url:String(item.url || ''),
        type:'page',
        owned,
        active:owned && targetId === this.currentTargetId,
      };
    });
    const liveOwnedIds = new Set(pages.filter(item => item.owned).map(item => item.targetId));
    for (const [targetId, ownership] of this.ownedTargets.entries()) {
      if (ownership.endpoint !== endpoint || !liveOwnedIds.has(targetId)) this.ownedTargets.delete(targetId);
    }
    if (this.currentTargetId && !this.ownedTargets.has(this.currentTargetId)) this.currentTargetId = null;
    return { ok:true, currentTargetId:this.currentTargetId, tabs:pages };
  }

  async navigate(input = {}) {
    const url = this._assertAllowedUrl(input.url);
    return this._withTarget(input.targetId, async (client, targetId) => {
      const response = await client.Page.navigate({ url });
      if (response?.errorText) {
        const error = new Error(`Browser navigation failed: ${response.errorText}`);
        error.code = 'BROWSER_NAVIGATION_FAILED';
        error.classification = 'BROWSER';
        throw error;
      }
      const settlement = await this._waitReadyAndSettle(client);
      this.currentTargetId = targetId;
      return { ok:true, targetId, requestedUrl:url, url:String(settlement?.url || url), title:String(settlement?.title || ''), readyState:settlement?.readyState || null, settlement };
    });
  }

  async snapshot(input = {}) {
    const textLimit = Math.max(1000, Math.min(this.textLimit, Number(input.textLimit) || this.textLimit));
    const interactiveLimit = Math.max(1, Math.min(this.interactiveLimit, Number(input.interactiveLimit) || this.interactiveLimit));
    return this._withTarget(input.targetId, async (client, targetId) => {
      const expression = `(()=>{const textLimit=${JSON.stringify(textLimit)},interactiveLimit=${JSON.stringify(interactiveLimit)};const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity||1)!==0&&r.width>0&&r.height>0};document.querySelectorAll('[data-access-agent-ref]').forEach(e=>e.removeAttribute('data-access-agent-ref'));const selector='a[href],button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"],[tabindex]';const elements=[];let n=0;for(const e of document.querySelectorAll(selector)){if(elements.length>=interactiveLimit)break;if(!visible(e)||e.disabled||e.getAttribute('aria-disabled')==='true')continue;const ref='aa-'+(++n);e.setAttribute('data-access-agent-ref',ref);const r=e.getBoundingClientRect();const tag=e.tagName.toLowerCase();const inputType=tag==='input'?String(e.type||'text').toLowerCase():null;const name=(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||e.value||e.getAttribute('placeholder')||'').replace(/\\s+/gu,' ').trim().slice(0,300);elements.push({ref,tag,role:e.getAttribute('role')||null,name,href:tag==='a'?e.href:null,inputType,disabled:Boolean(e.disabled||e.getAttribute('aria-disabled')==='true'),contentEditable:e.isContentEditable===true,rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}});}const raw=(document.body?.innerText||document.documentElement?.innerText||'').replace(/\\r/gu,'').trim();return{url:location.href,title:document.title,readyState:document.readyState,text:raw.slice(0,textLimit),textTruncated:raw.length>textLimit,interactive:elements,interactiveTruncated:document.querySelectorAll(selector).length>elements.length};})()`;
      const value = await evaluateValue(client, expression) || {};
      if (value?.url) this._assertAllowedUrl(value.url);
      this.currentTargetId = targetId;
      return { ok:true, targetId, ...value, accessibility:await this._accessibilitySnapshot(client) };
    });
  }

  async screenshot(input = {}) {
    if(!this.evidenceStore)return{ok:false,code:'VISUAL_EVIDENCE_UNAVAILABLE',error:'Browser visual evidence storage is not configured.'};
    return this._withTarget(input.targetId,async(client,targetId)=>{
      const capture=await client.Page.captureScreenshot({format:'png',fromSurface:true});
      const artifact=await this.evidenceStore.put({screenshotBase64:String(capture?.data||''),correlation:{targetId,url:await evaluateValue(client,'location.href')},privacy:{state:'raw-local-opt-in',screenshotPolicy:'raw_local_opt_in',containsConversationContent:true,redactionNotes:['Screenshot captured explicitly by the local browser tool.']}});
      const ref=artifact.refs.find(item=>item.type==='screenshot');
      this.currentTargetId=targetId;
      return{ok:true,targetId,evidenceId:artifact.artifactId,sha256:ref?.sha256||null,mediaType:'image/png',capturedAt:artifact.capturedAt};
    });
  }

  async compareScreenshots(input = {}) {
    if(!this.evidenceStore)return{ok:false,code:'VISUAL_EVIDENCE_UNAVAILABLE',error:'Browser visual evidence storage is not configured.'};
    try{return{ok:true,...await this.evidenceStore.compareImages(input.beforeEvidenceId,input.afterEvidenceId)};}catch(error){return{ok:false,code:String(error?.code||'VISUAL_COMPARE_FAILED'),error:String(error?.message||error)};}
  }

  async click(input = {}) {
    const ref = String(input.ref || '').trim();
    if (!ref) return { ok:false, code:'BROWSER_REF_REQUIRED', error:'Element ref is required. Take a fresh browserSnapshot first.' };
    return this._withTarget(input.targetId, async (client, targetId) => {
      await this._startSettlementObserver(client);
      const expression = `(()=>{const ref=${JSON.stringify(ref)};const e=document.querySelector('[data-access-agent-ref="'+CSS.escape(ref)+'"]');if(!e)return{ok:false,code:'BROWSER_REF_STALE',error:'Element ref is missing; take a fresh snapshot.'};const s=getComputedStyle(e),r=e.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||r.width<=0||r.height<=0)return{ok:false,code:'BROWSER_ELEMENT_NOT_VISIBLE',error:'Element is not visible.'};if(e.disabled||e.getAttribute('aria-disabled')==='true')return{ok:false,code:'BROWSER_ELEMENT_DISABLED',error:'Element is disabled.'};const tag=e.tagName.toLowerCase(),type=tag==='input'?String(e.type||'').toLowerCase():tag==='button'?String(e.getAttribute('type')||'submit').toLowerCase():'';if(tag==='input'&&type==='file')return{ok:false,code:'BROWSER_FILE_PICKER_BLOCKED',error:'File picker controls are not supported by browserClick.'};if((tag==='input'&&['submit','image'].includes(type))||(tag==='button'&&type==='submit'))return{ok:false,code:'BROWSER_FORM_SUBMIT_BLOCKED',error:'Implicit form submission is blocked. Navigate directly or use a non-submit control.'};if(tag==='a'&&e.hasAttribute('download'))return{ok:false,code:'BROWSER_DOWNLOAD_BLOCKED',error:'Download links are not supported by browserClick.'};const before=location.href;const info={tag,role:e.getAttribute('role')||null,name:(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||e.value||'').replace(/\\s+/gu,' ').trim().slice(0,300),href:tag==='a'?e.href:null};if(tag==='a'&&e.href)return{ok:true,method:'navigate-anchor',before,element:info,navigateUrl:e.href};e.click();return{ok:true,method:'dom-click',before,element:info};})()`;
      const result = await evaluateValue(client, expression) || {};
      if (!result.ok) return result;
      let settlement;
      if (result.method === 'navigate-anchor' && result.navigateUrl) {
        const url = this._assertAllowedUrl(result.navigateUrl);
        const response = await client.Page.navigate({ url });
        if (response?.errorText) return { ok:false, code:'BROWSER_NAVIGATION_FAILED', error:`Browser navigation failed: ${response.errorText}` };
        settlement = await this._waitReadyAndSettle(client);
      } else {
        settlement = await this._waitForSettlement(client);
      }
      const observed = settlement || {};
      if (observed?.url) this._assertAllowedUrl(observed.url);
      this.currentTargetId = targetId;
      return { ok:true, targetId, ref, method:result.method, element:result.element || null, beforeUrl:result.before || null, url:observed?.url || null, title:observed?.title || null, readyState:observed?.readyState || null, verifiedActionDispatch:true, downstreamOutcome:'SETTLED', settlement };
    });
  }

  async type(input = {}) {
    const ref = String(input.ref || '').trim();
    const text = String(input.text ?? '');
    if (!ref) return { ok:false, code:'BROWSER_REF_REQUIRED', error:'Element ref is required. Take a fresh browserSnapshot first.' };
    return this._withTarget(input.targetId, async (client, targetId) => {
      const prepare = `(()=>{const ref=${JSON.stringify(ref)};const clear=${input.clear === false ? 'false' : 'true'};const e=document.querySelector('[data-access-agent-ref="'+CSS.escape(ref)+'"]');if(!e)return{ok:false,code:'BROWSER_REF_STALE',error:'Element ref is missing; take a fresh snapshot.'};const tag=e.tagName.toLowerCase(),type=tag==='input'?String(e.type||'text').toLowerCase():'';if(!['input','textarea'].includes(tag)&&!e.isContentEditable)return{ok:false,code:'BROWSER_ELEMENT_NOT_EDITABLE',error:'Element is not editable.'};if(['file','hidden','password'].includes(type))return{ok:false,code:'BROWSER_SENSITIVE_INPUT_BLOCKED',error:'File, hidden, and password inputs are not supported by browserType.'};if(e.disabled||e.readOnly||e.getAttribute('aria-disabled')==='true')return{ok:false,code:'BROWSER_ELEMENT_DISABLED',error:'Element is disabled or read-only.'};e.focus();if(clear){if('value'in e)e.value='';else e.textContent='';e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward',data:null}));}return{ok:true,tag,type};})()`;
      const prepared = await evaluateValue(client, prepare) || {};
      if (!prepared.ok) return prepared;
      if (!client.Input?.insertText) return { ok:false, code:'CDP_INPUT_UNAVAILABLE', error:'Browser CDP text input is unavailable.' };
      await client.Input.insertText({ text });
      const confirm = await evaluateValue(client, `(()=>{const e=document.querySelector('[data-access-agent-ref="'+CSS.escape(${JSON.stringify(ref)})+'"]');const value=e?String('value'in e?e.value:e.innerText||e.textContent||''):'';return{present:Boolean(e),valueLength:value.length,url:location.href,title:document.title};})()`);
      if (confirm?.url) this._assertAllowedUrl(confirm.url);
      this.currentTargetId = targetId;
      return { ok:Boolean(confirm?.present), targetId, ref, insertedCharacters:text.length, valueLength:confirm?.valueLength ?? null, url:confirm?.url || null, title:confirm?.title || null, submitted:false };
    });
  }

  async scroll(input = {}) {
    const ref = String(input.ref || '').trim();
    const x = Math.max(-10000, Math.min(10000, Number(input.x) || 0));
    const y = Math.max(-10000, Math.min(10000, Number(input.y) || 0));
    return this._withTarget(input.targetId, async (client, targetId) => {
      const expression = ref
        ? `(()=>{const e=document.querySelector('[data-access-agent-ref="'+CSS.escape(${JSON.stringify(ref)})+'"]');if(!e)return{ok:false,code:'BROWSER_REF_STALE',error:'Element ref is missing; take a fresh snapshot.'};e.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});return{ok:true,url:location.href,scrollX:window.scrollX,scrollY:window.scrollY};})()`
        : `(()=>{window.scrollBy({left:${JSON.stringify(x)},top:${JSON.stringify(y)},behavior:'auto'});return{ok:true,url:location.href,scrollX:window.scrollX,scrollY:window.scrollY};})()`;
      const result = await evaluateValue(client, expression) || {};
      if (result?.url) this._assertAllowedUrl(result.url);
      if (result.ok) this.currentTargetId = targetId;
      return { ...result, targetId, ref:ref || null };
    });
  }

  async close(input = {}) {
    const { id:targetId, ownership } = this._ownedTarget(input.targetId);
    const endpoint = await this._endpoint();
    this._assertEndpointOwnership(targetId, ownership, endpoint);
    const client = await this.cdpFactory(endpointParts(endpoint));
    try {
      const result = await client.Target.closeTarget({ targetId });
      if (result?.success === false) return { ok:false, targetId, code:'BROWSER_TARGET_CLOSE_FAILED', error:'Chrome did not close the browsing target.' };
    } finally {
      await client.close();
    }
    this.ownedTargets.delete(targetId);
    if (this.currentTargetId === targetId) this.currentTargetId = this.ownedTargets.keys().next().value || null;
    if (!this.ownedTargets.size) await this._disposeIsolatedContext(client, endpoint);
    return { ok:true, targetId, currentTargetId:this.currentTargetId };
  }

  async dispose() {
    const endpoint = this.browserContextEndpoint;
    if (!endpoint || !this.browserContextId) return { ok:true, disposed:false };
    const client = await this.cdpFactory(endpointParts(endpoint));
    try { await this._disposeIsolatedContext(client, endpoint); }
    finally { await client.close(); }
    this.ownedTargets.clear();
    this.currentTargetId = null;
    return { ok:true, disposed:true };
  }
}

module.exports = {
  BrowserToolRuntime,
  normalizeWebUrl,
  evaluateValue,
  DEFAULT_TEXT_LIMIT,
  DEFAULT_INTERACTIVE_LIMIT,
  DEFAULT_ACCESSIBILITY_LIMIT,
};
