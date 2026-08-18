'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateWorkspacePath } = require('./workspace-path-guard');

const EXCLUDED_NAMES = new Set(['.git', 'node_modules']);

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

class WorkspaceReader {
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.maxReadBytes = Math.max(1, Number(options.maxReadBytes) || 1024 * 1024);
    this.maxWriteBytes = Math.max(1, Number(options.maxWriteBytes) || 1024 * 1024);
    this.maxSearchResults = Math.max(1, Number(options.maxSearchResults) || 100);
    this.maxInspectFiles = Math.max(1, Number(options.maxInspectFiles) || 5000);
  }

  async list(relativePath = '.') {
    const validated = await validateWorkspacePath(this.workspaceRoot, relativePath, {
      expectedKind: 'directory'
    });
    if (!validated.ok) return validated;

    const entries = await fs.readdir(validated.resolved, { withFileTypes: true });
    const items = entries
      .filter(entry => !EXCLUDED_NAMES.has(entry.name))
      .map(entry => ({
        name: entry.name,
        path: this.toRelative(path.join(validated.resolved, entry.name)),
        type: entry.isDirectory() ? 'directory' : 'file'
      }))
      .sort((left, right) =>
        left.type.localeCompare(right.type) || left.name.localeCompare(right.name)
      );

    return { ok: true, path: this.toRelative(validated.resolved), items };
  }

  async read(relativePath) {
    const validated = await validateWorkspacePath(this.workspaceRoot, relativePath, {
      expectedKind: 'file'
    });
    if (!validated.ok) return validated;

    const handle = await fs.open(validated.resolved, 'r');
    try {
      const stat = await handle.stat();
      const size = Math.min(stat.size, this.maxReadBytes);
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      const content = buffer.subarray(0, bytesRead).toString('utf8');
      return {
        ok: true,
        path: this.toRelative(validated.resolved),
        content,
        sha256: sha256(content),
        truncated: stat.size > bytesRead,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
    } finally {
      await handle.close();
    }
  }

  async create(relativePath, content) {
    if (typeof content !== 'string') return { ok:false, code:'CONTENT_REQUIRED', error:'File content must be a string.' };
    if (Buffer.byteLength(content, 'utf8') > this.maxWriteBytes) return { ok:false, code:'CONTENT_TOO_LARGE', error:'File content exceeds the configured write limit.' };
    const validated = await validateWorkspacePath(this.workspaceRoot, relativePath, { expectedKind:'file', mustExist:false });
    if (!validated.ok) return validated;
    if (!validated.missing) return { ok:false, code:'FILE_ALREADY_EXISTS', error:'File already exists; use a hash-guarded write or patch instead.', path:this.toRelative(validated.resolved) };
    const parent = await validateWorkspacePath(this.workspaceRoot, this.toRelative(path.dirname(validated.resolved)), { expectedKind:'directory' });
    if (!parent.ok) return { ...parent, code:parent.code || 'PARENT_DIRECTORY_MISSING', error:parent.error || 'Parent directory must already exist.' };
    try {
      await fs.writeFile(validated.resolved, content, { encoding:'utf8', mode:0o600, flag:'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST') return { ok:false, code:'FILE_ALREADY_EXISTS', error:'File was created concurrently; reload before changing it.' };
      throw error;
    }
    const stat = await fs.stat(validated.resolved);
    return { ok:true, path:this.toRelative(validated.resolved), sha256:sha256(content), size:stat.size, modifiedAt:stat.mtime.toISOString(), created:true };
  }

  async write(relativePath, content, expectedSha256) {
    if (typeof content !== 'string') {
      return { ok: false, code: 'CONTENT_REQUIRED', error: 'File content must be a string.' };
    }
    if (Buffer.byteLength(content, 'utf8') > this.maxWriteBytes) {
      return { ok: false, code: 'CONTENT_TOO_LARGE', error: 'File content exceeds the configured write limit.' };
    }

    const validated = await validateWorkspacePath(this.workspaceRoot, relativePath, {
      expectedKind: 'file'
    });
    if (!validated.ok) return validated;

    const current = await this.read(relativePath);
    if (!current.ok) return current;
    if (current.truncated) {
      return { ok: false, code: 'SOURCE_TRUNCATED', error: 'Truncated files cannot be overwritten from the editor.' };
    }

    const expected = String(expectedSha256 || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      return { ok: false, code: 'EXPECTED_HASH_REQUIRED', error: 'A valid expected SHA-256 is required.' };
    }
    if (expected !== current.sha256) {
      return {
        ok: false,
        code: 'FILE_CHANGED_EXTERNALLY',
        error: 'The file changed after it was opened. Reload it before saving.',
        expectedSha256: expected,
        actualSha256: current.sha256
      };
    }

    const temporary = `${validated.resolved}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, validated.resolved);

    const stat = await fs.stat(validated.resolved);
    return {
      ok: true,
      path: this.toRelative(validated.resolved),
      sha256: sha256(content),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    };
  }

  async search(query, relativePath = '.') {
    const needle = String(query || '');
    if (!needle) return { ok: false, code: 'QUERY_REQUIRED', error: 'Search query is required.' };

    const root = await validateWorkspacePath(this.workspaceRoot, relativePath, { expectedKind: 'directory' });
    if (!root.ok) return root;

    const matches = [];
    await this.walk(root.resolved, async filePath => {
      if (matches.length >= this.maxSearchResults) return false;
      const result = await this.read(this.toRelative(filePath));
      if (!result.ok) return true;
      const index = result.content.indexOf(query);
      if (index >= 0) {
        matches.push({
          path: result.path,
          index,
          preview: result.content.slice(Math.max(0, index - 80), index + needle.length + 120)
        });
      }
      return true;
    });

    return { ok: true, query: needle, matches, limited: matches.length >= this.maxSearchResults };
  }

  async inspect(relativePath = '.') {
    const root = await validateWorkspacePath(this.workspaceRoot, relativePath, { expectedKind: 'directory' });
    if (!root.ok) return root;
    const summary = { files: 0, directories: 0, bytes: 0, extensions: {}, limited: false };
    const visit = async directory => {
      if (summary.limited) return;
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (summary.limited || EXCLUDED_NAMES.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) { summary.directories += 1; await visit(fullPath); continue; }
        if (!entry.isFile()) continue;
        summary.files += 1;
        if (summary.files > this.maxInspectFiles) { summary.limited = true; return; }
        const stat = await fs.stat(fullPath);
        summary.bytes += stat.size;
        const extension = path.extname(entry.name).toLowerCase() || '[no extension]';
        summary.extensions[extension] = (summary.extensions[extension] || 0) + 1;
      }
    };
    await visit(root.resolved);
    return {
      ok: true,
      path: this.toRelative(root.resolved),
      files: summary.files,
      directories: summary.directories,
      bytes: summary.bytes,
      limited: summary.limited,
      extensions: Object.entries(summary.extensions)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 20)
        .map(([extension, count]) => ({ extension, count }))
    };
  }

  async walk(directory, visit) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const keepGoing = await this.walk(fullPath, visit);
        if (keepGoing === false) return false;
      } else if (entry.isFile()) {
        const keepGoing = await visit(fullPath);
        if (keepGoing === false) return false;
      }
    }
    return true;
  }

  toRelative(absolutePath) {
    const relative = path.relative(this.workspaceRoot, absolutePath);
    return relative ? relative.split(path.sep).join('/') : '.';
  }
}

module.exports = WorkspaceReader;
