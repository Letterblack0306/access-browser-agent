'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { RUNTIME_MODULES, ALLOWED_MODULES } = require('../src/system/module-registry');

const rtSet = new Set(Object.keys(RUNTIME_MODULES));
const rtMods = Object.keys(RUNTIME_MODULES);
const found = new Map();

for (const mod of rtMods) {
  if (!fs.existsSync(mod)) continue;
  const content = fs.readFileSync(mod, 'utf8');
  const re = /require\(['"]([^'"]+)['"]\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const req = m[1];
    if (req.startsWith('.')) {
      const base = path.dirname(mod);
      const resolved = path.resolve(base, req);
      let target = resolved + '.js';
      if (!fs.existsSync(target) && fs.existsSync(resolved)) target = resolved;
      if (fs.existsSync(target)) {
        const rel = path.relative('.', target).replace(/\\/g, '/');
        if (!rtSet.has(rel)) {
          if (!found.has(rel)) found.set(rel, []);
          found.get(rel).push(mod);
        }
      }
    }
  }
}

// Determine which found modules are in ALLOWED_MODULES (normalized)
function normalizeAllowed(a) {
  if (a.startsWith('../src/')) return a.slice(3); // remove ../
  if (a.startsWith('./')) return 'electron/' + a.slice(2); // remove ./
  return a; // node: or electron built-ins
}
const allowedSet = new Set();
for (const a of Object.keys(ALLOWED_MODULES)) allowedSet.add(normalizeAllowed(a));

console.log('=== Non-registered modules actively imported by RUNTIME_MODULES ===');
for (const [mod, importers] of found) {
  const inAllowed = allowedSet.has(mod);
  const fileExists = fs.existsSync(mod);
  console.log(mod + '  | exists: ' + fileExists + ' | in ALLOWED_MODULES: ' + inAllowed + ' | imported by: ' + importers.join(', '));
}
