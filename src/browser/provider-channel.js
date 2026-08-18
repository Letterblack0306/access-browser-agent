'use strict';

const CDP = require('chrome-remote-interface');

const PROVIDERS = Object.freeze({
  chatgpt: Object.freeze({
    name:'ChatGPT',
    hosts:new Set(['chatgpt.com','www.chatgpt.com','chat.openai.com']),
    assistant:['[data-message-author-role="assistant"]'],
    composer:['#prompt-textarea','textarea[data-testid="prompt-textarea"]','div[contenteditable="true"][id="prompt-textarea"]','textarea'],
    send:['button[data-testid="send-button"]','button[aria-label*="Send" i]'],
    stop:['button[data-testid="stop-button"]','button[aria-label*="Stop" i]'],
    authorRole:'assistant',
  }),
  deepseek: Object.freeze({
    name:'DeepSeek',
    hosts:new Set(['chat.deepseek.com','deepseek.com']),
    assistant:['[data-message-author-role="assistant"]','.assistant-message','.message-assistant'],
    composer:['textarea[placeholder*="message"]','textarea[placeholder*="ask"]','textarea[placeholder*="type"]','[contenteditable="true"][role="textbox"]','textarea'],
    send:['button[aria-label="Send"]','button[type="submit"]','button:has-text("Send")'],
    stop:['button[aria-label="Stop"]','button[aria-label="Stop generating"]'],
    authorRole:'assistant',
  }),
});

function providerForUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!['http:','https:'].includes(parsed.protocol)) return null;
    const host=parsed.hostname.toLowerCase();
    for (const [id,provider] of Object.entries(PROVIDERS)) {
      if (provider.hosts.has(host)) return id;
    }
    return null;
  } catch { return null; }
}

function endpointParts(endpoint) {
  const url = new URL(String(endpoint || ''));
  if (!['127.0.0.1','localhost','::1'].includes(url.hostname)) throw new Error('Browser CDP endpoint must be local.');
  const port=Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Browser CDP endpoint has no valid port.');
  return { host:url.hostname, port };
}

function normalizedChatIdentity(value) {
  try {
    const url=new URL(String(value || ''));
    const providerId=providerForUrl(url.toString());
    if (!providerId) return '';
    const path=url.pathname.replace(/\/+$/u,'') || '/';
    return `${url.origin}${path}`;
  } catch { return ''; }
}

