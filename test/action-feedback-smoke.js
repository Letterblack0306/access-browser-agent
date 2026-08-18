'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'electron', 'action-feedback.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'electron', 'workbench-ux.css'), 'utf8');

assert.match(html, /<script src="\.\/action-feedback\.js"><\/script>/u);
assert.match(script, /document\.addEventListener\('click'/u);
assert.match(script, /\{ capture: true \}/u);
assert.match(script, /dataset\.actionFeedback/u);
assert.match(script, /dataset\.actionFeedback = 'pressed'/u);
assert.match(script, /dataset\.actionFeedback = 'busy'/u);
assert.match(script, /dataset\.actionFeedback = 'resolved'/u);
assert.match(script, /ACTION · \$\{label\}/u);
assert.match(script, /WORKING · \$\{label\}/u);
assert.match(script, /uiActionStatus/u);
assert.match(styles, /button\[data-action-feedback="pressed"\]/u);
assert.match(styles, /button\[data-action-feedback="busy"\]/u);
assert.match(styles, /button\[data-action-feedback="resolved"\]/u);
assert.match(styles, /#uiActionStatus/u);

console.log('Action feedback smoke PASS');
