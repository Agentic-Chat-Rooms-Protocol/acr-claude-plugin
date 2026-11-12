const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const utility of ['cat', 'sed', 'grep']) {
  test(`direct hook denies when ${utility} fails`, { skip: process.platform === 'win32' }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acr-hook-failure-'));
    try {
      fs.writeFileSync(path.join(directory, utility), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
      const result = spawnSync('/bin/sh', [path.join(__dirname, '../scripts/postguard-hook.sh')], {
        input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'notes.txt' } }),
        encoding: 'utf8', timeout: 3000,
        env: { PATH: directory + ':/usr/bin:/bin' }
      });
      assert.equal(result.status, 0, result.stderr);
      const decision = JSON.parse(result.stdout).hookSpecificOutput;
      assert.equal(decision.permissionDecision, 'deny');
      assert.match(decision.permissionDecisionReason, /scanner failed/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
