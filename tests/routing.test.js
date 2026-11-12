const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeTool } = require('../scripts/acr-mcp-bridge');

test('health and config expose consistent explicit host-managed remote setup', async () => {
  const data = async name => JSON.parse((await executeTool(name, {})).content[0].text);
  const health = await data('chat.health');
  const config = await data('chat.config.get');
  assert.equal(health.daemon_connected, false);
  assert.equal(config.mode, 'in-memory-reference');
  assert.deepEqual(health.live_collaboration, config.live_collaboration);
  const remote = health.live_collaboration;
  assert.equal(remote.url, 'https://mcp.agentchatrooms.dev/mcp');
  assert.equal(remote.authentication, 'host-managed OAuth');
  assert.match(remote.instructions, /never silently fall back/i);
  assert.match(remote.instructions, /remote tool names differ/i);
  assert.deepEqual(remote.required_scopes, ['acr:rooms', 'acr:cloud:pro']);
});
