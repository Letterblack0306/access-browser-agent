'use strict';

(() => {
  const api=window.accessIde;
  const $=id=>document.getElementById(id);
  const normalized=value=>String(value||'').trim();
  const positiveInteger=value=>{const number=Number(value);return Number.isInteger(number)&&number>0?number:null;};
  const setText=(id,value)=>{const node=$(id);if(node)node.textContent=String(value??'');};
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
    if($('lmBaseUrl'))$('lmBaseUrl').value=prefs.lmStudioBaseUrl||'http://127.0.0.1:1234/v1';
    replaceOptions($('lmModel'),[],prefs.lmStudioModel||'');replaceOptions($('clineModel'),[],prefs.clineModel||'');
    if($('browserProfilePath'))$('browserProfilePath').value=prefs.browserProfilePath||'';
    if($('browserExecutable'))$('browserExecutable').value=prefs.browserExecutable||'';
    if($('chatUrl')&&!$('chatUrl').value)$('chatUrl').value=prefs.browserChatUrl||'';
    ensureAdvancedSettings(prefs);

    $('clineLogin')?.addEventListener('click',async()=>{setBusy('clineLogin',true);try{await clineDiscover({clineLogin:true});}catch(error){setText('clineAuthStatus',error.message);setBadge('clineAuthBadge','Failed','bad');}finally{setBusy('clineLogin',false);}});
    $('clineLogout')?.addEventListener('click',async()=>{setBusy('clineLogout',true);try{await clineDiscover({clineLogout:true});setBadge('clineAuthBadge','Signed out');}catch(error){setText('clineAuthStatus',error.message);}finally{setBusy('clineLogout',false);}});
    $('clineRefreshModels')?.addEventListener('click',async()=>{setBusy('clineRefreshModels',true);try{await clineDiscover();}catch(error){setText('clineAuthStatus',error.message);}finally{setBusy('clineRefreshModels',false);}});
    $('clineTest')?.addEventListener('click',async()=>{setBusy('clineTest',true);try{const model=normalized($('clineModel')?.value);if(!model)throw new Error('Select a Cline model first.');await api.providerConfigure({providerKind:'cline',clineProviderId:'cline',clineModel:model,persist:false});const observed=await api.providerReadiness();projectReadiness('cline',model,observed);const ready=requireAgentReady(observed);setText('clineAuthStatus',`${model} · agent-ready · ${readinessSummary(ready)}${readinessTimestamp(ready)}`);setBadge('clineAuthBadge','Agent ready','ok');}catch(error){setText('clineAuthStatus',error.message);setBadge('clineAuthBadge','Not ready','bad');}finally{setBusy('clineTest',false);}});
    $('clineUse')?.addEventListener('click',async()=>{setBusy('clineUse',true);try{const model=normalized($('clineModel')?.value);if(!model)throw new Error('Select a Cline model first.');const requested={providerKind:'cline',clineProviderId:'cline',clineModel:model};await api.providerConfigure({...requested,persist:false});const observed=await api.providerReadiness();projectReadiness('cline',model,observed);const ready=requireAgentReady(observed);const persisted=await api.savePreferences(requested);if(persisted.providerKind!=='cline'||persisted.clineModel!==model)throw new Error('Cline preference verification failed.');setText('clineAuthStatus',`${model} · active agent provider · ${readinessSummary(ready)}${readinessTimestamp(ready)}`);setBadge('clineAuthBadge','Active','ok');}catch(error){setText('clineAuthStatus',error.message);setBadge('clineAuthBadge','Not ready','bad');}finally{setBusy('clineUse',false);}});
    $('lmDiscover')?.addEventListener('click',async()=>{setBusy('lmDiscover',true);try{await lmDiscover();}catch(error){setText('lmStatus',error.message);}finally{setBusy('lmDiscover',false);}});
    $('lmUse')?.addEventListener('click',async()=>{setBusy('lmUse',true);try{const requested=lmFields();if(!requested.lmStudioBaseUrl||!requested.lmStudioModel)throw new Error('Choose an LM Studio URL and model.');await api.providerConfigure({...requested,persist:false});const observed=await api.providerReadiness();projectReadiness('lm',requested.lmStudioModel,observed);const ready=requireAgentReady(observed);const persisted=await api.savePreferences(requested);for(const key of ['providerKind','lmStudioBaseUrl','lmStudioModel','lmStudioEndpointPolicy'])if(normalized(persisted?.[key])!==normalized(requested[key]))throw new Error(`LM Studio preference verification failed for ${key}.`);setText('lmStatus',`${requested.lmStudioModel} · active agent provider · ${readinessSummary(ready)}${readinessTimestamp(ready)}`);}catch(error){setText('lmStatus',error.message);}finally{setBusy('lmUse',false);}});
    $('chooseChromeProfile')?.addEventListener('click',async()=>{try{const result=await api.selectChromeProfile($('browserProfilePath')?.value||'');if(!result?.canceled&&$('browserProfilePath'))$('browserProfilePath').value=result.path||'';}catch(error){setText('browserSettingsStatus',error.message);}});
    $('saveBrowserDefaults')?.addEventListener('click',async()=>{setBusy('saveBrowserDefaults',true);try{const requested={browserMode:'managed',browserProfilePath:normalized($('browserProfilePath')?.value),browserExecutable:normalized($('browserExecutable')?.value),browserCdpPort:null};const saved=await api.savePreferences(requested);setText('browserSettingsStatus',saved.browserProfilePath?'Custom managed-Chrome profile override saved.':'Saved. Access-owned managed-Chrome profile and dynamic CDP port will be used automatically.');}catch(error){setText('browserSettingsStatus',error.message);}finally{setBusy('saveBrowserDefaults',false);}});
    $('saveIntegrationSettings')?.addEventListener('click',async()=>{setBusy('saveIntegrationSettings',true);try{const requested={mcpServerCommand:normalized($('mcpServerCommand')?.value)};const saved=await api.savePreferences(requested);if(normalized(saved.mcpServerCommand)!==requested.mcpServerCommand)throw new Error('MCP command persistence verification failed.');setText('mcpDetail','Integration settings saved.');}catch(error){setText('mcpDetail',error.message);}finally{setBusy('saveIntegrationSettings',false);}});

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
    setText('lmStatus',prefs.lmStudioModel?`${prefs.lmStudioModel} saved · click Discover/Use to verify`:'Not checked');
    setText('browserSettingsStatus',prefs.browserProfilePath?'Custom managed-Chrome profile override loaded.':'Access-owned managed-Chrome profile and dynamic CDP port will be used automatically.');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(console.error),{once:true});else init().catch(console.error);
})();
