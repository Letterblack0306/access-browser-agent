'use strict';

const path=require('node:path');

// R4 must test autonomous protected-chat context recovery without inheriting
// an unrelated durable agent session from the user's normal workspace.
// main.js gives ACCESS_AGENT_WORKSPACE_ROOT precedence over the persisted
// workspace preference, and agent state is keyed by workspace root. Pointing
// this acceptance at its own canonical checkout therefore isolates only the
// agent-session state while preserving the real userData-backed provider
// settings, authenticated managed-Chrome profile, and exact protected chat.
process.env.ACCESS_AGENT_WORKSPACE_ROOT=path.resolve(__dirname,'..');

require('./r4-live-conversation-context-acceptance');
