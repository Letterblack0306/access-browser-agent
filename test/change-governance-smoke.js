'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ChangeGovernanceGuard,isGovernanceDocument}=require('../src/agent/guards/ChangeGovernanceGuard');

function intent(id,status='in_progress',targets=['src/a.js'],post='Pending implementation.',validation='Pending implementation.'){
  return `# Change Intent\n\n## Change ID\n\n\`${id}\`\n\n## Status\n\n\`${status}\`\n\n## Requested outcome\n\nChange declared files.\n\n## Target files\n\n${targets.map(item=>`- \`${item}\``).join('\n')}\n\n## Intent\n\nMake a declared change.\n\n## Planned changes\n\n- Update only declared targets.\n\n## Why\n\nPrevent undocumented mutation.\n\n## Post-change update\n\n${post}\n\n## Validation evidence\n\n${validation}\n`;
}
function index(rows){return `# Workspace Change Index\n\n| Change ID | Status | Requested outcome | Intent document |\n| --- | --- | --- | --- |\n${rows.map(row=>`| \`${row.id}\` | \`${row.status}\` | Change declared files. | \`docs/change-intents/${row.id}.md\` |`).join('\n')}\n`;}

const bootstrapRoot=fs.mkdtempSync(path.join(os.tmpdir(),'access-change-bootstrap-'));
const bootstrap=new ChangeGovernanceGuard({workspaceRoot:bootstrapRoot});
assert.equal(isGovernanceDocument('docs/CHANGE_INDEX.md'),true);
assert.equal(isGovernanceDocument('docs/change-intents/change-2.md'),true);
assert.equal(isGovernanceDocument('src/a.js'),false);
assert.doesNotThrow(()=>bootstrap.assertMutation({toolName:'createFile',args:{path:'docs/change-intents/change-2.md'}}),'governance documents must remain bootstrappable before an active index exists');
assert.throws(()=>bootstrap.assertMutation({toolName:'createFile',args:{path:'src/a.js'}}),error=>error.code==='CHANGE_INDEX_MISSING');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'access-change-governance-'));
fs.mkdirSync(path.join(root,'docs','change-intents'),{recursive:true});
fs.writeFileSync(path.join(root,'docs','CHANGE_INDEX.md'),index([{id:'change-1',status:'in_progress'}]),'utf8');
fs.writeFileSync(path.join(root,'docs','change-intents','change-1.md'),intent('change-1'),'utf8');
const guard=new ChangeGovernanceGuard({workspaceRoot:root});
assert.equal(guard.validateRepository().ok,true);
assert.doesNotThrow(()=>guard.assertMutation({toolName:'writeFile',args:{path:'src/a.js'}}));
assert.throws(()=>guard.assertMutation({toolName:'writeFile',args:{path:'src/b.js'}}),error=>error.code==='TARGET_NOT_DECLARED');
assert.doesNotThrow(()=>guard.assertMutation({toolName:'runCommand',args:{command:'npm run check'}}));

fs.writeFileSync(path.join(root,'docs','change-intents','change-2.md'),intent('change-2','in_progress',['src/b.js']),'utf8');
fs.writeFileSync(path.join(root,'docs','CHANGE_INDEX.md'),index([{id:'change-1',status:'in_progress'},{id:'change-2',status:'in_progress'}]),'utf8');
const parallel=guard.validateRepository();
assert.equal(parallel.ok,true);
assert.equal(parallel.active.length,2,'parallel governed changes must be supported like the GPT-Knowledge reference');
assert.doesNotThrow(()=>guard.assertMutation({toolName:'writeFile',args:{path:'src/a.js'}}),'file target should resolve its owning active change');
assert.doesNotThrow(()=>guard.assertMutation({toolName:'writeFile',args:{path:'src/b.js'}}));
assert.throws(()=>guard.assertMutation({toolName:'runCommand',args:{command:'npm run check'}}),error=>error.code==='ACTIVE_CHANGE_AMBIGUOUS');
assert.doesNotThrow(()=>guard.assertMutation({toolName:'runCommand',args:{command:'npm run check',changeId:'change-2'}}),'explicit changeId must disambiguate governed command ownership');

fs.writeFileSync(path.join(root,'docs','CHANGE_INDEX.md'),index([{id:'change-1',status:'completed'},{id:'change-2',status:'in_progress'}]),'utf8');
fs.writeFileSync(path.join(root,'docs','change-intents','change-1.md'),intent('change-1','completed',['src/a.js']),'utf8');
assert.equal(guard.validateRepository().ok,false,'completed change must not retain pending post-change evidence');
assert.throws(()=>guard.assertMutation({toolName:'writeFile',args:{path:'src/b.js'}}),error=>error.code==='POST_CHANGE_UPDATE_PENDING');
console.log('change-governance-smoke: PASS');
