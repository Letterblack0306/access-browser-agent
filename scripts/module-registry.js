'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RUNTIME_MODULES } = require('../src/system/module-registry');

const root = path.resolve(__dirname, '..');
const docsPath = path.join(root, 'docs', 'MODULE_REGISTRY.md');
const mode = String(process.argv[2] || 'status').toLowerCase();

function validateRegistry() {
  const issues=[];
  const owners=new Map();
  for (const [modulePath, contract] of Object.entries(RUNTIME_MODULES)) {
    if (!fs.existsSync(path.join(root,modulePath))) issues.push(`${modulePath}: registered file is missing`);
    for (const key of ['owner','behavior','success','failure']) if (!String(contract?.[key]||'').trim()) issues.push(`${modulePath}: missing ${key}`);
    if (owners.has(contract.owner)) issues.push(`${modulePath}: owner ${contract.owner} already used by ${owners.get(contract.owner)}`); else owners.set(contract.owner,modulePath);
    for (const parent of contract.parents || []) if (!RUNTIME_MODULES[parent]) issues.push(`${modulePath}: unregistered parent ${parent}`);
  }
  return issues;
}

function childrenMap(){const map=new Map();for(const key of Object.keys(RUNTIME_MODULES))map.set(key,[]);for(const [child,contract] of Object.entries(RUNTIME_MODULES))for(const parent of contract.parents||[])if(map.has(parent))map.get(parent).push(child);return map;}
function renderDocs(){
  const children=childrenMap();
  const lines=['# Access Agent Runtime Module Registry','', '> Generated from `src/system/module-registry.js` by `npm run module:tree`.','> Ownership/maintenance registry only. It must never become an agent semantic state machine.','', `Registered ownership modules: ${Object.keys(RUNTIME_MODULES).length}.`, '', '## Active execution tree','', '```text'];
  const roots=Object.keys(RUNTIME_MODULES).filter(p=>!(RUNTIME_MODULES[p].parents||[]).length);
  const visit=(modulePath,prefix,trail)=>{const c=RUNTIME_MODULES[modulePath];lines.push(`${prefix}${modulePath} [${c.owner}]`);if(trail.has(modulePath)){lines.push(`${prefix}  ↳ cycle`);return;}const next=new Set(trail);next.add(modulePath);for(const child of children.get(modulePath)||[])visit(child,`${prefix}  └─ `,next);};
  for(const rootModule of roots)visit(rootModule,'',new Set());
  lines.push('```','','## Contracts','');
  for(const [modulePath,c] of Object.entries(RUNTIME_MODULES).sort(([a],[b])=>a.localeCompare(b))){lines.push(`### \`${modulePath}\``,'',`- Owner: \`${c.owner}\``,`- Behavior: ${c.behavior}`,`- Success: ${c.success}`,`- Failure: ${c.failure}`,`- Parents: ${(c.parents||[]).length?(c.parents||[]).map(p=>`\`${p}\``).join(', '):'none'}`,'');}
  lines.push('## Maintenance rule','','Any change that adds, removes, renames, or changes ownership/behavior of an active runtime module must update `RUNTIME_MODULES` and regenerate this document. `npm run module:status` reports drift as a caution; it does not control agent reasoning or approvals.','');
  return lines.join('\n');
}

function docsDrift(){
  if(!fs.existsSync(docsPath))return['docs/MODULE_REGISTRY.md is missing'];
  const text=fs.readFileSync(docsPath,'utf8');
  const cautions=[];
  if(!text.includes(`Registered ownership modules: ${Object.keys(RUNTIME_MODULES).length}.`))cautions.push('registered module count marker is stale');
  for(const modulePath of Object.keys(RUNTIME_MODULES))if(!text.includes(`\`${modulePath}\``)&&!text.includes(`${modulePath} [`))cautions.push(`${modulePath}: missing from generated documentation`);
  return cautions;
}

const issues=validateRegistry();
const cautions=docsDrift();
if(mode==='write'){
  if(issues.length){console.error(issues.map(x=>`MODULE_REGISTRY_ERROR: ${x}`).join('\n'));process.exit(1);}fs.mkdirSync(path.dirname(docsPath),{recursive:true});fs.writeFileSync(docsPath,renderDocs(),'utf8');console.log(`MODULE_REGISTRY_WRITTEN: ${path.relative(root,docsPath)}`);process.exit(0);
}
if(mode==='check'){
  if(issues.length||cautions.length){for(const issue of issues)console.error(`MODULE_REGISTRY_ERROR: ${issue}`);for(const caution of cautions)console.error(`MODULE_REGISTRY_ERROR: ${caution}`);process.exit(1);}console.log(`module-registry: PASS (${Object.keys(RUNTIME_MODULES).length} modules)`);process.exit(0);
}
for(const issue of issues)console.warn(`MODULE_REGISTRY_CAUTION: ${issue}`);
for(const caution of cautions)console.warn(`MODULE_REGISTRY_CAUTION: ${caution}`);
console.log(`module-registry-status: ${issues.length||cautions.length?'CAUTION':'OK'} (${Object.keys(RUNTIME_MODULES).length} modules)`);
