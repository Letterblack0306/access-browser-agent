'use strict';

(() => {
  const api=window.accessIde;
  const $=id=>document.getElementById(id);
  const normalized=value=>String(value||'').trim();
  const positiveInteger=value=>{const number=Number(value);return Number.isInteger(number)&&number>0?number:null;};
  const setText=(id,value)=>{const node=$(id);if(node)node.textContent=String(value??'');};
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const setBusy=(id,busy)=>{const node=$(id);if(node)node.disabled=busy===true;};
  const catalogState={cline:{values:[],catalog:[]},lm:{values:[],catalog:[]}};

  function setBadge(id,label,tone=''){const node=$(id);if(!node)return;node.textContent=label;node.className=`badge ${tone}`.trim();}
  function catalogIdentity(item={}){return normalized(item.modelId||item.id);}
  function pricingClass(item={}){const value=normalized(item?.pricing?.classification).toLowerCase();if(['free','paid','local','unknown'].includes(value))return value;if(item.free===true)return'free';return'unknown';}
  function catalogGroup(item={}){const pricing=pricingClass(item);if(pricing==='free')return'free';if(pricing==='local')return'local';return'other';}
  function readinessState(item={}){const ready=item.readiness||{};const caps=ready.capabilities||item.capabilities||{};if(ready.agentReady===true&&caps.structuredOutput==='unsupported')return'Agent Ready · Structured Unsupported';if(ready.agentReady===true)return'Agent Ready';if(ready.checkedAt){if(caps.completion==='failed')return'Completion Failed';if(caps.toolCalling==='unsupported'||caps.toolCalling==='failed')return'Tool Calling Unsupported';return'Not Ready';}return'Unverified';}
  function modelOptionLabel(item={},fallback=''){const name=normalized(item.displayName||item.modelId||item.id||fallback)||fallback;const pricing=pricingClass(item);const priceLabel=pricing==='free'?'FREE':pricing==='local'?'LOCAL':pricing==='paid'?'PAID':'PRICE UNKNOWN';return`${name} · ${priceLabel} · ${readinessState(item)}`;}
  function replaceOptions(select,values=[],selected='',catalog=[]){
    if(!select)return;
    const items=Array.isArray(catalog)?catalog:[];
    const byId=new Map(items.map(item=>[catalogIdentity(item),item]).filter(([id])=>id));
    const groups={free:[],local:[],other:[]};
    for(const rawValue of Array.isArray(values)?values:[]){const value=normalized(rawValue);if(!value)continue;const item=byId.get(value)||{id:value,modelId:value,pricing:{classification:'unknown'}};groups[catalogGroup(item)].push({value,item});}
    const placeholder=new Option('Select model…','');
    select.replaceChildren(placeholder);
    const definitions=[['free','Free'],['local','Local'],['other','Other available']];
    for(const[groupKey,label]of definitions){if(!groups[groupKey].length)continue;const group=document.createElement('optgroup');group.label=label;for(const entry of groups[groupKey])group.append(new Option(modelOptionLabel(entry.item,entry.value),entry.value));select.append(group);}
    if(selected&&!values.includes(selected)){const item=byId.get(selected);const saved=new Option(item?`${modelOptionLabel(item,selected)} · Saved`:`${selected} (saved) · Unverified`,selected);select.append(saved);}
    const allValues=Array.from(select.options).map(option=>option.value);select.value=selected&&allValues.includes(selected)?selected:'';
  }
  function rememberCatalog(kind,values=[],catalog=[]){catalogState[kind]={values:[...(Array.isArray(values)?values:[])],catalog:(Array.isArray(catalog)?catalog:[]).map(item=>({...item,readiness:item?.readiness?{...item.readiness,capabilities:{...(item.readiness.capabilities||{})},failureReasons:{...(item.readiness.failureReasons||{})}}:item?.readiness}))};}
  function projectReadiness(kind,model,observed={}){const state=catalogState[kind];if(!state)return;const readiness=observed.readiness||{status:observed.agentReady===true?'agent_ready':'capability_failed',agentReady:observed.agentReady===true,checkedAt:observed.evidence?.checkedAt||null,model:observed.model||model,capabilities:{...(observed.capabilities||{})},failureReasons:{...(observed.evidence?.failureReasons||{})}};let found=false;state.catalog=state.catalog.map(item=>{if(catalogIdentity(item)!==model)return item;found=true;return{...item,readiness:{...readiness,capabilities:{...(readiness.capabilities||{})},failureReasons:{...(readiness.failureReasons||{})}},capabilities:{...(item.capabilities||{}),...(readiness.capabilities||{})}};});if(!found)state.catalog.push({id:model,modelId:model,displayName:model,pricing:{classification:'unknown'},readiness});if(!state.values.includes(model))state.values.push(model);const select=kind==='cline'?$('clineModel'):$('lmModel');replaceOptions(select,state.values,model,state.catalog);}
  function readinessTimestamp(ready={}){const value=ready.readiness?.checkedAt||ready.evidence?.checkedAt||null;return value?` · checked ${value}`:'';}
  function createInput(id,label,{type='text',placeholder='',value=''}={}){const wrapper=document.createElement('label');wrapper.className='field-label';wrapper.textContent=label;const input=document.createElement('input');input.id=id;input.className='text-input';input.type=type;input.placeholder=placeholder;input.value=value==null?'':String(value);wrapper.append(input);return wrapper;}
  function createSelect(id,label,options,selected){const wrapper=document.createElement('label');wrapper.className='field-label';wrapper.textContent=label;const select=document.createElement('select');select.id=id;select.className='target-select';for(const item of options)select.append(new Option(item.label,item.value));select.value=selected||options[0]?.value||'';wrapper.append(select);return wrapper;}

  function ensureAdvancedSettings(preferences){
    const lmSection=$('lmBaseUrl')?.closest('.section-body');
    if(lmSection&&!$('lmStudioApiKey')){
      lmSection.append(
        createInput('lmStudioApiKey','API token · optional',{type:'password',placeholder:'Optional Bearer token',value:preferences.lmStudioApiKey||''}),
        createSelect('lmStudioEndpointPolicy','Endpoint policy',[{value:'loopback',label:'Loopback only'},{value:'private-network',label:'Loopback + private network'},{value:'any-http',label:'Any HTTP/HTTPS endpoint'}],preferences.lmStudioEndpointPolicy||'private-network'),
        createInput('lmStudioContextLength','Context length · optional',{type:'number',placeholder:'Provider/model default',value:preferences.lmStudioContextLength||''}),
        createInput('lmStudioTtlSeconds','JIT idle TTL · seconds',{type:'number',placeholder:'LM Studio default',value:preferences.lmStudioTtlSeconds||''}),
      );
    }
    const integration=$('toggleMcp')?.closest('.section-body');
    if(integration&&!$('mcpServerCommand')){
      integration.prepend(createInput('mcpServerCommand','MCP server command · optional',{placeholder:'npx -y @modelcontextprotocol/server-filesystem .',value:preferences.mcpServerCommand||''}));
      const save=document.createElement('button');save.id='saveIntegrationSettings';save.className='control compact';save.type='button';save.textContent='Save integration';integration.insertBefore(save,$('toggleMcp'));
    }
  }

  function lmFields(){return{providerKind:'lm-studio',lmStudioBaseUrl:normalized($('lmBaseUrl')?.value),lmStudioModel:normalized($('lmModel')?.value),lmStudioApiKey:normalized($('lmStudioApiKey')?.value),lmStudioEndpointPolicy:normalized($('lmStudioEndpointPolicy')?.value)||'private-network',lmStudioContextLength:positiveInteger($('lmStudioContextLength')?.value),lmStudioTtlSeconds:positiveInteger($('lmStudioTtlSeconds')?.value),lmStudioConversationMode:'application',mcpServerCommand:normalized($('mcpServerCommand')?.value)};}
  function readinessSummary(ready){const caps=ready?.capabilities||{};return`completion=${caps.completion||'unknown'}, tools=${caps.toolCalling||'unknown'}, structured=${caps.structuredOutput||'unknown'}`;}
  function requireAgentReady(ready){const observed=normalized(ready?.text||ready?.summary||ready?.response||ready?.result?.text);if(observed!=='READY')throw new Error(`Expected READY; observed ${observed||'(empty)'}.`);if(ready?.agentReady!==true){const reason=ready?.evidence?.failureReasons?.toolCalling||ready?.evidence?.failureReasons?.completion||'Selected model did not prove real tool-call capability.';throw new Error(`Text readiness passed, but the model is not agent-ready: ${reason} (${readinessSummary(ready)}).`);}return ready;}

  async function clineDiscover(extra={}){const selected=normalized($('clineModel')?.value);const result=await api.providerConfigure({providerKind:'cline',clineProviderId:'cline',clineModel:selected,discoverOnly:true,persist:false,...extra});if(result?.error)throw new Error(result.error);rememberCatalog('cline',result.models||[],result.modelCatalog||[]);replaceOptions($('clineModel'),result.models||[],selected,result.modelCatalog||[]);const auth=result.auth||{};setText('clineAuthStatus',auth.authenticated?`Signed in${auth.email?` · ${auth.email}`:''} · ${result.models?.length||0} model(s) discovered · readiness shown per tested model`:auth.error||'Not signed in');setBadge('clineAuthBadge',auth.authenticated?'Signed in':'Signed out',auth.authenticated?'ok':'');return result;}
  async function lmDiscover(){const requested=lmFields();if(!requested.lmStudioBaseUrl)throw new Error('LM Studio base URL is required.');const result=await api.providerConfigure({...requested,discoverOnly:true,persist:false});if(result?.error)throw new Error(result.error);rememberCatalog('lm',result.models||[],result.modelCatalog||[]);replaceOptions($('lmModel'),result.models||[],requested.lmStudioModel,result.modelCatalog||[]);setText('lmStatus',`${result.models?.length||0} model(s) discovered · readiness shown per tested model`);return result;}

  async function init(){
    if(!api)return;
    const prefs=await api.preferences().catch(()=>({}));
    ensureSystemPromptUI(prefs);
    ensureAutoPlanUI(prefs);
    if($('lmBaseUrl'))$('lmBaseUrl').value=prefs.lmStudioBaseUrl||'http://127.0.0.1:1234/v1';
    replaceOptions($('lmModel'),[],prefs.lmStudioModel||'');replaceOptions($('clineModel'),[],prefs.clineModel||'');
    if($('browserProfilePath'))$('browserProfilePath').value=prefs.browserProfilePath||'';
    if($('browserExecutable'))$('browserExecutable').value=prefs.browserExecutable||'';
    if($('chatUrl')&&!$('chatUrl').value)$('chatUrl').value=prefs.browserChatUrl||'';
    ensureAdvancedSettings(prefs);

    $('clineLogin')?.addEventListener('click',async()=>{setBusy('clineLogin',true);try{await clineDiscover({clineLogin:true});}catch(error){setText('clineAuthStatus',error.message);setBadge('clineAuthBadge','Failed','bad');}finally{setBusy('clineLogin',false);}});
    $('clineLogout')?.addEventListener('click',async()=>{setBusy('clineLogout',true);try{await clineDiscover({clineLogout:true});setBadge('clineAuthBadge','Signed out');}catch(error){setText('clineAuthStatus',error.message);}finally{setBusy('clineLogout',false);}});
    $('clineRefreshModels')?.addEventListener('click', async () => { setBusy('clineRefreshModels', true); try { await enhancedClineDiscover(); } catch(error) { setClineStatus(error.message, 'error'); } finally { setBusy('clineRefreshModels', false); } });
    $('clineTest')?.addEventListener('click', async () => { setBusy('clineTest', true); try { await enhancedClineTest(); } catch(error) { setClineStatus(error.message, 'error'); } finally { setBusy('clineTest', false); } });
    $('clineUse')?.addEventListener('click',async()=>{setBusy('clineUse',true);try{const model=normalized($('clineModel')?.value);if(!model)throw new Error('Select a Cline model first.');const requested={providerKind:'cline',clineProviderId:'cline',clineModel:model};await api.providerConfigure({...requested,persist:false});const observed=await api.providerReadiness();projectReadiness('cline',model,observed);const ready=requireAgentReady(observed);const persisted=await api.savePreferences(requested);if(persisted.providerKind!=='cline'||persisted.clineModel!==model)throw new Error('Cline preference verification failed.');setText('clineAuthStatus',`${model} · active agent provider · ${readinessSummary(ready)}${readinessTimestamp(ready)}`);setBadge('clineAuthBadge','Active','ok');}catch(error){setText('clineAuthStatus',error.message);setBadge('clineAuthBadge','Not ready','bad');}finally{setBusy('clineUse',false);}});
    $('lmDiscover')?.addEventListener('click', async () => { setBusy('lmDiscover', true); try { await enhancedLmDiscover(); } catch(error) { setLmStatus(error.message, 'error'); } finally { setBusy('lmDiscover', false); } });
    $('lmTest')?.addEventListener('click', async () => { setBusy('lmTest', true); try { await enhancedLmTest(); } catch(error) { setLmStatus(error.message, 'error'); } finally { setBusy('lmTest', false); } });
    $('lmUse')?.addEventListener('click',async()=>{setBusy('lmUse',true);try{const requested=lmFields();if(!requested.lmStudioBaseUrl||!requested.lmStudioModel)throw new Error('Choose an LM Studio URL and model.');await api.providerConfigure({...requested,persist:false});const observed=await api.providerReadiness();projectReadiness('lm',requested.lmStudioModel,observed);const ready=requireAgentReady(observed);const persisted=await api.savePreferences(requested);for(const key of ['providerKind','lmStudioBaseUrl','lmStudioModel','lmStudioEndpointPolicy'])if(normalized(persisted?.[key])!==normalized(requested[key]))throw new Error(`LM Studio preference verification failed for ${key}.`);setText('lmStatus',`${requested.lmStudioModel} · active agent provider · ${readinessSummary(ready)}${readinessTimestamp(ready)}`);setBadge('lmProviderBadge','Active','ok');}catch(error){setText('lmStatus',error.message);setBadge('lmProviderBadge','Not ready','bad');}finally{setBusy('lmUse',false);}});
    $('chooseChromeProfile')?.addEventListener('click',async()=>{try{const result=await api.selectChromeProfile($('browserProfilePath')?.value||'');if(!result?.canceled&&$('browserProfilePath'))$('browserProfilePath').value=result.path||'';}catch(error){setText('browserSettingsStatus',error.message);}});
    $('saveBrowserDefaults')?.addEventListener('click',async()=>{setBusy('saveBrowserDefaults',true);try{const requested={browserMode:'managed',browserProfilePath:normalized($('browserProfilePath')?.value),browserExecutable:normalized($('browserExecutable')?.value),browserCdpPort:null};const saved=await api.savePreferences(requested);setText('browserSettingsStatus',saved.browserProfilePath?'Custom managed-Chrome profile override saved.':'Saved. Access-owned managed-Chrome profile and dynamic CDP port will be used automatically.');}catch(error){setText('browserSettingsStatus',error.message);}finally{setBusy('saveBrowserDefaults',false);}});
    $('saveIntegrationSettings')?.addEventListener('click',async()=>{setBusy('saveIntegrationSettings',true);try{const requested={mcpServerCommand:normalized($('mcpServerCommand')?.value)};const saved=await api.savePreferences(requested);if(normalized(saved.mcpServerCommand)!==requested.mcpServerCommand)throw new Error('MCP command persistence verification failed.');setText('mcpDetail','Integration settings saved.');}catch(error){setText('mcpDetail',error.message);}finally{setBusy('saveIntegrationSettings',false);}});
    $('saveSystemPrompt')?.addEventListener('click',async()=>{const value=normalized($('systemPromptInput')?.value);if(!value){setText('systemPromptStatus','Prompt cannot be empty.');return;}setBusy('saveSystemPrompt',true);try{const saved=await api.savePreferences({systemPrompt:value});if(normalized(saved.systemPrompt)!==value)throw new Error('System prompt persistence verification failed.');await api.runtimeRestart();setText('systemPromptStatus','✅ Prompt saved and runtime restarted.');const badge=$('promptBadge');if(badge){badge.textContent='Active';badge.className='badge ok';}}catch(error){setText('systemPromptStatus',`Error: ${error.message}`);}finally{setBusy('saveSystemPrompt',false);}});
    $('resetSystemPrompt')?.addEventListener('click',async()=>{try{const defaultPrompt=await api.defaultSystemPrompt();const input=$('systemPromptInput');if(input)input.value=defaultPrompt||'';setText('systemPromptStatus','Default prompt loaded. Click Save & Reset Runtime to apply.');}catch(error){setText('systemPromptStatus',`Error loading default prompt: ${error.message}`);}});
    $('autoPlanToggle')?.addEventListener('click',async()=>{setBusy('autoPlanToggle',true);try{const current=await api.autoPlanStatus();const enabled=!(current?.enabled===true);const status=await api.autoPlanEnable(enabled);renderAutoPlanState(status);setText('autoPlanStatusDetail',enabled?'Watching for changes…':'Not active');}catch(error){setText('autoPlanStatusDetail',`Error: ${error.message}`);}finally{setBusy('autoPlanToggle',false);}});
    $('autoPlanSavePrompt')?.addEventListener('click',async()=>{setBusy('autoPlanSavePrompt',true);try{const value=normalized($('autoPlanPrompt')?.value);await api.autoPlanSetPrompt(value);setText('autoPlanStatusDetail','Plan prompt saved.');}catch(error){setText('autoPlanStatusDetail',`Error: ${error.message}`);}finally{setBusy('autoPlanSavePrompt',false);}});
    $('autoPlanSavePaths')?.addEventListener('click',async()=>{setBusy('autoPlanSavePaths',true);try{const raw=normalized($('autoPlanWatchPaths')?.value);const paths=raw?raw.split(/[,\n]/u).map(item=>item.trim()).filter(Boolean):['.'];await api.autoPlanSetPaths(paths);setText('autoPlanStatusDetail',`Watch paths saved (${paths.length}).`);}catch(error){setText('autoPlanStatusDetail',`Error: ${error.message}`);}finally{setBusy('autoPlanSavePaths',false);}});
    api.onAutoPlanTrigger?.(event=>{const detail=$('autoPlanStatusDetail');if(!detail)return;if(event?.ok){const summary=normalized(event.result?.summary||event.result?.text)||'done';detail.textContent=`✅ Auto-executed for ${event.paths?.length||0} changed file(s). Result: ${summary.slice(0,200)}`;}else{detail.textContent=`❌ Auto-execution failed: ${event?.error?.message||'unknown error'}`;}});

    api.onAgentEvent?.(event=>{
      api.diagnosticEvent?.({source:'agent-event',category:String(event?.phase||'').startsWith('browser_relay.')?'loop':'agent',action:event?.phase||'agent_event',phase:event?.status||'event',correlation:{instructionId:event?.instructionId||null,operationId:event?.operationId||null,turnId:event?.turnId||null,sessionId:event?.sessionId||null},data:event||{}});
      if(event?.phase==='cline.auth.required'){if($('clineAuthUrl')){$('clineAuthUrl').value=normalized(event.url);$('clineAuthUrl').hidden=!normalized(event.url);}setText('clineAuthStatus',event.instructions||'Complete Cline sign-in in the browser.');setBadge('clineAuthBadge','Sign-in','warn');}
      else if(event?.phase==='cline.auth.progress')setText('clineAuthStatus',event.message||event.detail||'Cline authentication in progress…');
    });
    api.onAgentState?.(event=>api.diagnosticEvent?.({source:'agent-state',category:'agent',action:'state_update',phase:'event',correlation:{turnId:event?.turnId||null,sessionId:event?.sessionId||null},data:event||{}}));
    api.onTerminalData?.(event=>api.diagnosticEvent?.({source:'terminal',category:'terminal',action:'output',phase:'event',correlation:{terminalId:event?.terminalId||null},data:{length:String(event?.data||'').length,output:String(event?.data||'')}}));
    api.onTerminalExit?.(event=>api.diagnosticEvent?.({source:'terminal',category:'terminal',action:'exit',phase:'event',correlation:{terminalId:event?.terminalId||null},data:event||{}}));

    if($('clineAuthUrl'))$('clineAuthUrl').hidden=true;
    api.diagnosticEvent?.({source:'settings',category:'browser',action:'saved_chat_loaded',phase:'success',data:{chatUrlConfigured:Boolean(prefs.browserChatUrl),savedTargetPresent:Boolean(prefs.browserProviderTarget)}});
    setText('clineAuthStatus',prefs.clineModel?`${prefs.clineModel} saved · click Discover/Test to verify`:'Not checked');
    setText('lmStatus',prefs.lmStudioModel?`${prefs.lmStudioModel} saved · click Discover/Test/Use to verify`:'Not checked');
    setBadge('lmProviderBadge',prefs.lmStudioModel?'Saved':'Not checked',prefs.lmStudioModel?'ok':'');
    setText('browserSettingsStatus',prefs.browserProfilePath?'Custom managed-Chrome profile override loaded.':'Access-owned managed-Chrome profile and dynamic CDP port will be used automatically.');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(console.error),{once:true});else init().catch(console.error);

  function ensureSystemPromptUI(prefs={}){
    const stack=document.querySelector('[data-view="settings"] .right-stack');
    if(!stack||document.getElementById('systemPromptSection'))return;
    const section=document.createElement('section');
    section.id='systemPromptSection';
    section.className='section';
    const head=document.createElement('header');
    head.className='section-head';
    const title=document.createElement('span');
    title.className='section-title';
    title.textContent='System Prompt (Agent Personality)';
    const badge=document.createElement('span');
    badge.id='promptBadge';
    badge.className='badge';
    badge.textContent=normalized(prefs.systemPrompt)?'Custom':'Default';
    head.append(title,badge);
    const body=document.createElement('div');
    body.className='section-body';
    const label=document.createElement('label');
    label.className='field-label';
    label.append(document.createTextNode('Global instructions for the agent'));
    const textarea=document.createElement('textarea');
    textarea.id='systemPromptInput';
    textarea.className='prompt-textarea';
    textarea.rows=8;
    const savedPrompt=normalized(prefs.systemPrompt);
    textarea.value=savedPrompt;
    if(!savedPrompt){
      api.defaultSystemPrompt?.().then(value=>{textarea.placeholder=String(value||'')||'Enter a custom system prompt…';}).catch(()=>{});
    }
    label.append(textarea);
    const micro=document.createElement('div');
    micro.className='microcopy';
    micro.textContent='This prompt stays active for the entire runtime session. Saving restarts the agent runtime so it takes effect.';
    const row=document.createElement('div');
    row.className='button-row spaced';
    const saveButton=document.createElement('button');
    saveButton.id='saveSystemPrompt';
    saveButton.className='control primary compact';
    saveButton.type='button';
    saveButton.textContent='Save & Reset Runtime';
    const resetButton=document.createElement('button');
    resetButton.id='resetSystemPrompt';
    resetButton.className='control compact';
    resetButton.type='button';
    resetButton.textContent='Reset to Default';
    row.append(saveButton,resetButton);
    const status=document.createElement('div');
    status.id='systemPromptStatus';
    status.className='microcopy';
    status.textContent='Current prompt loaded.';
    body.append(label,micro,row,status);
    section.append(head,body);
    stack.append(section);
  }

  function renderAutoPlanState(status={}){
    const enabled=status.enabled===true;
    const badge=$('autoPlanStatus');
    if(badge){badge.textContent=enabled?'Active':'Inactive';badge.className=`badge ${enabled?'ok':''}`.trim();}
    const toggle=$('autoPlanToggle');
    if(toggle){toggle.textContent=enabled?'Disable':'Enable';toggle.className=`control ${enabled?'danger':'primary'} compact`;}
  }

  function ensureAutoPlanUI(prefs={}){
    const stack=document.querySelector('[data-view="settings"] .right-stack');
    if(!stack||document.getElementById('autoPlanSection'))return;
    const section=document.createElement('section');
    section.id='autoPlanSection';
    section.className='section';
    const head=document.createElement('header');
    head.className='section-head';
    const title=document.createElement('span');
    title.className='section-title';
    title.textContent='Auto-Execution on File Save';
    const badge=document.createElement('span');
    badge.id='autoPlanStatus';
    badge.className='badge';
    badge.textContent=prefs.autoPlanEnabled===true?'Active':'Inactive';
    head.append(title,badge);
    const body=document.createElement('div');
    body.className='section-body';
    const row=document.createElement('div');
    row.className='button-row spaced';
    const toggleButton=document.createElement('button');
    toggleButton.id='autoPlanToggle';
    toggleButton.className=`control ${prefs.autoPlanEnabled===true?'danger':'primary'} compact`;
    toggleButton.type='button';
    toggleButton.textContent=prefs.autoPlanEnabled===true?'Disable':'Enable';
    row.append(toggleButton);
    const promptLabel=document.createElement('label');
    promptLabel.className='field-label';
    promptLabel.append(document.createTextNode('Plan prompt'));
    const promptInput=document.createElement('textarea');
    promptInput.id='autoPlanPrompt';
    promptInput.className='prompt-textarea';
    promptInput.rows=4;
    promptInput.value=prefs.autoPlanPrompt||'';
    promptLabel.append(promptInput);
    const micro=document.createElement('div');
    micro.className='microcopy';
    micro.textContent='This prompt is sent to the agent whenever a watched file changes. The agent receives the list of changed files.';
    const pathsLabel=document.createElement('label');
    pathsLabel.className='field-label';
    pathsLabel.append(document.createTextNode('Watched paths (relative to workspace, comma or newline separated)'));
    const pathsInput=document.createElement('input');
    pathsInput.id='autoPlanWatchPaths';
    pathsInput.className='text-input';
    pathsInput.placeholder='.';

    const paths=(Array.isArray(prefs.autoPlanWatchPaths)?prefs.autoPlanWatchPaths:['.']).join(', ');
    pathsInput.value=paths;
    pathsLabel.append(pathsInput);
    const actionRow=document.createElement('div');
    actionRow.className='button-row spaced';
    const savePromptButton=document.createElement('button');
    savePromptButton.id='autoPlanSavePrompt';
    savePromptButton.className='control compact';
    savePromptButton.type='button';
    savePromptButton.textContent='Save Prompt';
    const savePathsButton=document.createElement('button');
    savePathsButton.id='autoPlanSavePaths';
    savePathsButton.className='control compact';
    savePathsButton.type='button';
    savePathsButton.textContent='Save Watch Paths';
    actionRow.append(savePromptButton,savePathsButton);
    const detail=document.createElement('div');
    detail.id='autoPlanStatusDetail';
    detail.className='microcopy';
    detail.textContent=prefs.autoPlanEnabled===true?'Watching for changes…':'Not active';
    body.append(row,promptLabel,micro,pathsLabel,actionRow,detail);
    section.append(head,body);
    stack.append(section);
  }

// ── Enhanced LM Studio Setup ──
let lmStudioState = { status: 'idle', models: [], selectedModel: null, error: null, agentReady: false };

function setLmStatus(message, type) {
  const el = document.getElementById('lmStatus');
  if (!el) return;
  el.textContent = message;
  el.className = 'microcopy status-' + (type || 'idle');
}

function populateModelSelect(selectId, models, selected) {
  var select = document.getElementById(selectId);
  if (!select) return;
  var previous = select.value;
  select.innerHTML = '<option value="">Select model…</option>';
  (models || []).forEach(function(model) {
    var option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  });
  var desired = selected || previous;
  if (desired && models.indexOf(desired) !== -1) select.value = desired;
}

function renderLmModelList(models, catalog) {
  const list = document.getElementById('lmModelList');
  if (!list) {
    populateModelSelect('lmModel', models, lmStudioState.selectedModel);
    return;
  }
  if (!models || models.length === 0) {
    list.innerHTML = '<div class="empty-state compact-empty">No models found. Is LM Studio running?</div>';
    return;
  }
  const catalogMap = {};
  if (catalog) { catalog.forEach(function(m) { catalogMap[m.id || m.modelId] = m; }); }
  list.innerHTML = models.map(function(model) {
    var entry = catalogMap[model] || {};
    var readiness = entry.readiness || {};
    var isReady = readiness.agentReady === true;
    var badge = isReady ? 'Agent Ready' : 'Not tested';
    var badgeClass = isReady ? 'ok' : 'muted';
    var size = entry.size ? ((entry.size / 1024 / 1024 / 1024).toFixed(1) + 'GB') : '—';
    return '<div class="model-item ' + (model === lmStudioState.selectedModel ? 'selected' : '') + '" data-model="' + model + '" onclick="selectLmModel(\'' + model + '\')">' +
      '<span class="model-name">' + escapeHtml(model) + '</span>' +
      '<span class="model-badge ' + badgeClass + '">' + badge + '</span>' +
      '<span class="model-size">' + size + '</span>' +
      '<button class="control compact" onclick="event.stopPropagation(); selectLmModel(\'' + model + '\')">Select</button>' +
      '</div>';
  }).join('');
}

function selectLmModel(model) {
  lmStudioState.selectedModel = model;
  var select = document.getElementById('lmModel');
  if (select) select.value = model;
  renderLmModelList(lmStudioState.models, catalogState.lm ? catalogState.lm.catalog : null);
  setLmStatus('Selected: ' + model, 'ok');
}

async function enhancedLmDiscover() {
  var url = document.getElementById('lmBaseUrl').value.trim();
  if (!url) { setLmStatus('Please enter a Base URL.', 'error'); return; }
  setLmStatus('Discovering models…', 'busy');
  setBadge('lmProviderBadge', 'Discovering', '');
  lmStudioState.status = 'discovering';
  try {
    var result = await api.providerConfigure({
      providerKind: 'lm-studio',
      lmStudioBaseUrl: url,
      discoverOnly: true,
      persist: false
    });
    if (result && result.error) throw new Error(result.error);
    lmStudioState.models = result.models || [];
    lmStudioState.status = 'ready';
    lmStudioState.error = null;
    if (typeof rememberCatalog === 'function') {
      rememberCatalog('lm', result.models || [], result.modelCatalog || []);
    }
    renderLmModelList(result.models || [], result.modelCatalog || []);
    setLmStatus((result.models ? result.models.length : 0) + ' models found.', 'ok');
    setBadge('lmProviderBadge', (result.models ? result.models.length : 0) + ' models', 'ok');
  } catch (error) {
    lmStudioState.status = 'error';
    lmStudioState.error = error.message;
    setLmStatus('Error: ' + error.message, 'error');
    setBadge('lmProviderBadge', 'Unreachable', 'bad');
  }
}

async function enhancedLmTest() {
  var url = document.getElementById('lmBaseUrl').value.trim();
  var modelSelect = document.getElementById('lmModel');
  var model = modelSelect ? modelSelect.value : null;
  if (!model) model = lmStudioState.selectedModel;
  if (!url) { setLmStatus('Enter a Base URL first.', 'error'); return; }
  if (!model) { setLmStatus('Select a model first.', 'error'); return; }
  setLmStatus('Testing ' + model + '…', 'busy');
  setBadge('lmProviderBadge', 'Testing', '');
  try {
    const requested = { providerKind: 'lm-studio', lmStudioBaseUrl: url, lmStudioModel: model };
    var result = await api.providerConfigure({ ...requested, discoverOnly: true, probeReadiness: true, persist: false });
    if (result && result.error) throw new Error(result.error);
    const observed = await api.providerReadiness();
    projectReadiness('lm', requested.lmStudioModel, observed);
    const ready = requireAgentReady(observed);
    lmStudioState.agentReady = ready.agentReady === true;
    setLmStatus(model + ' is Agent Ready ✅ · ' + readinessSummary(ready) + readinessTimestamp(ready), 'ok');
    setBadge('lmProviderBadge', 'Agent Ready', 'ok');
    renderLmModelList(lmStudioState.models, catalogState.lm ? catalogState.lm.catalog : null);
  } catch (error) {
    setLmStatus('Test failed: ' + error.message, 'error');
    setBadge('lmProviderBadge', 'Not ready', 'bad');
  }
}

async function enhancedLmUse() {
  var url = document.getElementById('lmBaseUrl').value.trim();
  var modelSelect = document.getElementById('lmModel');
  var model = modelSelect ? modelSelect.value : null;
  if (!model) model = lmStudioState.selectedModel;
  if (!url) { setLmStatus('Enter a Base URL first.', 'error'); return; }
  if (!model) { setLmStatus('Select a model first.', 'error'); return; }
  setLmStatus('Testing ' + model + '…', 'busy');
  setBadge('lmProviderBadge', 'Testing', '');
  try {
    const requested = { providerKind: 'lm-studio', lmStudioBaseUrl: url, lmStudioModel: model };
    var result = await api.providerConfigure({ ...requested, discoverOnly: true, probeReadiness: true, persist: false });
    if (result && result.error) throw new Error(result.error);
    const observed=await api.providerReadiness();projectReadiness('lm',requested.lmStudioModel,observed);const ready=requireAgentReady(observed);
    lmStudioState.agentReady = ready.agentReady === true;
    await api.providerConfigure({ ...requested, persist: true });
    await api.savePreferences({ lmStudioBaseUrl: url, lmStudioModel: model });
    setLmStatus(model + ' is Agent Ready ✅ Active', 'ok');
    setBadge('lmProviderBadge', 'Active', 'ok');
    renderLmModelList(lmStudioState.models, catalogState.lm ? catalogState.lm.catalog : null);
  } catch (error) {
    setLmStatus('Error: ' + error.message, 'error');
    setBadge('lmProviderBadge', 'Not ready', 'bad');
  }
}

// ── Enhanced Cline Setup ──
var clineState = { status: 'idle', authenticated: false, email: null, models: [], selectedModel: null, agentReady: false };

function setClineStatus(message, type) {
  var el = document.getElementById('clineAuthStatus');
  if (!el) return;
  el.textContent = message;
  el.className = 'microcopy status-' + (type || 'idle');
}

function renderClineModelList(models, catalog) {
  var list = document.getElementById('clineModelList');
  if (!list) {
    populateModelSelect('clineModel', models, clineState.selectedModel);
    return;
  }
  if (!models || models.length === 0) {
    list.innerHTML = '<div class="empty-state compact-empty">No models found. Sign in and discover models.</div>';
    return;
  }
  var catalogMap = {};
  if (catalog) { catalog.forEach(function(m) { catalogMap[m.id || m.modelId] = m; }); }
  list.innerHTML = models.map(function(model) {
    var entry = catalogMap[model] || {};
    var readiness = entry.readiness || {};
    var isReady = readiness.agentReady === true;
    var badge = isReady ? 'Agent Ready' : 'Not tested';
    var badgeClass = isReady ? 'ok' : 'muted';
    var ctx = entry.contextLength ? ((entry.contextLength / 1024).toFixed(0) + 'k ctx') : '—';
    return '<div class="model-item ' + (model === clineState.selectedModel ? 'selected' : '') + '" data-model="' + model + '" onclick="selectClineModel(\'' + model + '\')">' +
      '<span class="model-name">' + escapeHtml(model) + '</span>' +
      '<span class="model-badge ' + badgeClass + '">' + badge + '</span>' +
      '<span class="model-size">' + ctx + '</span>' +
      '<button class="control compact" onclick="event.stopPropagation(); selectClineModel(\'' + model + '\')">Select</button>' +
      '</div>';
  }).join('');
}

function selectClineModel(model) {
  clineState.selectedModel = model;
  var select = document.getElementById('clineModel');
  if (select) select.value = model;
  renderClineModelList(clineState.models, catalogState.cline ? catalogState.cline.catalog : null);
  setClineStatus('Selected: ' + model, 'ok');
}

async function enhancedClineDiscover() {
  setClineStatus('Discovering models…', 'busy');
  try {
    var result = await api.providerConfigure({
      providerKind: 'cline',
      clineProviderId: 'cline',
      discoverOnly: true,
      persist: false
    });
    if (result && result.error) throw new Error(result.error);
    clineState.models = result.models || [];
    var auth = result.auth || {};
    clineState.authenticated = auth.authenticated === true;
    clineState.email = auth.email || null;
    if (typeof rememberCatalog === 'function') {
      rememberCatalog('cline', result.models || [], result.modelCatalog || []);
    }
    renderClineModelList(result.models || [], result.modelCatalog || []);
    var badge = document.getElementById('clineAuthBadge');
    if (badge) {
      badge.textContent = clineState.authenticated ? 'Signed in' : 'Signed out';
      badge.className = 'badge ' + (clineState.authenticated ? 'ok' : '');
    }
    setClineStatus((result.models ? result.models.length : 0) + ' models found.', 'ok');
  } catch (error) {
    setClineStatus('Error: ' + error.message, 'error');
  }
}

async function enhancedClineTest() {
  var modelSelect = document.getElementById('clineModel');
  var model = modelSelect ? modelSelect.value : null;
  if (!model) model = clineState.selectedModel;
  if (!model) { setClineStatus('Select a model first.', 'error'); return; }
  setClineStatus('Testing ' + model + '…', 'busy');
  try {
    var result = await api.providerConfigure({
      providerKind: 'cline',
      clineProviderId: 'cline',
      clineModel: model,
      discoverOnly: true,
      probeReadiness: true,
      persist: false
    });
    if (result && result.error) throw new Error(result.error);
    const observed=await api.providerReadiness();projectReadiness('cline',model,observed);const ready=requireAgentReady(observed);
    clineState.agentReady = ready.agentReady === true;
    setClineStatus(model + ' is Agent Ready ✅', 'ok');
    renderClineModelList(clineState.models, catalogState.cline ? catalogState.cline.catalog : null);
  } catch (error) {
    setClineStatus('Test failed: ' + error.message, 'error');
  }
}

async function enhancedClineUse() {
  var modelSelect = document.getElementById('clineModel');
  var model = modelSelect ? modelSelect.value : null;
  if (!model) model = clineState.selectedModel;
  if (!model) { setClineStatus('Select a model first.', 'error'); return; }
  setClineStatus('Activating ' + model + '…', 'busy');
  try {
    await api.providerConfigure({
      providerKind: 'cline',
      clineProviderId: 'cline',
      clineModel: model,
      persist: true
    });
    const observed=await api.providerReadiness();projectReadiness('cline',model,observed);requireAgentReady(observed);
    await api.savePreferences({ clineModel: model });
    clineState.selectedModel = model;
    setClineStatus(model + ' is active ✅', 'ok');
    renderClineModelList(clineState.models, catalogState.cline ? catalogState.cline.catalog : null);
  } catch (error) {
    setClineStatus('Error: ' + error.message, 'error');
  }
}


if (typeof window !== 'undefined') {
  window.selectLmModel = selectLmModel;
  window.selectClineModel = selectClineModel;
}
})();
