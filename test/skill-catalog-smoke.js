'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { SkillCatalog, parseSkill } = require('../src/system/skill-catalog');

(async () => {
  assert.deepEqual(parseSkill('---\nname: workspace-tools\ndescription: Read workspace files safely.\n---\n\n# Workspace tools\n', 'fallback'), { name: 'workspace-tools', description: 'Read workspace files safely.' });
  assert.deepEqual(parseSkill('# No frontmatter\n', 'fallback'), { name: 'fallback', description: 'No description declared.' });

  const catalog = new SkillCatalog(path.join(__dirname, '..', 'skills'));
  const skills = await catalog.list();
  const names = skills.map(skill => skill.name);
  assert.deepEqual(names, ['evidence-boundary-audit', 'governed-terminal', 'runtime-review', 'workspace-tools'], 'runtime skill catalog must expose only canonical directory-backed skills');

  const audit = await catalog.readSkill('evidence-boundary-audit');
  assert.equal(audit?.name, 'evidence-boundary-audit', 'audit skill name must match its directory');
  assert.ok(names.includes('runtime-review'), 'canonical runtime-review skill must be discoverable');
  assert.match(audit?.content || '', /Evidence-driven/u, 'audit skill must keep its evidence-driven focus');
  assert.match(audit?.content || '', /procedural knowledge only/iu, 'audit skill must be procedural knowledge only, granting no authorization');
  assert.match(audit?.content || '', /smallest discriminating real test/u, 'audit skill must replace mental simulation with a real discriminating test');
  assert.match(audit?.content || '', /FALSIFIER/u, 'audit skill must require a falsifier in its evidence matrix');
  assert.match(audit?.content || '', /CLASSIFICATION/u, 'audit skill must require an evidence classification');
  assert.match(audit?.content || '', /INCONCLUSIVE/u, 'audit skill must expose the full allowed classification set');
  assert.doesNotMatch(audit?.content || '', /mental simulation|mentally simulate|simulate the full runtime|simulate repeated execution/iu, 'audit skill must not teach mental simulation as proof');
  assert.doesNotMatch(audit?.content || '', /10\/10 identical runs|ten-run determinism|Run 10/u, 'audit skill must not assert false generic determinism');

  const review = await catalog.readSkill('runtime-review');
  assert.equal(review?.name, 'runtime-review');
  assert.match(review?.content || '', /PROVEN/u, 'runtime review skill must preserve explicit evidence classes');
  assert.match(review?.content || '', /action\/evidence capabilities, not the debugging authority/iu, 'runtime review skill must keep execution/action tools separate from debugging authority');
  assert.match(review?.content || '', /Validation ladder/u, 'runtime review skill must require claim-matched validation');

  const terminal = await catalog.readSkill('governed-terminal');
  assert.match(terminal?.content || '', /no product-wide static capability allowlist/iu, 'governed terminal skill must match machine-adaptive executable discovery');
  assert.doesNotMatch(terminal?.content || '', /\.gpt-sync\/terminal-receipts/u, 'governed terminal skill must not teach the obsolete fixed receipt path');

  console.log('Skill catalog smoke PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
