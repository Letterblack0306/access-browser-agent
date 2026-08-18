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
  assert.deepEqual(names, ['governed-terminal', 'runtime-review', 'workspace-tools'], 'runtime skill catalog must expose only canonical directory-backed skills');

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
