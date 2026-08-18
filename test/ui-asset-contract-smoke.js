'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const electronRoot = path.join(root, 'electron');
const index = fs.readFileSync(path.join(electronRoot, 'index.html'), 'utf8');

const refs = [
  ...index.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(\.\/[^"?#]+)"/gu)
].map(match => match[1]);

assert.ok(refs.length > 0, 'Expected local Electron script/style references.');

const missing = refs
  .map(ref => ({ ref, absolute: path.resolve(electronRoot, ref) }))
  .filter(item => !fs.existsSync(item.absolute));

assert.deepEqual(
  missing,
  [],
  `Electron index references missing local assets: ${missing.map(item => item.ref).join(', ')}`
);

const duplicates = refs.filter((ref, indexOfRef) => refs.indexOf(ref) !== indexOfRef);
assert.deepEqual([...new Set(duplicates)], [], 'Electron index must not load the same local asset twice.');

console.log(`UI asset contract smoke PASS (${refs.length} local assets)`);
