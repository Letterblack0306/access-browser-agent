'use strict';

const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const CDP = require('chrome-remote-interface');
const electronExecutable = require('electron');

const HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 30000;
const POLL_MS = 150;
const STEP_TIMEOUT_MS = Number(process.env.ACCESS_AGENT_ACCEPTANCE_STEP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
const CHAT_URL = String(process.env.ACCESS_AGENT_ACCEPTANCE_CHAT_URL || '').trim();
const projectRoot = path.resolve(__dirname, '..');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function selectFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function compactStatus(status) {
  return {
    runtimeActive: status?.runtimeControl?.active === true,
    runtimeStatus: status?.status || null,
    agent: status?.agent ? {
      running: status.agent.running === true,
      status: status.agent.status || null,
      turnId: status.agent.turnId || null,
    } : null,
    browser: status?.browser ? {
      lifecycle: status.browser.lifecycle || null,
      endpoint: status.browser.endpoint || null,
      running: status.browser.running === true,
      backendReady: status.browser.backendReady === true,
      generation: status.browser.generation ?? null,
    } : null,
    relay: status?.browserRelay ? {
      lifecycle: status.browserRelay.lifecycle || null,
      running: status.browserRelay.running === true,
      checking: status.browserRelay.checking === true,
      targetId: status.browserRelay.target?.targetId || null,
      providerId: status.browserRelay.target?.providerId || null,
      activeTargetId: status.browserRelay.activeTarget?.targetId || null,
      pendingResult: status.browserRelay.pendingResult === true,
      delivery: status.browserRelay.delivery ? {
        state: status.browserRelay.delivery.state || null,
        instructionId: status.browserRelay.delivery.instructionId || null,
        attempts: status.browserRelay.delivery.attempts ?? null,
        error: status.browserRelay.delivery.error || null,
      } : null,
      error: status.browserRelay.error || null,
    } : null,
  };
}

function tail(text, limit = 12000) {
  const value = String(text || '');
  return value.length > limit ? value.slice(-limit) : value;
}

async function waitForCdp(port, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const targets = await CDP.List({ host:HOST, port });
      const page = targets.find(target => target.type === 'page' && /rebuild|index\.html|access/i.test(`${target.url || ''} ${target.title || ''}`));
      if (page) return page;
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_MS);
  }
  const error = new Error('Timed out waiting for the Access Agent renderer CDP target.');
  error.code = 'ACCEPTANCE_RENDERER_TARGET_TIMEOUT';
  error.cause = lastError;
  throw error;
}

async function evaluate(client, expression) {
  const response = await client.Runtime.evaluate({ expression, returnByValue:true, awaitPromise:true });
  if (response?.exceptionDetails) {
    const message = response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Renderer evaluation failed.';
    const error = new Error(message);
    error.code = 'ACCEPTANCE_RENDERER_EVALUATION_FAILED';
    throw error;
  }
  return response?.result?.value;
}

async function rendererStatus(client) {
  return evaluate(client, `(async()=>{
    if(!window.accessIde?.status) throw new Error('window.accessIde.status is unavailable');
    return await window.accessIde.status();
  })()`);
}

async function rendererPreferences(client) {
  return evaluate(client, `(async()=>window.accessIde?.preferences ? await window.accessIde.preferences() : {})()`)
    .catch(() => ({}));
}

async function discoverChatTargets(client) {
  return evaluate(client, `(async()=>{
    if(!window.accessIde?.browserStart || !window.accessIde?.browserProviderTabs) return [];
    await window.accessIde.browserStart();
    const tabs=await window.accessIde.browserProviderTabs();
    return Array.isArray(tabs)?tabs:[];
  })()`)
    .catch(() => []);
}

