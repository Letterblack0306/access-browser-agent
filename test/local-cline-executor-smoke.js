'use strict';

const assert = require('node:assert/strict');
const { LocalClineExecutor, modelsUrl } = require('../src/system/local-cline-executor');

(async () => {
  const calls = [];
  const execFile = async (exe, args, options) => {
    calls.push({ exe, args, cwd:options.cwd });
    if (exe === 'cline' && args[0] === '--version') return { stdout:'cline 1.2.3\n', stderr:'' };
    if (exe === 'cline') return { stdout:'{"type":"done","success":true}\n', stderr:'' };
    if (exe === 'git') return { stdout:' M src/example.js\n', stderr:'' };
    throw new Error('unexpected executable');
  };
  const fetch = async url => ({
    ok:true,
    status:200,
    async text() { return JSON.stringify({ data:[{ id:'local-coder' }] }); },
    url,
  });
  const executor = new LocalClineExecutor({
    workspaceRoot:process.cwd(),
    getSettings:() => ({
      clineExecutable:'cline',
      lmStudioBaseUrl:'http://127.0.0.1:1234/v1',
      lmStudioModel:'local-coder',
      clineLocalAutoApprove:true,
    }),
    execFile,
    fetch,
  });

  assert.equal(modelsUrl('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1/models');
  const status = await executor.status();
  assert.equal(status.ready, true);
  assert.equal(status.cline.available, true);
  assert.equal(status.lmStudio.modelAvailable, true);

  const result = await executor.execute({ task:'Change one file.', acceptance:['Tests pass.'], timeoutMs:20000 });
  assert.equal(result.ok, true);
  assert.match(result.gitStatusAfter, /src\/example\.js/u);
  const clineCall = calls.find(call => call.exe === 'cline' && call.args[0] === '--json');
  assert.ok(clineCall);
  assert.ok(clineCall.args.includes('--model'));
  assert.ok(clineCall.args.includes('local-coder'));
  assert.match(clineCall.args.at(-1), /bounded coding executor/u);
  console.log('local-cline-executor-smoke: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
