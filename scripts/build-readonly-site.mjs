import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(repoRoot, '.readonly-site');
const rawRoot = resolve(out, 'raw');

const allowedExtensions = new Set([
  '.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py',
  '.html', '.css', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.sh', '.ps1',
  '.bat', '.rs', '.go', '.java', '.c', '.h', '.cpp', '.hpp', '.xml', '.sql'
]);

const excludedDirectories = new Set([
  '.git', '.vercel', '.readonly-site', 'node_modules', 'release', 'dist', 'build'
]);

const excludedFiles = new Set(['package-lock.json']);
const maxFileBytes = 2 * 1024 * 1024;

function webPath(path) {
  return path.split(sep).join('/');
}

function languageFor(path) {
  const ext = extname(path).toLowerCase();
  return ({
    '.py': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'tsx', '.jsx': 'jsx', '.json': 'json',
    '.md': 'markdown', '.html': 'html', '.css': 'css', '.yml': 'yaml',
    '.yaml': 'yaml', '.sh': 'shell', '.ps1': 'powershell', '.rs': 'rust',
    '.go': 'go', '.sql': 'sql'
  })[ext] || 'text';
}

async function collect(dir, outFiles = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const full = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      await collect(full, outFiles);
      continue;
    }

    if (!entry.isFile() || excludedFiles.has(entry.name)) continue;
    if (!allowedExtensions.has(extname(entry.name).toLowerCase())) continue;

    const info = await stat(full);
    if (info.size > maxFileBytes) continue;
    outFiles.push({ full, size: info.size });
  }
  return outFiles;
}

await rm(out, { recursive: true, force: true });
await mkdir(rawRoot, { recursive: true });

const files = await collect(repoRoot);
const catalog = [];

for (const item of files) {
  const rel = webPath(relative(repoRoot, item.full));
  const destination = resolve(rawRoot, ...rel.split('/'));

  await mkdir(dirname(destination), { recursive: true });
  await copyFile(item.full, destination);

  catalog.push({
    path: rel,
    raw: '/raw/' + rel.split('/').map(encodeURIComponent).join('/'),
    language: languageFor(rel),
    bytes: item.size
  });
}

catalog.sort((a, b) => a.path.localeCompare(b.path));

await writeFile(
  resolve(out, 'catalog.json'),
  JSON.stringify({
    repository: 'Letterblack0306/access-browser-agent',
    mode: 'read-only',
    generated_at: new Date().toISOString(),
    files: catalog
  }, null, 2) + '\n',
  'utf8'
);

const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Access Browser Agent · Read-only Source</title>
<style>
:root{color-scheme:dark;--bg:#0d0f12;--panel:#13161b;--line:#272c35;--muted:#8f98a7;--text:#eef1f5;--accent:#b9c6d8}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{font:14px/1.45 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;background:var(--bg);color:var(--text)}
.shell{height:100%;display:grid;grid-template-columns:minmax(260px,340px) 1fr}
.sidebar{border-right:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;min-height:0}
.brand{padding:16px;border-bottom:1px solid var(--line)}.brand strong{display:block;font-size:15px}.brand span{color:var(--muted);font-size:12px}
.search{padding:12px;border-bottom:1px solid var(--line)}input{width:100%;padding:9px 10px;background:#0b0d10;color:var(--text);border:1px solid var(--line);border-radius:6px;outline:none}
.files{overflow:auto;padding:6px}.file{display:block;width:100%;border:0;background:transparent;color:#cfd5de;text-align:left;padding:7px 8px;border-radius:5px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit}.file:hover,.file.active{background:#20252d;color:#fff}
.main{min-width:0;display:flex;flex-direction:column;min-height:0}.top{min-height:58px;padding:11px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:14px}.path{min-width:0;flex:1}.path strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta{color:var(--muted);font-size:12px}
.raw{color:var(--accent);text-decoration:none;border:1px solid var(--line);border-radius:6px;padding:7px 9px;white-space:nowrap}.raw[aria-disabled="true"]{visibility:hidden}
.viewer{overflow:auto;flex:1}.code{margin:0;padding:16px 0;counter-reset:line;min-width:max-content}.line{display:block;padding:0 18px 0 70px;position:relative;white-space:pre}.line:before{counter-increment:line;content:counter(line);position:absolute;left:0;width:54px;text-align:right;color:#5f6977;user-select:none}.empty{padding:24px;color:var(--muted)}
@media(max-width:760px){.shell{grid-template-columns:1fr}.sidebar{height:40vh;border-right:0;border-bottom:1px solid var(--line)}}
</style>
</head>
<body>
<div class="shell">
  <aside class="sidebar">
    <div class="brand"><strong>Access Browser Agent</strong><span>READ ONLY · source projection</span></div>
    <div class="search"><input id="search" type="search" placeholder="Filter files…" autocomplete="off"></div>
    <div id="files" class="files"></div>
  </aside>
  <main class="main">
    <header class="top">
      <div class="path"><strong id="path">Select a file</strong><span id="meta" class="meta">No browser control, execution, editing, upload, save, or mutation features are exposed.</span></div>
      <a id="raw" class="raw" aria-disabled="true" target="_blank" rel="noopener">Raw text</a>
    </header>
    <div class="viewer"><pre id="code" class="code"><span class="empty">Choose a source file from the left.</span></pre></div>
  </main>
</div>
<script>
const filesEl=document.getElementById('files'),searchEl=document.getElementById('search'),pathEl=document.getElementById('path'),metaEl=document.getElementById('meta'),rawEl=document.getElementById('raw'),codeEl=document.getElementById('code');
let catalog=[],selected='';
function bytes(n){if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KB';return(n/1048576).toFixed(1)+' MB'}
function render(){const q=searchEl.value.trim().toLowerCase();const list=catalog.filter(f=>!q||f.path.toLowerCase().includes(q));filesEl.replaceChildren(...list.map(f=>{const b=document.createElement('button');b.type='button';b.className='file'+(f.path===selected?' active':'');b.textContent=f.path;b.title=f.path;b.onclick=()=>openFile(f);return b}))}
async function openFile(file,push=true){selected=file.path;render();pathEl.textContent=file.path;metaEl.textContent=file.language+' · '+bytes(file.bytes);rawEl.href=file.raw;rawEl.setAttribute('aria-disabled','false');codeEl.textContent='Loading…';try{const r=await fetch(file.raw,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const text=await r.text();const lines=text.replace(/\r\n/g,'\n').split('\n');codeEl.replaceChildren(...lines.map(line=>{const s=document.createElement('span');s.className='line';s.textContent=line||' ';return s}));if(push){const u=new URL(location.href);u.searchParams.set('file',file.path);history.replaceState(null,'',u)}}catch(err){codeEl.textContent='Unable to read '+file.path+': '+err.message}}
searchEl.addEventListener('input',render);
fetch('/catalog.json',{cache:'no-store'}).then(r=>r.json()).then(data=>{catalog=Array.isArray(data.files)?data.files:[];render();const requested=new URL(location.href).searchParams.get('file');const first=catalog.find(f=>f.path===requested)||catalog.find(f=>f.path==='README.md')||catalog[0];if(first)openFile(first,false)}).catch(err=>{filesEl.textContent='Catalog unavailable: '+err.message});
</script>
</body>
</html>`;

await writeFile(resolve(out, 'index.html'), html + '\n', 'utf8');
console.log(`Published ${catalog.length} read-only source files.`);
