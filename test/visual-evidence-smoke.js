'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {BrowserEvidenceStore}=require('../src/browser/observable-browser-runtime');
const OpenAICompatibleProvider=require('../src/llm/OpenAICompatibleProvider');
const {normalizeReadiness}=require('../src/llm/ModelReadinessRegistry');

const png=(marker)=>{const bytes=Buffer.alloc(24);bytes.writeUInt32BE(0x89504e47,0);bytes.writeUInt32BE(0x0d0a1a0a,4);bytes.writeUInt32BE(1,16);bytes.writeUInt32BE(1,20);return Buffer.concat([bytes,Buffer.from(marker)]);};

(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'access-agent-visual-'));
  const store=new BrowserEvidenceStore(root);
  const before=await store.put({screenshotBase64:png('before').toString('base64'),correlation:{targetId:'target-1'}});
  const after=await store.put({screenshotBase64:png('after').toString('base64'),correlation:{targetId:'target-1'}});
  const beforeRef=before.refs.find(ref=>ref.type==='screenshot');
  const resolved=await store.resolveImage(before.artifactId,beforeRef.sha256);
  assert.equal(resolved.mediaType,'image/png');
  assert.deepEqual(await store.compareImages(before.artifactId,before.artifactId),{beforeEvidenceId:before.artifactId,afterEvidenceId:before.artifactId,beforeSha256:beforeRef.sha256,afterSha256:beforeRef.sha256,changed:false,comparison:'byte-identity-with-coarse-frame-region',changedRegions:[],width:1,height:1});
  const comparison=await store.compareImages(before.artifactId,after.artifactId);
  assert.equal(comparison.changed,true);
  assert.deepEqual(comparison.changedRegions,[{x:0,y:0,width:1,height:1}]);
  await assert.rejects(()=>store.resolveImage('unknown'),error=>error.code==='VISUAL_EVIDENCE_NOT_FOUND');

  const provider=new OpenAICompatibleProvider({baseUrl:'http://127.0.0.1:1234/v1',model:'text-model',fetch:async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({choices:[{message:{content:'ok'}}]})})});
  await assert.rejects(()=>provider.complete({messages:[{role:'user',content:[{type:'image',evidenceId:before.artifactId}]}]}),error=>error.code==='VISUAL_INPUT_UNAVAILABLE');
  assert.equal(normalizeReadiness({capabilities:{imageInput:'unknown'}}).capabilities.imageInput,'unknown');
  console.log('visual evidence smoke passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