function supportedChatCandidates(tabs) {
  const seen = new Set();
  const output = [];
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    const raw = String(tab?.url || '').trim();
    if (!raw) continue;
    let url;
    try { url = new URL(raw); } catch { continue; }
    const providerId = String(tab?.providerId || '').toLowerCase();
    const chatgptHost = /(^|\.)chatgpt\.com$/iu.test(url.hostname);
    const conversationPath = /^\/c\/[^/]+/u.test(url.pathname);
    if (!(providerId === 'chatgpt' || chatgptHost) || !conversationPath) continue;
    const identity = `${url.origin}${url.pathname.replace(/\/+$/u, '')}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    output.push({
      url:url.toString(),
      targetId:String(tab?.targetId || ''),
      providerId:String(tab?.providerId || 'chatgpt'),
      title:String(tab?.title || ''),
    });
  }
  return output;
}

async function recentDiagnostics(client, limit = 250) {
  return evaluate(client, `(async()=>window.accessIde?.diagnosticRecent ? await window.accessIde.diagnosticRecent(${Number(limit)}) : [])()`)
    .catch(() => []);
}

async function rendererInfo(client) {
  return evaluate(client, `(()=>({
    url:location.href,
    title:document.title,
    readyState:document.readyState,
    loopStart:document.getElementById('loopStart')?{
      text:document.getElementById('loopStart').textContent,
      disabled:document.getElementById('loopStart').disabled
    }:null,
    checkTarget:document.getElementById('checkTarget')?{
      text:document.getElementById('checkTarget').textContent,
      disabled:document.getElementById('checkTarget').disabled
    }:null,
    stopAll:document.getElementById('stopAll')?{
      text:document.getElementById('stopAll').textContent,
      disabled:document.getElementById('stopAll').disabled
    }:null,
    chatUrl:document.getElementById('chatUrl')?.value||''
  }))()`);
}

async function setChatUrl(client, value) {
  return evaluate(client, `(()=>{
    const node=document.getElementById('chatUrl');
    if(!node) throw new Error('chatUrl control is missing');
    node.value=${JSON.stringify(value)};
    node.dispatchEvent(new Event('input',{bubbles:true}));
    node.dispatchEvent(new Event('change',{bubbles:true}));
    return node.value;
  })()`);
}

async function click(client, id) {
  return evaluate(client, `(()=>{
    const node=document.getElementById(${JSON.stringify(id)});
    if(!node) throw new Error('Control ${id} is missing');
    if(node.disabled) throw new Error('Control ${id} is disabled');
    const label=String(node.textContent||'').trim();
    node.click();
    return {id:${JSON.stringify(id)},label};
  })()`);
}

async function waitForStatus(client, predicate, description, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      last = await rendererStatus(client);
      if (predicate(last)) return last;
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_MS);
  }
  const error = new Error(`Timed out waiting for: ${description}`);
  error.code = 'ACCEPTANCE_STEP_TIMEOUT';
  error.expected = description;
  error.actual = compactStatus(last);
  error.cause = lastError;
  throw error;
}

async function waitForControlEnabled(client, id, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await evaluate(client, `(()=>{
      const node=document.getElementById(${JSON.stringify(id)});
      return node?{exists:true,disabled:Boolean(node.disabled),text:String(node.textContent||'').trim()}:{exists:false};
    })()`);
    if (latest?.exists && latest.disabled === false) return latest;
    await delay(POLL_MS);
  }
  const error = new Error(`Control ${id} did not become enabled.`);
  error.code = 'ACCEPTANCE_CONTROL_DISABLED';
  error.actual = latest;
  throw error;
}

function hasUiClick(diagnostics, id) {
  return (Array.isArray(diagnostics) ? diagnostics : []).some(record =>
    record?.source === 'renderer'
      && record?.category === 'ui'
      && record?.action === 'click'
      && record?.data?.id === id,
  );
}

async function waitForUiClickEvidence(client, id, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let diagnostics = [];
  while (Date.now() < deadline) {
    diagnostics = await recentDiagnostics(client, 400);
    if (hasUiClick(diagnostics, id)) return diagnostics;
    await delay(POLL_MS);
  }
  const error = new Error(`Renderer click evidence was not observed for ${id}.`);
  error.code = 'ACCEPTANCE_CLICK_EVIDENCE_MISSING';
  throw error;
}

async function runStep(index, total, id, action) {
  const started = Date.now();
  process.stdout.write(`[${index}/${total}] ${id} ... `);
  try {
    const evidence = await action();
    console.log(`PASS (${Date.now() - started} ms)`);
    return evidence;
  } catch (error) {
    console.log(`FAIL (${Date.now() - started} ms)`);
    error.acceptanceStep = id;
    throw error;
  }
}

async function main() {
  const cdpPort = await selectFreePort();
  const stdout = [];
  const stderr = [];
  let child = null;
  let client = null;
  let finalStatus = null;
  let finalRenderer = null;

  try {
    child = spawn(electronExecutable, [`--remote-debugging-port=${cdpPort}`, projectRoot], {
      cwd:projectRoot,
      env:{
        ...process.env,
        ACCESS_AGENT_UI_ACCEPTANCE:'1',
      },
      windowsHide:false,
      stdio:['ignore','pipe','pipe'],
    });
    child.stdout?.on('data', chunk => stdout.push(String(chunk)));
    child.stderr?.on('data', chunk => stderr.push(String(chunk)));

    const target = await runStep(1, 8, 'renderer-cdp-ready', async () => waitForCdp(cdpPort));
    client = await CDP({ host:HOST, port:cdpPort, target:target.id });
    await client.Runtime.enable();

    await runStep(2, 8, 'renderer-runtime-api-ready', async () => {
      const info = await rendererInfo(client);
      if (!info?.readyState || !info.loopStart) throw Object.assign(new Error('Browser Loop controls are not mounted.'), { code:'ACCEPTANCE_UI_NOT_READY', actual:info });
      const status = await rendererStatus(client);
      return { info, status:compactStatus(status) };
    });

    const configuredChatUrl = await runStep(3, 8, 'chat-target-configured', async () => {
      const info = await rendererInfo(client);
      const preferences = await rendererPreferences(client);
      const savedTargetUrl = String(preferences?.browserProviderTarget?.url || '').trim();
      let value = CHAT_URL || String(info?.chatUrl || '').trim() || String(preferences?.browserChatUrl || '').trim() || savedTargetUrl;
      let discovery = [];
      if (!value) {
        discovery = supportedChatCandidates(await discoverChatTargets(client));
        if (discovery.length === 1) value = discovery[0].url;
      }
      if (!value) {
        const error = new Error(discovery.length > 1
          ? `Multiple live ChatGPT conversation targets were discovered; refusing to guess between ${discovery.length} conversations.`
          : 'No Browser Loop chat URL is configured and no unique live ChatGPT conversation target was discovered.');
        error.code = discovery.length > 1 ? 'ACCEPTANCE_CHAT_TARGET_AMBIGUOUS' : 'ACCEPTANCE_CHAT_URL_REQUIRED';
        error.classification = 'USER_SETUP';
        error.expected = 'one explicit, saved, or uniquely discovered ChatGPT conversation URL';
        error.actual = { browserChatUrl:String(preferences?.browserChatUrl || ''), browserProviderTarget:preferences?.browserProviderTarget || null, candidates:discovery };
        throw error;
      }
      const parsed = new URL(value);
      if (!['http:','https:'].includes(parsed.protocol)) throw Object.assign(new Error('Acceptance chat URL must use HTTP/HTTPS.'), { code:'ACCEPTANCE_CHAT_URL_INVALID' });
      await setChatUrl(client, parsed.toString());
      await waitForControlEnabled(client, 'loopStart');
      return parsed.toString();
    });

    const startedStatus = await runStep(4, 8, 'click-loop-start-and-wait', async () => {
      await click(client, 'loopStart');
      await waitForUiClickEvidence(client, 'loopStart');
      return waitForStatus(
        client,
        status => status?.runtimeControl?.active === true
          && Boolean(status?.browser?.endpoint)
          && status?.browser?.backendReady === true
          && status?.browserRelay?.running === true
          && status?.browserRelay?.lifecycle === 'waiting_for_instruction'
          && Boolean(status?.browserRelay?.target?.targetId),
        'runtime active + browser ready + relay waiting_for_instruction + selected target',
      );
    });

    const targetId = startedStatus?.browserRelay?.target?.targetId || null;
    await runStep(5, 8, 'click-check-target-and-preserve-identity', async () => {
      await waitForControlEnabled(client, 'checkTarget');
      await click(client, 'checkTarget');
      await waitForUiClickEvidence(client, 'checkTarget');
      await waitForControlEnabled(client, 'checkTarget');
      const status = await rendererStatus(client);
      if (status?.browserRelay?.running !== true || status?.browserRelay?.target?.targetId !== targetId) {
        const error = new Error('Check target did not preserve the selected live conversation target.');
        error.code = 'ACCEPTANCE_TARGET_IDENTITY_CHANGED';
        error.expected = { running:true, targetId };
        error.actual = compactStatus(status);
        throw error;
      }
      return status;
    });

    await runStep(6, 8, 'click-loop-stop-and-wait', async () => {
      await waitForControlEnabled(client, 'loopStart');
      await click(client, 'loopStart');
      await waitForUiClickEvidence(client, 'loopStart');
      return waitForStatus(
        client,
        status => status?.browserRelay?.running !== true,
        'browser relay stopped',
      );
    });

    await runStep(7, 8, 'click-stop-all-and-wait', async () => {
      const control = await waitForControlEnabled(client, 'stopAll');
      if (!control) throw new Error('Stop All control unavailable.');
      await click(client, 'stopAll');
      await waitForUiClickEvidence(client, 'stopAll');
      return waitForStatus(
        client,
        status => status?.runtimeControl?.active !== true
          && status?.browserRelay?.running !== true
          && !status?.browser?.endpoint
          && status?.browser?.backendReady !== true,
        'runtime stopped + relay stopped + managed browser stopped',
      );
    });

    finalStatus = await runStep(8, 8, 'final-clean-state', async () => {
      const status = await rendererStatus(client);
      const info = await rendererInfo(client);
      if (status?.runtimeControl?.active === true || status?.browserRelay?.running === true || status?.browser?.endpoint) {
        const error = new Error('Acceptance sequence ended with Access-owned resources still active.');
        error.code = 'ACCEPTANCE_FINAL_STATE_DIRTY';
        error.actual = compactStatus(status);
        throw error;
      }
      finalRenderer = info;
      return status;
    });

    console.log('');
    console.log('UI STATE-DRIVEN ACCEPTANCE: PASS');
    console.log(JSON.stringify({
      chatUrl:configuredChatUrl,
      rendererTarget:{ id:target.id, url:target.url, title:target.title },
      finalStatus:compactStatus(finalStatus),
      finalRenderer,
    }, null, 2));
  } catch (error) {
    if (client) {
      finalStatus = await rendererStatus(client).catch(() => null);
      finalRenderer = await rendererInfo(client).catch(() => null);
    }
    const diagnostics = client ? await recentDiagnostics(client, 300).catch(() => []) : [];
    console.error('');
    console.error('UI STATE-DRIVEN ACCEPTANCE: FAIL');
    console.error(JSON.stringify({
      step:error.acceptanceStep || null,
      code:error.code || null,
      classification:error.classification || null,
      message:error.message,
      expected:error.expected || null,
      actual:error.actual || compactStatus(finalStatus),
      renderer:finalRenderer,
      diagnostics:(Array.isArray(diagnostics) ? diagnostics : []).slice(-40),
      stdout:tail(stdout.join('')),
      stderr:tail(stderr.join('')),
    }, null, 2));
    process.exitCode = 1;
  } finally {
    if (client) await client.close().catch(() => {});
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        delay(3000),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
