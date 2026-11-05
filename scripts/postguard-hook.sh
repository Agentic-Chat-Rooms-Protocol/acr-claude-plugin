#!/bin/sh
# PostGuard PreToolUse entry point: forwards the hook payload on stdin to the scanner.
exec node "${CLAUDE_PLUGIN_ROOT}/scripts/postguard-hook.cjs"
