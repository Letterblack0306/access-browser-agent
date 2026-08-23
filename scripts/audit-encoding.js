'use strict';

const fs = require('fs');
const path = require('path');

const MOJIBAKE_REGEX = /[\uFFFD]|[\u00C0-\u00FF][\u0080-\u00BF]+|ΓåÆ|Γâ|âš|ï¸|â”|â€/;
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', '.pytest_cache',
  'AppData', 'Downloads', '.vscode', '.idea'
]);

function scan(dir, results = [], depth = 0) {
  if (depth > 20) return results;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(fullPath, results, depth + 1);
    } else if (entry.isFile() && /\.(js|cjs|mjs|ts|json|md|ps1|txt|log|yml|yaml)$/i.test(entry.name)) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 2_000_000) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (MOJIBAKE_REGEX.test(line)) {
            results.push({ file: fullPath, line: index + 1, snippet: line.trim().slice(0, 120) });
          }
        });
      } catch {}
    }
  }
  return results;
}

const targets = process.argv.slice(2);
const roots = targets.length ? targets : [process.cwd()];
const allResults = [];

for (const root of roots) {
  if (fs.existsSync(root)) {
    console.log(`Scanning target: ${root}`);
    const matches = scan(root);
    allResults.push(...matches);
  }
}

console.log(`\nScan Complete. Total issues found: ${allResults.length}`);
if (allResults.length) {
  console.log(JSON.stringify(allResults.slice(0, 5000), null, 2));
}
