'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

class BrowserResultStore {
  constructor(root) { this.root = path.resolve(root); }
  async put(payload) {
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    const sha256 = crypto.createHash('sha256').update(serialized).digest('hex');
    const directory = path.join(this.root, 'browser-relay');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${sha256}.json`);
    await fs.writeFile(file, serialized, { encoding:'utf8', flag:'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    return { sha256, relativePath:path.join('browser-relay', `${sha256}.json`) };
  }
}

module.exports = { BrowserResultStore };
