'use strict';

const { createWorkspaceBridgeServer } = require('./workspace-bridge-server');

const workspaceRoot = String(process.env.ACCESS_BROWSER_AGENT_WORKSPACE_ROOT || '').trim();
const port = Number(process.env.ACCESS_BROWSER_AGENT_BRIDGE_PORT || 7725);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('ACCESS_BROWSER_AGENT_BRIDGE_PORT must be an integer from 1 through 65535.');
}

const server = createWorkspaceBridgeServer({ workspaceRoot });
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Read-only workspace bridge listening on http://127.0.0.1:${port}\n`);
});
