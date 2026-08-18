'use strict';

const assert=require('node:assert/strict');
const {ProviderChannel,PROVIDERS,providerForUrl,normalizedChatIdentity,sameChatIdentity}=require('../src/browser/provider-channel');

(async()=>{
  assert.equal(providerForUrl('https://chatgpt.com/c/abc'),'chatgpt');
  assert.equal(providerForUrl('https://www.chatgpt.com/c/abc'),'chatgpt');
  assert.equal(providerForUrl('https://example.com/chat'),null,'arbitrary HTTP pages must not become providers');
  assert.ok(PROVIDERS.chatgpt.assistant.includes('[data-message-author-role="assistant"]'));
  assert.ok(!PROVIDERS.chatgpt.assistant.includes('body'),'turn capture must never use whole-page body');
  assert.equal(normalizedChatIdentity('https://chatgpt.com/c/abc?model=x#top'),'https://chatgpt.com/c/abc');
  assert.equal(sameChatIdentity('https://chatgpt.com/c/abc?x=1','https://chatgpt.com/c/abc#x'),true);
  assert.equal(sameChatIdentity('https://chatgpt.com/c/abc','https://chatgpt.com/c/xyz'),false);

  const calls=[];
  const factory=async endpoint=>({
    Target:{createTarget:async({url})=>{calls.push(['create',url]);return{targetId:'target-1'};},closeTarget:async({targetId})=>{calls.push(['close-target',targetId]);return{success:true};}},
    close:async()=>calls.push(['close',endpoint]),
  });
  factory.List=async()=>[
    {id:'chat',type:'page',url:'https://chatgpt.com/c/abc',title:'Chat'},
    {id:'random',type:'page',url:'https://example.com/',title:'Random'},
    {id:'settings',type:'page',url:'chrome://settings/',title:'Settings'},
  ];
  const channel=new ProviderChannel({cdpFactory:factory});
  const opened=await channel.openTab('http://127.0.0.1:7330','https://chatgpt.com/c/abc');
  assert.equal(opened.targetId,'target-1');
  assert.equal(opened.providerId,'chatgpt');
  assert.equal(opened.provider,'ChatGPT');
  assert.equal(channel.expectedUrlFor('target-1'),'https://chatgpt.com/c/abc');
  assert.ok(channel.targetProvenance('target-1')?.selectedAt);
  await assert.rejects(()=>channel.openTab('http://127.0.0.1:7330','https://example.com/chat'),error=>error.code==='UNSUPPORTED_CHAT_PROVIDER');
  await channel.closeTarget('http://127.0.0.1:7330','owned-bootstrap');
  assert.ok(calls.some(call=>call[0]==='close-target'&&call[1]==='owned-bootstrap'));
  await assert.rejects(()=>channel.closeTarget('http://127.0.0.1:7330',''),/exact browser target ID/u);

  const tabs=await channel.listTabs('http://127.0.0.1:7330');
  assert.equal(tabs[0].providerId,'chatgpt');
  assert.equal(tabs[0].supported,true);
  assert.equal(tabs[1].providerId,null);
  assert.equal(tabs[1].supported,false);
  assert.equal(tabs[2].providerId,null);

  let snapshotExpression='';
  const snapshotFactory=async()=>({
    Runtime:{
      enable:async()=>{},
      evaluate:async({expression})=>{
        snapshotExpression=String(expression||'');
        return{result:{value:{text:'',generating:false,url:'https://chatgpt.com/c/abc',title:'Empty conversation',readyState:'complete',provenance:{authorRole:'assistant',selectorFamily:['[data-message-author-role="assistant"]'],messageIndex:-1,messageId:'',verifiedAssistant:true,messagePresent:false}}}};
      },
    },
    close:async()=>{},
  });
  snapshotFactory.List=async()=>[];
  const snapshotChannel=new ProviderChannel({cdpFactory:snapshotFactory});
  snapshotChannel.targetUrls.set('empty','https://chatgpt.com/c/abc');
  const snapshot=await snapshotChannel.snapshot('http://127.0.0.1:7330','empty','chatgpt');
  assert.match(snapshotExpression,/const visible=e=>\{[^]*?return s\.display!==[^]*?\};const stop=/u,'snapshot probe must close visible() before executing snapshot logic');
  assert.match(snapshotExpression,/data-message-id/u,'snapshot must attempt provider message identity before falling back to message index');
  assert.equal(snapshot.provenance.verifiedAssistant,true,'trusted selector provenance is valid even when no assistant message exists yet');
  assert.equal(snapshot.provenance.messagePresent,false);
  assert.equal(snapshot.text,'');

  let conversationExpression='';
  const conversationFactory=async()=>({
    Runtime:{
      enable:async()=>{},
      evaluate:async({expression})=>{
        conversationExpression=String(expression||'');
        return{result:{value:{url:'https://chatgpt.com/c/abc',title:'Conversation',readyState:'complete',messages:[{role:'user',text:'Earlier context',messageIndex:1,messageId:'u-1'},{role:'assistant',text:'Current task',messageIndex:2,messageId:'a-2'}]}}};
      },
    },
    close:async()=>{},
  });
  conversationFactory.List=async()=>[];
  const conversationChannel=new ProviderChannel({cdpFactory:conversationFactory});
  conversationChannel.targetUrls.set('chat','https://chatgpt.com/c/abc');
  const conversation=await conversationChannel.readConversation('http://127.0.0.1:7330','chat','chatgpt',{limit:8});
  assert.equal(conversation.ok,true);
  assert.equal(conversation.messages.length,2);
  assert.equal(conversation.messages[1].role,'assistant');
  assert.equal(conversation.messages[1].messageId,'a-2');
  assert.match(conversationExpression,/data-message-author-role/u);
  assert.doesNotMatch(conversationExpression,/eval\(/u,'conversation reader must use a fixed DOM extraction expression rather than model-supplied JavaScript');

  const mismatchFactory=async()=>({Runtime:{enable:async()=>{},evaluate:async()=>({result:{value:{text:'x',url:'https://example.com/',provenance:{verifiedAssistant:true}}}})},close:async()=>{}});
  mismatchFactory.List=async()=>[];
  await assert.rejects(
    ()=>new ProviderChannel({cdpFactory:mismatchFactory}).snapshot('http://127.0.0.1:7330','x','chatgpt'),
    error=>error.code==='TARGET_PROVIDER_MISMATCH'&&error.details?.expectedProviderId==='chatgpt'&&error.details?.observedProviderId===null,
  );

  console.log('Provider channel smoke PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});