'use strict';

(function attachRebuildRuntimeState(root) {
  const stamp = () => new Date().toISOString();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function create() {
    return {
      updatedAt:stamp(),
      revision:0,
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

  const RECONCILABLE_OPERATION_STATES=new Set(['idle','reconciled','state_unavailable']);
  function reconcileOperationFromSnapshot(previous,next,relay,delivery){
    const backendId=delivery.instructionId||null;
    const currentState=previous.operation.state;
    if(backendId&&RECONCILABLE_OPERATION_STATES.has(currentState)&&backendId!==previous.operation.instructionId){
      next.operation={state:relay.running===true?'executing':'result_queued',instructionId:backendId,operationId:previous.operation.operationId,detail:'Reconciled from runtime snapshot.'};
      return next;
    }
    const unidentifiedActivity=!backendId&&(relay.pendingResult===true||(delivery.state&&delivery.state!=='idle'));
    if(unidentifiedActivity&&currentState==='idle'){
      next.operation={state:'state_unavailable',instructionId:null,operationId:null,detail:'Runtime reports an unresolved browser operation; the renderer cannot reconstruct its instruction identity.'};
      return problem(next,'operation','Browser operation state unavailable after projection reset; explicit reconciliation required.','OPERATION_STATE_UNAVAILABLE');
    }
    return next;
  }

  function fromSnapshot(previous, snapshot = {}, meta = {}) {
    const incomingRevision=Number(meta&&meta.revision);
    if(Number.isFinite(incomingRevision)&&incomingRevision<previous.revision)return previous;
    let next={...previous,updatedAt:stamp(),revision:previous.revision+1};
    const agent=snapshot.agent||{},provider=snapshot.provider||{},relay=snapshot.browserRelay||{},delivery=relay.delivery||{};
    next.workspace={state:snapshot.workspaceRoot?'connected':'missing',root:snapshot.workspaceRoot||null,detail:snapshot.bridge?.error||null};
    next.runtime={state:snapshot.runtimeControl?.active===true?(agent.running?'running':'ready'):'stopped',active:snapshot.runtimeControl?.active===true,detail:agent.error||snapshot.bridge?.error||null};
    next.provider=providerProjection(provider);
    next.agentSession={state:String(agent.status||(agent.running?'running':'idle')),running:agent.running===true,turnId:agent.turnId||null,sessionId:agent.sessionId||null,detail:agent.error||agent.waiting||null};
    next.loop={state:String(relay.lifecycle||(relay.running?'waiting_for_instruction':'stopped')),running:relay.running===true,detail:relay.error||null};
    next.browserTarget={state:relay.target?(relay.running?'attached':'selected'):'unselected',target:clone(relay.target||null),targets:previous.browserTarget?.targets||[]};
    next.browserDelivery={state:String(delivery.state||(relay.pendingResult?'queued':'idle')),instructionId:delivery.instructionId||null,attempts:Number(delivery.attempts||0),maxAttempts:Number(delivery.maxAttempts||0),detail:delivery.error?.message||null,evidenceLevel:delivery.evidenceLevel||null};
    next=reconcileOperationFromSnapshot(previous,next,relay,delivery);
    if(next.runtime.detail)return problem(next,'runtime',next.runtime.detail);
    if(next.loop.detail&&['degraded','delivery_failed','delivery_unverified','unavailable'].includes(next.loop.state))return problem(next,'loop',next.loop.detail);
    if(next.browserDelivery.state==='submitted_unverified')return problem(next,'delivery',next.browserDelivery.detail||'Result submission was accepted but rendered delivery is not verified.','RENDERED_DELIVERY_UNVERIFIED');
    return next;
  }

  function withTargets(previous, targets) { return {...previous,updatedAt:stamp(),revision:previous.revision+1,browserTarget:{...previous.browserTarget,targets:Array.isArray(targets)?targets.map(clone):[]}}; }

  function withTerminal(previous, terminal = {}) {
    return {...previous,updatedAt:stamp(),revision:previous.revision+1,terminal:{state:terminal.ok===false?'unavailable':terminal.terminalId?'open':'closed',id:terminal.terminalId||null,fallback:terminal.fallback===true,mode:terminal.mode||null,detail:terminal.error||(terminal.fallback?'Native PTY unavailable; process fallback active.':null)}};
  }

  const CORRELATED_OPERATION_PHASES=new Set(['browser_relay.result_queued','browser_relay.result_sent','browser_relay.delivery_unverified','browser_relay.delivery_failed']);
  const OPERATION_TERMINAL_STATES=new Set(['rendered_delivered','delivery_failed','reconciled']);
  const OPERATION_TRANSITIONS={
    'browser_relay.result_queued':['idle','executing'],
    'browser_relay.result_sent':['idle','executing','result_queued','delivery_unverified'],
    'browser_relay.delivery_unverified':['idle','executing','result_queued'],
    'browser_relay.delivery_failed':['idle','executing','result_queued','delivery_unverified'],
  };
  function isOperationEventCorrelated(previous, event = {}) {
    if(!CORRELATED_OPERATION_PHASES.has(String(event.phase||'')))return true;
    const eventId=event.instructionId||null;
    if(!eventId)return false;
    const currentId=previous.operation.instructionId;
    return !currentId||eventId===currentId;
  }
  function isOperationTransitionAllowed(previous, phase = '') {
    const allowedFrom=OPERATION_TRANSITIONS[String(phase||'')];
    if(!allowedFrom)return true;
    if(OPERATION_TERMINAL_STATES.has(previous.operation.state))return false;
    return allowedFrom.includes(previous.operation.state);
  }

  function withEvent(previous, event = {}) {
    let next={...previous,updatedAt:stamp(),revision:previous.revision+1,events:[{...clone(event),at:event.timestamp||stamp()},...previous.events].slice(0,200)};
    const phase=String(event.phase||'');
    if(!isOperationEventCorrelated(previous,event))return next;
    if(!isOperationTransitionAllowed(previous,phase))return next;
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

  function clearProblems(previous) { return {...previous,updatedAt:stamp(),revision:previous.revision+1,problems:[]}; }

  // ---- Single-writer projection boundary ---------------------------------
  // All authoritative projection mutations must enter through apply().
  // Reducers above remain internal transition logic; callers never invoke
  // them directly for state ownership.
  const MUTATION_KINDS=new Set(['snapshot','event','targets','terminal','clear_problems']);
  function rejectMutation(previous, mutation) {
    const record={phase:'projection.mutation_rejected',status:'rejected',kind:String((mutation&&mutation.kind)||null),detail:'Projection mutation rejected: unknown or malformed mutation at the single-writer boundary.',at:stamp()};
    return {...previous,updatedAt:stamp(),revision:previous.revision+1,events:[record,...previous.events].slice(0,200)};
  }
  function apply(previous, mutation = {}) {
    if(!mutation||typeof mutation!=='object'||!MUTATION_KINDS.has(mutation.kind))return rejectMutation(previous,mutation);
    switch(mutation.kind){
      case 'snapshot':
        if(!mutation.snapshot||typeof mutation.snapshot!=='object'||Array.isArray(mutation.snapshot))return rejectMutation(previous,mutation);
        return fromSnapshot(previous,mutation.snapshot,mutation.meta||{});
      case 'event':{
        const event=mutation.event;
        if(!event||typeof event!=='object'||Array.isArray(event))return rejectMutation(previous,mutation);
        // Local UI lifecycle notifications carry origin:'renderer-local'; they are
        // observability-only provenance tags and still pass the exact same
        // correlation gate, terminal guards, and revision rules as backend events.
        const origin=typeof event.origin==='string'?event.origin:'backend';
        return withEvent(previous,{...event,origin});
      }
      case 'targets':
        if(!Array.isArray(mutation.targets))return rejectMutation(previous,mutation);
        return withTargets(previous,mutation.targets);
      case 'terminal':
        if(mutation.terminal!==undefined&&(typeof mutation.terminal!=='object'||Array.isArray(mutation.terminal)))return rejectMutation(previous,mutation);
        return withTerminal(previous,mutation.terminal||{});
      case 'clear_problems':
        return clearProblems(previous);
      default:
        return rejectMutation(previous,mutation);
    }
  }

  const api=Object.freeze({create,fromSnapshot,providerProjection,withTargets,withTerminal,withEvent,clearProblems,apply});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RebuildRuntimeState=api;
})(typeof window!=='undefined'?window:globalThis);
