'use strict';

(function attachRebuildRuntimeState(root) {
  const stamp = () => new Date().toISOString();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function create() {
    return {
      updatedAt:stamp(),
      workspace:{state:'unknown',root:null,detail:null},
      runtime:{state:'starting',active:false,detail:null},
      provider:{state:'unknown',detail:null,agentReady:false,capabilities:null,checkedAt:null},
      agentSession:{state:'idle',running:false,turnId:null,sessionId:null,detail:null},
      operation:{state:'idle',instructionId:null,operationId:null,detail:null},
      loop:{state:'stopped',running:false,detail:null},
      browserTarget:{state:'unselected',target:null,targets:[]},
      browserDelivery:{state:'idle',instructionId:null,attempts:0,maxAttempts:0,detail:null,evidenceLevel:null},
      terminal:{state:'closed',id:null,fallback:false,mode:null,detail:null},
      validation:{state:'unknown',detail:null},
      problems:[],events:[],
    };
  }

 function problem(state, source, message, code = null, data = null) {
    const text=String(message||'').trim();if(!text)return state;
    const next={...state,problems:[...state.problems]};const key=`${source}:${code||''}:${text}`;
    if(!next.problems.some(item=>item.key===key)){next.problems.unshift({key,source,code,message:text,at:stamp(),data:data?clone(data):null});next.problems=next.problems.slice(0,50);}
    return next;
  }

  function providerProjection(provider = {}) {
    const readiness=provider.agentReadiness||{};
    const reachable=provider.healthy===true||provider.reachable===true;
    let state='unavailable';
    if(provider.configured===false) state='unconfigured';
    else if(provider.agentReady===true&&readiness.status==='agent_ready') state='agent_ready';
    else if(reachable&&readiness.status==='capability_failed') state='capability_failed';
    else if(reachable) state='reachable_unverified';
    const failures=readiness.failureReasons||{};
    const capabilityDetail=failures.toolCalling||failures.completion||failures.structuredOutput||null;
    const detail=state==='agent_ready'
      ? `Agent capability verified${readiness.checkedAt?` at ${readiness.checkedAt}`:''}.`
      : state==='reachable_unverified'
        ? 'Provider is reachable, but agent tool capability has not been verified.'
        : state==='capability_failed'
          ? capabilityDetail||'Provider is reachable, but the selected model failed the agent capability probe.'
          : provider.error||provider.failureReason||null;
    return {
      state,
      detail,
      agentReady:provider.agentReady===true,
      capabilities:clone(readiness.capabilities||null),
      checkedAt:readiness.checkedAt||null,
    };
  }

  function fromSnapshot(previous, snapshot = {}) {
    const next={...previous,updatedAt:stamp()};
    const agent=snapshot.agent||{},provider=snapshot.provider||{},relay=snapshot.browserRelay||{},delivery=relay.delivery||{};
    next.workspace={state:snapshot.workspaceRoot?'connected':'missing',root:snapshot.workspaceRoot||null,detail:snapshot.bridge?.error||null};
    next.runtime={state:snapshot.runtimeControl?.active===true?(agent.running?'running':'ready'):'stopped',active:snapshot.runtimeControl?.active===true,detail:agent.error||snapshot.bridge?.error||null};
    next.provider=providerProjection(provider);
    next.agentSession={state:String(agent.status||(agent.running?'running':'idle')),running:agent.running===true,turnId:agent.turnId||null,sessionId:agent.sessionId||null,detail:agent.error||agent.waiting||null};
    next.loop={state:String(relay.lifecycle||(relay.running?'waiting_for_instruction':'stopped')),running:relay.running===true,detail:relay.error||null};
    next.browserTarget={state:relay.target?(relay.running?'attached':'selected'):'unselected',target:clone(relay.target||null),targets:previous.browserTarget?.targets||[]};
    next.browserDelivery={state:String(delivery.state||(relay.pendingResult?'queued':'idle')),instructionId:delivery.instructionId||null,attempts:Number(delivery.attempts||0),maxAttempts:Number(delivery.maxAttempts||0),detail:delivery.error?.message||null,evidenceLevel:delivery.evidenceLevel||null};
    if(next.runtime.detail)return problem(next,'runtime',next.runtime.detail);
    if(next.loop.detail&&['degraded','delivery_failed','delivery_unverified','unavailable'].includes(next.loop.state))return problem(next,'loop',next.loop.detail);
    if(next.browserDelivery.state==='submitted_unverified')return problem(next,'delivery',next.browserDelivery.detail||'Result submission was accepted but rendered delivery is not verified.','RENDERED_DELIVERY_UNVERIFIED');
    return next;
  }

  function withTargets(previous, targets) { return {...previous,updatedAt:stamp(),browserTarget:{...previous.browserTarget,targets:Array.isArray(targets)?targets.map(clone):[]}}; }

  function withTerminal(previous, terminal = {}) {
    return {...previous,updatedAt:stamp(),terminal:{state:terminal.ok===false?'unavailable':terminal.terminalId?'open':'closed',id:terminal.terminalId||null,fallback:terminal.fallback===true,mode:terminal.mode||null,detail:terminal.error||(terminal.fallback?'Native PTY unavailable; process fallback active.':null)}};
  }

  function withEvent(previous, event = {}) {
    let next={...previous,updatedAt:stamp(),events:[{...clone(event),at:event.timestamp||stamp()},...previous.events].slice(0,200)};
    const phase=String(event.phase||'');
    if(phase==='browser_relay.instruction_received') {
      next.operation={state:'executing',instructionId:event.instructionId||null,operationId:event.operationId||event.correlation?.operationId||null,detail:event.detail||null};
    } else if(phase==='browser_relay.result_queued') {
      next.operation={...next.operation,state:'result_queued',instructionId:event.instructionId||next.operation.instructionId};
    } else if(phase==='browser_relay.result_sent') {
      next.operation={...next.operation,state:'rendered_delivered',instructionId:event.instructionId||next.operation.instructionId,detail:'Rendered browser delivery verified.'};
    } else if(phase==='browser_relay.delivery_unverified') {
      next.operation={...next.operation,state:'delivery_unverified',instructionId:event.instructionId||next.operation.instructionId,detail:event.detail||'Submission accepted, rendered delivery unverified.'};
      next.browserDelivery={...next.browserDelivery,state:'submitted_unverified',instructionId:event.instructionId||next.browserDelivery.instructionId,detail:event.detail||null,evidenceLevel:event.delivery?.evidenceLevel||'SUBMISSION_ACCEPTED'};
      next=problem(next,'delivery',event.detail||'Submission was accepted but rendered delivery could not be verified.',event.code||'RENDERED_DELIVERY_UNVERIFIED');
    } else if(phase==='browser_relay.delivery_failed') {
      next.operation={...next.operation,state:'delivery_failed',instructionId:event.instructionId||next.operation.instructionId,detail:event.detail||null};
      next=problem(next,'delivery',event.detail||'Browser result delivery failed.',event.code||null);
} else if(phase==='browser_relay.instruction_recovery_required') {
next.operation={...next.operation,state:'recovery_required',instructionId:event.instructionId||next.operation.instructionId,detail:event.detail||null};
next=problem(next,'recovery',event.detail||'Durable browser instruction recovery requires explicit reconciliation.',event.code||'INSTRUCTION_RECOVERY_REQUIRED',{
journalKey:event.journalKey||null,
journalState:event.journalState||null,
instructionId:event.instructionId||null,
targetId:event.targetId||null,
providerId:event.providerId||null,
recovery:event.recovery||null,
});
} else if(phase==='browser_relay.recovery_reconciled') {
next.operation={...next.operation,state:'reconciled',instructionId:event.instructionId||next.operation.instructionId,detail:event.detail||'Durable recovery reconciled.'};
next={...next,problems:next.problems.filter(item=>item.data?.journalKey!==event.journalKey)};
    } else if(phase==='browser_relay.failed'||String(event.status)==='failed') {
      next=problem(next,'loop',event.detail||phase||'Loop failure.',event.code||null);
    }
    return next;
  }

  function clearProblems(previous) { return {...previous,updatedAt:stamp(),problems:[]}; }

  const api=Object.freeze({create,fromSnapshot,providerProjection,withTargets,withTerminal,withEvent,clearProblems});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RebuildRuntimeState=api;
})(typeof window!=='undefined'?window:globalThis);
