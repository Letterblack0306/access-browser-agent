'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function realpathOrResolved(value) {
  const resolved = path.resolve(value);
  return fs.realpath(resolved).catch(() => resolved);
}

/**
 * Validates a workspace-relative path without reading or mutating its contents.
 * Callers must still perform their own operation-specific approval and audit.
 */
async function validateWorkspacePath(workspaceRoot, targetPath, options = {}) {
  const rootInput = String(workspaceRoot || '').trim();
  const targetInput = String(targetPath || '').trim();

  if (!rootInput) {
    return { ok: false, code: 'WORKSPACE_REQUIRED', error: 'Workspace root is required.' };
  }

  if (!targetInput) {
    return { ok: false, code: 'PATH_REQUIRED', error: 'Workspace-relative path is required.' };
  }

  const mustExist = options.mustExist !== false;
  const expectedKind = options.expectedKind || null;
  const root = await realpathOrResolved(rootInput);
  const resolved = path.resolve(root, targetInput);

  if (!isWithin(root, resolved)) {
    return {
      ok: false,
      code: 'OUTSIDE_WORKSPACE',
      error: 'Path is outside the workspace root.',
      resolved
    };
  }

  let existingAncestor = resolved;
  while (true) {
    try {
      existingAncestor = await fs.realpath(existingAncestor);
      break;
    } catch {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) break;
      existingAncestor = parent;
    }
  }

  if (!isWithin(root, existingAncestor)) {
    return {
      ok: false,
      code: 'SYMLINK_ESCAPE',
      error: 'Path resolves outside the workspace root.',
      resolved
    };
  }

  try {
    const stat = await fs.stat(resolved);
    const kind = stat.isDirectory() ? 'directory' : 'file';

    if (expectedKind && kind !== expectedKind) {
      return {
        ok: false,
        code: 'WRONG_PATH_KIND',
        error: `Path exists as a ${kind}, not a ${expectedKind}.`,
        resolved,
        kind
      };
    }

    return { ok: true, resolved, kind, missing: false };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    if (mustExist) {
      return {
        ok: false,
        code: 'PATH_NOT_FOUND',
        error: 'Path does not exist.',
        resolved
      };
    }

    return {
      ok: true,
      resolved,
      kind: expectedKind || null,
      missing: true
    };
  }
}

module.exports = { validateWorkspacePath };