function sameChatIdentity(expected, observed) {
  const left=normalizedChatIdentity(expected);
  const right=normalizedChatIdentity(observed);
  return Boolean(left && right && left === right);
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function evaluateValue(client, expression) {
  return (await client.Runtime.evaluate({ expression, returnByValue:true }))?.result?.value || {};
}
async function poll(check, { timeoutMs=3000, intervalMs=100 } = {}) {
  const deadline=Date.now()+timeoutMs;
  let latest;
  do {
    latest=await check();
    if (latest?.ok || latest?.terminal) return latest;
    if (Date.now() >= deadline) return latest;
    await wait(intervalMs);
  } while (Date.now() < deadline);
  return latest;
}

class ProviderChannel {
  constructor({ cdpFactory=CDP, readinessTimeoutMs=3500 } = {}) {
    this.cdpFactory=cdpFactory;
    this.readinessTimeoutMs=Math.max(500, Number(readinessTimeoutMs) || 3500);
    this.targetUrls=new Map();
    this.targetMeta=new Map();
  }

  async openTab(endpoint, url) {
    const targetUrl=new URL(String(url || ''));
    const providerId=providerForUrl(targetUrl.toString());
    if (!providerId) {
      const error=new Error(`Unsupported chat endpoint: ${targetUrl.hostname}. Configure a supported chat conversation URL rather than an arbitrary web page.`);
      error.code='UNSUPPORTED_CHAT_PROVIDER';
      error.classification='USER_SETUP';
      throw error;
    }
    const client=await this.cdpFactory(endpointParts(endpoint));
    try {
      const created=await client.Target.createTarget({ url:targetUrl.toString() });
      const targetId=String(created.targetId);
      this.targetUrls.set(targetId,targetUrl.toString());
      this.targetMeta.set(targetId,{ providerId, configuredUrl:targetUrl.toString(), selectedAt:new Date().toISOString(), lastValidatedAt:null });
      return { targetId, url:targetUrl.toString(), providerId, provider:PROVIDERS[providerId].name };
    } finally { await client.close(); }
  }

  async closeTarget(endpoint,targetId) {
    const id=String(targetId||'');
    if(!id)throw new Error('An exact browser target ID is required before closing a page.');
    const client=await this.cdpFactory(endpointParts(endpoint));
    try{return await client.Target.closeTarget({targetId:id});}
    finally{await client.close();}
  }

  async listTabs(endpoint) {
    const targets=await this.cdpFactory.List(endpointParts(endpoint));
    return targets.filter(target => target?.type === 'page').map(target => {
      const providerId=providerForUrl(target.url);
      return {
        targetId:String(target.id),
        providerId,
        supported:Boolean(providerId),
        provider:providerId ? PROVIDERS[providerId].name : 'Unsupported page',
        title:String(target.title || ''),
        url:String(target.url || ''),
        type:String(target.type || 'page'),
      };
    });
  }

  expectedUrlFor(targetId) { return this.targetUrls.get(String(targetId)) || ''; }
  targetProvenance(targetId) { return this.targetMeta.get(String(targetId)) || null; }

  async inspectTarget(endpoint, targetId, providerId) {
    const provider=PROVIDERS[providerId];
    if (!provider) {
      const error=new Error('Selected target has no supported chat adapter.');
      error.code='UNSUPPORTED_CHAT_PROVIDER';
      throw error;
    }
    const client=await this.cdpFactory({ ...endpointParts(endpoint), target:String(targetId) });
    try {
      await client.Runtime.enable();
      const expression=`(()=>{const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0};const enabled=e=>visible(e)&&!e.disabled&&e.getAttribute("aria-disabled")!=="true";let composer=null;for(const selector of ${JSON.stringify(provider.composer)}){composer=[...document.querySelectorAll(selector)].find(enabled);if(composer)break;}return {url:location.href,title:document.title,readyState:document.readyState,composerReady:Boolean(composer),generating:${JSON.stringify(provider.stop)}.some(s=>visible(document.querySelector(s)))};})()`;
      const value=await evaluateValue(client,expression);
      if (providerForUrl(value.url) !== providerId) {
        const error=new Error('Selected target no longer matches its supported chat adapter.');
        error.code='TARGET_PROVIDER_MISMATCH';
        error.classification='TARGET';
        throw error;
      }
      const meta=this.targetMeta.get(String(targetId)) || { providerId, configuredUrl:this.targetUrls.get(String(targetId)) || value.url, selectedAt:new Date().toISOString() };
      meta.lastValidatedAt=new Date().toISOString();
      this.targetMeta.set(String(targetId),meta);
      return { targetId:String(targetId), providerId, provider:provider.name, ...value, provenance:{...meta} };
    } finally { await client.close(); }
  }

  async waitForExactChat(endpoint, targetId, expectedUrl, { timeoutMs=20000, intervalMs=250 } = {}) {
    const providerId=providerForUrl(expectedUrl);
    if (!providerId) {
      const error=new Error('The configured URL does not have a supported chat adapter.');
      error.code='UNSUPPORTED_CHAT_PROVIDER';
      error.classification='USER_SETUP';
      throw error;
    }
    this.targetUrls.set(String(targetId),String(expectedUrl));
    const existing=this.targetMeta.get(String(targetId));
    this.targetMeta.set(String(targetId),{
      providerId,
      configuredUrl:String(expectedUrl),
      selectedAt:existing?.selectedAt || new Date().toISOString(),
      lastValidatedAt:existing?.lastValidatedAt || null,
    });
    const deadline=Date.now()+Math.max(1000,Number(timeoutMs)||20000);
    let latest=null;
    let lastError=null;
    do {
      try {
        latest=await this.inspectTarget(endpoint,targetId,providerId);
        const identityMatches=sameChatIdentity(expectedUrl,latest.url);
        if (identityMatches && latest.readyState === 'complete' && latest.composerReady) {
          return { ok:true, ...latest, expectedUrl:String(expectedUrl), identityMatches:true };
        }
        if (latest.readyState === 'complete' && !identityMatches && latest.url && !String(latest.url).startsWith('about:')) {
          const error=new Error(`Opened page changed away from the configured chat URL. Expected ${normalizedChatIdentity(expectedUrl)}; observed ${normalizedChatIdentity(latest.url) || latest.url}.`);
          error.code='CHAT_IDENTITY_CHANGED';
          error.classification='USER_SETUP';
          error.details=latest;
          throw error;
        }
      } catch (error) {
        if (['CHAT_IDENTITY_CHANGED','UNSUPPORTED_CHAT_PROVIDER'].includes(error?.code)) throw error;
        lastError=error;
      }
      if (Date.now() < deadline) await wait(intervalMs);
    } while (Date.now() < deadline);
    const error=new Error(latest?.composerReady === false
      ? `Chat page opened but its composer was not ready at ${latest.url || expectedUrl}. Sign in or finish any blocking page state, then Recover.`
      : `Chat page did not become ready: ${lastError?.message || 'readiness timeout'}`);
    error.code=latest?.composerReady === false ? 'CHAT_COMPOSER_NOT_READY' : 'CHAT_READINESS_TIMEOUT';
    error.classification=latest?.composerReady === false ? 'USER_SETUP' : 'BROWSER';
    error.details=latest;
    throw error;
  }

  async snapshot(endpoint, targetId, providerId) {
    const provider=PROVIDERS[providerId];
    if (!provider) {
      const error=new Error('Selected target has no supported chat adapter.');
      error.code='UNSUPPORTED_CHAT_PROVIDER';
      throw error;
    }
    const client=await this.cdpFactory({ ...endpointParts(endpoint), target:String(targetId) });
    try {
      await client.Runtime.enable();
      const expression=`(()=>{const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0};const stop=${JSON.stringify(provider.stop)};let text="",messageIndex=-1,messageId="";for(const selector of ${JSON.stringify(provider.assistant)}){const nodes=[...document.querySelectorAll(selector)].filter(visible);for(let i=nodes.length-1;i>=0;i--){const value=(nodes[i].innerText||nodes[i].textContent||"").trim();if(value){const identityNode=nodes[i].closest?.("[data-message-id]")||nodes[i];text=value;messageIndex=i;messageId=String(identityNode?.getAttribute?.("data-message-id")||nodes[i].getAttribute?.("data-message-id")||nodes[i].id||"");break;}}if(text)break;}return {text,generating:stop.some(s=>visible(document.querySelector(s))),url:location.href,title:document.title,readyState:document.readyState,provenance:{authorRole:${JSON.stringify(provider.authorRole)},selectorFamily:${JSON.stringify(provider.assistant)},messageIndex,messageId,verifiedAssistant:true,messagePresent:Boolean(text)}};})()`;
      const snapshot=await evaluateValue(client,expression);
      const observedProviderId=providerForUrl(snapshot.url);
      if (observedProviderId !== providerId) {
        const error=new Error('Selected target no longer matches the configured chat adapter.');
        error.code='TARGET_PROVIDER_MISMATCH';
        error.classification='TARGET';
        error.details={targetId:String(targetId),expectedProviderId:String(providerId),observedProviderId,observedUrl:String(snapshot.url||'')};
        throw error;
      }
      const expected=this.expectedUrlFor(targetId);
      if (expected && !sameChatIdentity(expected,snapshot.url)) {
        const error=new Error('Selected target moved away from the configured conversation.');
        error.code='CHAT_IDENTITY_CHANGED';
        error.classification='TARGET';
        throw error;
      }
      const meta=this.targetMeta.get(String(targetId)) || { providerId, configuredUrl:expected || snapshot.url, selectedAt:new Date().toISOString() };
      meta.lastValidatedAt=new Date().toISOString();
      this.targetMeta.set(String(targetId),meta);
      return { targetId:String(targetId), providerId, provider:provider.name, ...snapshot, targetProvenance:{...meta} };
    } finally { await client.close(); }
  }

  async readConversation(endpoint, targetId, providerId, { limit=20 } = {}) {
    const provider=PROVIDERS[providerId];
    if (!provider) {
      const error=new Error('Selected target has no supported chat adapter.');
      error.code='UNSUPPORTED_CHAT_PROVIDER';
      throw error;
    }
    const boundedLimit=Math.min(100,Math.max(1,Number(limit)||20));
    const client=await this.cdpFactory({ ...endpointParts(endpoint), target:String(targetId) });
    try {
      await client.Runtime.enable();
      const expression=`(()=>{const nodes=[...document.querySelectorAll("[data-message-author-role]")];const messages=[];for(let i=0;i<nodes.length;i+=1){const node=nodes[i];const role=String(node.getAttribute("data-message-author-role")||"").trim().toLowerCase();if(!["user","assistant"].includes(role))continue;const text=String(node.innerText||node.textContent||"").trim();if(!text)continue;const identityNode=node.closest?.("[data-message-id]")||node;const messageId=String(identityNode?.getAttribute?.("data-message-id")||node.getAttribute?.("data-message-id")||node.id||"");messages.push({role,text:text.slice(0,16000),messageIndex:i,messageId});}return {url:location.href,title:document.title,readyState:document.readyState,messages:messages.slice(-${boundedLimit})};})()`;
      const result=await evaluateValue(client,expression);
      if (providerForUrl(result.url) !== providerId) {
        const error=new Error('Selected target no longer matches its supported chat adapter.');
        error.code='TARGET_PROVIDER_MISMATCH';
        error.classification='TARGET';
        throw error;
      }
      const expected=this.expectedUrlFor(targetId);
      if (expected && !sameChatIdentity(expected,result.url)) {
        const error=new Error('Selected target moved away from the configured conversation.');
        error.code='CHAT_IDENTITY_CHANGED';
        error.classification='TARGET';
        throw error;
      }
      const meta=this.targetMeta.get(String(targetId)) || { providerId, configuredUrl:expected || result.url, selectedAt:new Date().toISOString() };
      meta.lastValidatedAt=new Date().toISOString();
      this.targetMeta.set(String(targetId),meta);
      return { ok:true,targetId:String(targetId),providerId,provider:provider.name,url:String(result.url||''),title:String(result.title||''),readyState:String(result.readyState||''),messages:Array.isArray(result.messages)?result.messages:[],provenance:{...meta} };
    } finally { await client.close(); }
  }

  async send(endpoint, targetId, providerId, text) {
    const provider=PROVIDERS[providerId];
    if (!provider) {
      const error=new Error('Selected target has no supported chat adapter.');
      error.code='UNSUPPORTED_CHAT_PROVIDER';
      throw error;
    }
    const expected=this.expectedUrlFor(targetId);
    const client=await this.cdpFactory({ ...endpointParts(endpoint), target:String(targetId) });
    try {
      await client.Runtime.enable();
      const readinessExpression=`(()=>{const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0};const enabled=e=>visible(e)&&!e.disabled&&e.getAttribute("aria-disabled")!=="true";if(${JSON.stringify(provider.stop)}.some(s=>visible(document.querySelector(s))))return {ok:false,code:"PROVIDER_GENERATING",error:"Provider is still generating."};let composer=null;for(const selector of ${JSON.stringify(provider.composer)}){composer=[...document.querySelectorAll(selector)].find(enabled);if(composer)break;}if(!composer)return {ok:false,code:"COMPOSER_NOT_FOUND",error:"Provider composer not found."};return {ok:true,url:location.href,title:document.title};})()`;
      const readiness=await poll(()=>evaluateValue(client,readinessExpression),{timeoutMs:this.readinessTimeoutMs,intervalMs:100});
      if (!readiness?.ok) {
        const error=new Error(readiness?.error || 'Provider composer did not become ready.');
        error.code=readiness?.code || 'COMPOSER_NOT_FOUND';
        throw error;
      }
      if (providerForUrl(readiness.url) !== providerId) {
        const error=new Error('Selected target changed while preparing result delivery.');
        error.code='TARGET_PROVIDER_MISMATCH';
        throw error;
      }
      if (expected && !sameChatIdentity(expected,readiness.url)) {
        const error=new Error('Selected target moved away from the configured conversation before result delivery.');
        error.code='CHAT_IDENTITY_CHANGED';
        throw error;
      }
      const prepareExpression=`(()=>{const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0};const enabled=e=>visible(e)&&!e.disabled&&e.getAttribute("aria-disabled")!=="true";let composer=null;for(const selector of ${JSON.stringify(provider.composer)}){composer=[...document.querySelectorAll(selector)].find(enabled);if(composer)break;}if(!composer)return {ok:false,code:"COMPOSER_NOT_FOUND",error:"Provider composer not found."};composer.focus();if("value" in composer)composer.value="";else{const selection=getSelection();const range=document.createRange();range.selectNodeContents(composer);selection.removeAllRanges();selection.addRange(range);document.execCommand("delete",false);selection.removeAllRanges();}composer.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward",data:null}));return {ok:true};})()`;
      const prepared=await evaluateValue(client,prepareExpression);
      if (!prepared.ok) {
        const error=new Error(prepared.error || 'Provider composer could not be prepared.');
        error.code=prepared.code || 'COMPOSER_NOT_FOUND';
        throw error;
      }
      if (!client.Input?.insertText) {
        const error=new Error('Browser CDP input is unavailable; cannot submit the provider result safely.');
        error.code='CDP_INPUT_UNAVAILABLE';
        throw error;
      }
      await client.Input.insertText({text:String(text)});
      const submitExpression=`(()=>{const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0};const enabled=e=>visible(e)&&!e.disabled&&e.getAttribute("aria-disabled")!=="true";if(${JSON.stringify(provider.stop)}.some(s=>visible(document.querySelector(s))))return {ok:true,method:"already-generating"};for(const selector of ${JSON.stringify(provider.send)}){const button=[...document.querySelectorAll(selector)].find(enabled);if(button){button.click();return {ok:true,method:"button",selector};}}return {ok:false,code:"SEND_BUTTON_UNAVAILABLE",error:"Provider send button is not ready yet."};})()`;
      let submission=await poll(()=>evaluateValue(client,submitExpression),{timeoutMs:this.readinessTimeoutMs,intervalMs:100});
      if (!submission?.ok && client.Input?.dispatchKeyEvent) {
        await client.Input.dispatchKeyEvent({type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
        await client.Input.dispatchKeyEvent({type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
        submission={ok:true,method:'enter'};
      }
      if (!submission?.ok) {
        const error=new Error(submission?.error || 'Provider send control did not become available.');
        error.code=submission?.code || 'SEND_BUTTON_UNAVAILABLE';
        throw error;
      }
      const confirmExpression=`(()=>{const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0};const composer=${JSON.stringify(provider.composer)}.map(s=>[...document.querySelectorAll(s)].find(visible)).find(Boolean);const composerText=(composer?.value??composer?.innerText??composer?.textContent??"").trim();const generating=${JSON.stringify(provider.stop)}.some(s=>visible(document.querySelector(s)));return {ok:generating||!composerText,generating,composerTextLength:composerText.length,url:location.href,title:document.title};})()`;
      const confirmation=await poll(()=>evaluateValue(client,confirmExpression),{timeoutMs:this.readinessTimeoutMs,intervalMs:100});
      if (!confirmation?.ok) {
        const error=new Error('Provider did not confirm result submission within the readiness window.');
        error.code='SEND_NOT_CONFIRMED';
        throw error;
      }
      if (providerForUrl(confirmation.url) !== providerId || (expected && !sameChatIdentity(expected,confirmation.url))) {
        const error=new Error('Selected conversation identity changed during result confirmation.');
        error.code='CHAT_IDENTITY_CHANGED';
        throw error;
      }
      const meta=this.targetMeta.get(String(targetId));
      if (meta) {
        meta.lastValidatedAt=new Date().toISOString();
        this.targetMeta.set(String(targetId),meta);
      }
      return {
        targetId:String(targetId), providerId, provider:provider.name,
        title:String(confirmation.title || ''), url:String(confirmation.url || ''),
        submission:confirmation.generating ? 'PROVIDER_GENERATING' : 'SUBMISSION_ACCEPTED',
        response:'UNVERIFIED', method:submission.method || 'unknown', accepted:true,
        provenance:meta ? {...meta} : null,
      };
    } finally { await client.close(); }
  }
}

module.exports={ PROVIDERS, ProviderChannel, providerForUrl, endpointParts, poll, normalizedChatIdentity, sameChatIdentity };

