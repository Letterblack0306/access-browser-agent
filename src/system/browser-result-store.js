'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

class BrowserResultStore {
  constructor(root) { this.root = path.resolve(root); }
  async put(payload) {
    const linkage = payload && typeof payload === 'object' && payload.linkage ? {
      sessionId: payload.linkage.sessionId ? String(payload.linkage.sessionId) : null,
      turnId: payload.linkage.turnId ? String(payload.linkage.turnId) : null,
      stepId: payload.linkage.stepId ? String(payload.linkage.stepId) : null,
      planNodeId: payload.linkage.planNodeId ? String(payload.linkage.planNodeId) : null,
      gitCommitSha: payload.linkage.gitCommitSha ? String(payload.linkage.gitCommitSha) : null,
    } : null;
    const finalPayload = linkage ? { ...payload, linkage } : payload;
    const serialized = `${JSON.stringify(finalPayload, null, 2)}\n`;
    const sha256 = crypto.createHash('sha256').update(serialized).digest('hex');
    const directory = path.join(this.root, 'browser-relay');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${sha256}.json`);
    await fs.writeFile(file, serialized, { encoding:'utf8', flag:'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    return { sha256, relativePath:path.join('browser-relay', `${sha256}.json`), linkage };
  }
}

module.exports = { BrowserResultStore };
