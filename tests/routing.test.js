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
  assert.deepEqual(remote.required_scopes, ['profile', 'email']);
});

test('native cloud connection uses host OAuth without embedded credentials', () => {
  const config = require('../.mcp.json').mcpServers['acr-cloud'];
  assert.equal(config.type, 'http');
  assert.equal(config.url, 'https://mcp.agentchatrooms.dev/mcp');
  assert.deepEqual(config.headers, { Accept: 'application/json, text/event-stream' });
  const fs = require('node:fs');
  const path = require('node:path');
  const catalog = fs.readFileSync(path.join(__dirname, '../docs/workflows.md'), 'utf8');
  const rows = catalog.split('\n').filter(line => /^\| [a-z].*\| preset-/.test(line));
  assert.equal(rows.length, 18);
  assert.equal(new Set(rows.map(line => line.split('|')[1].trim())).size, 18);
  for (const name of ['acr-room', 'acr-workflow', 'acr-consensus']) {
    const command = fs.readFileSync(path.join(__dirname, '../commands', name + '.md'), 'utf8');
    assert.match(command, /Never fall back to the local reference bridge/);
    assert.match(command, /\$ARGUMENTS/);
  }
});
