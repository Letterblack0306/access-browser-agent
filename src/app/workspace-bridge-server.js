'use strict';

const http = require('node:http');
const WorkspaceReader = require('../system/workspace-reader');
const { ChangeGovernanceGuard } = require('../agent/guards/ChangeGovernanceGuard');

function json(status, body) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}

function routePath(url) {
  return new URL(url, 'http://127.0.0.1');
}

async function handleWorkspaceBridgeRequest(request, reader) {
  const method = String(request.method || 'GET').toUpperCase();
  const url = routePath(request.url || '/');

  if (method === 'POST' && url.pathname === '/api/workspace/create') {
    const body = await readJsonBody(request);
    try {
      new ChangeGovernanceGuard({ workspaceRoot:reader.workspaceRoot }).assertMutation({
        toolName:'createFile',
        args:{ path:body.path, changeId:body.changeId },
      });
    } catch (error) {
      return json(403, {
        ok:false,
        code:String(error?.code || 'CHANGE_GOVERNANCE_BLOCKED'),
        error:String(error?.message || error),
        classification:'GOVERNANCE',
      });
    }
    const result = await reader.create(body.path, body.content);
    return json(result.ok ? 201 : 400, result);
  }

  if (method === 'PUT' && url.pathname === '/api/workspace/file') {
    const body = await readJsonBody(request);
    try {
      new ChangeGovernanceGuard({ workspaceRoot:reader.workspaceRoot }).assertMutation({
        toolName:'writeFile',
        args:{ path:body.path, changeId:body.changeId },
      });
    } catch (error) {
      return json(403, {
        ok:false,
        code:String(error?.code || 'CHANGE_GOVERNANCE_BLOCKED'),
        error:String(error?.message || error),
        classification:'GOVERNANCE',
      });
    }
    const result = await reader.write(body.path, body.content, body.expectedSha256);
    const status = result.ok ? 200 : result.code === 'FILE_CHANGED_EXTERNALLY' ? 409 : 400;
    return json(status, result);
  }

  if (method !== 'GET') {
    return json(405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'This bridge accepts GET reads, governed POST file creation, and governed PUT file saves only.'
    });
  }

  if (url.pathname === '/agent/health') {
    return json(200, {
      ok: true,
      mode: 'governed-workspace-bridge',
      workspaceConfigured: true
    });
  }

  if (url.pathname === '/api/runtime/status') {
    return json(200, {
      ok: true,
      runtime: {
        ok: true,
        mode: 'remote',
        authority: 'governed-workspace-bridge'
      },
      capabilities: [
        'workspace.list',
        'workspace.read',
        'workspace.write.hash_guarded.change_governed',
        'workspace.search',
        'workspace.inspect'
      ]
    });
  }

  if (url.pathname === '/api/workspaces') {
    return json(200, { ok: true, activeRoot: reader.workspaceRoot });
  }

  let result;
  if (url.pathname === '/api/workspace/list') {
    result = await reader.list(url.searchParams.get('path') || '.');
  } else if (url.pathname === '/api/workspace/read' || url.pathname === '/api/workspace/file') {
    result = await reader.read(url.searchParams.get('path') || '');
  } else if (url.pathname === '/api/workspace/search') {
    result = await reader.search(
      url.searchParams.get('query') || '',
      url.searchParams.get('path') || '.'
    );
  } else if (url.pathname === '/api/workspace/inspect') {
    result = await reader.inspect(url.searchParams.get('path') || '.');
  } else {
    return json(404, {
      ok: false,
      code: 'ROUTE_NOT_FOUND',
      error: 'Route is not available in the workspace bridge.'
    });
  }

  return json(result.ok ? 200 : 400, result);
}

function createWorkspaceBridgeServer(options = {}) {
  const workspaceRoot = String(options.workspaceRoot || '').trim();
  if (!workspaceRoot) {
    throw new Error('ACCESS_BROWSER_AGENT_WORKSPACE_ROOT is required for the workspace bridge.');
  }

  const reader = options.reader || new WorkspaceReader(workspaceRoot, options.readerOptions);
  return http.createServer(async (request, response) => {
    try {
      const result = await handleWorkspaceBridgeRequest(request, reader);
      response.writeHead(result.status, result.headers);
      response.end(result.body);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        ok: false,
        code: 'BRIDGE_ERROR',
        error: error.message
      }));
    }
  });
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 1024 * 1024) {
      throw new Error('Workspace request body exceeds 1 MiB.');
    }
  }

  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error('Workspace request body must be valid JSON.');
  }
}

module.exports = { createWorkspaceBridgeServer, handleWorkspaceBridgeRequest };
