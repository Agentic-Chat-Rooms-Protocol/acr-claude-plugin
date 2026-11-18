// Adapt Claude's hook envelope to the scanner's tool-argument contract.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

try {
  const { tool_name, tool_input } = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (typeof tool_name !== 'string' || !tool_input ||
      typeof tool_input !== 'object' || Array.isArray(tool_input)) throw new Error();
  const result = spawnSync(process.platform === 'win32' ? 'sh' : '/bin/sh',
    [path.join(__dirname, 'postguard-hook.sh')], {
      input: JSON.stringify({ tool_name, tool_input }), encoding: 'utf8',
      timeout: 10000, maxBuffer: 16384
    });
  if (result.error || result.status !== 0 || result.stderr) throw new Error();
  if (result.stdout.trim()) {
    const decision = JSON.parse(result.stdout);
    if (decision.hookSpecificOutput?.permissionDecision !== 'deny') throw new Error();
    process.stdout.write(JSON.stringify(decision));
  }
} catch {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: 'PostGuard scanner failed; tool execution denied.'
  } }));
}
