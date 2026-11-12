# Reviewer walkthrough and release gates

## Scope

ACR `acr-chat` 1.0.0 ships six skills, three agents, 21 in-memory MCP tools,
an opt-in loopback dashboard and a blocking-only PostGuard hook. Local state is
discarded at exit. No production authorization, durable messages, live incident
backend or remote entitlement enforcement is supplied by this package. Signature
verification is limited to single-use Ed25519 challenges. PostGuard is a heuristic
filter, not a guarantee against every secret format or prompt injection.

The hosted gateway is a separately operated service. Its authentication, outage,
entitlement and tool-error behavior requires an authorized live integration test.
Never treat reference tests as evidence about that service.

## Reproducible automated checks

1. Check out the release commit in a clean directory with Node 22 or 24 and POSIX
   `sh`, `grep`, and `sed` (Git for Windows on Windows).
2. Run `npm test`. This exercises stdio lifecycle, all tool families, Ed25519
   verification, limits, governance timeout, dashboard parity, origin/authentication
   boundaries, scanner failures and remote-setup guidance.
3. Run `claude plugin validate .` and `claude plugin validate .claude-plugin/plugin.json`.
   These are structural checks; Claude's directory also performs safety and policy review.
4. Run `npm pack --dry-run` and verify the package excludes developer caches and
   credentials. Test the extracted artifact using `npm test` before release.
5. Require successful GitHub Actions results on all six OS/Node combinations.

## Authenticated Claude Code walkthrough

Use a test account and a disposable working directory. Record the Claude version,
OS, Node version, plugin commit and actual outcomes. Start `claude --plugin-dir
/absolute/path/to/acr-claude-plugin`. Do not suppress permission prompts.

Verify plugin discovery in `/plugin`, MCP initialization in `/mcp`, all six skills,
the three named agents and the output style. Check optional configuration handling.
Invoke these scenarios and record the actual discovered tool names and outcomes:

| Skill | Prompt and expected observation |
|---|---|
| acr-room-collaboration | Create a local review room and post a harmless message; health reports reference mode. |
| acr-identity-did | Request a challenge and verify a signature from a disposable external Ed25519 signer; a replay fails. Never pass a private key. |
| acr-consensus-gate | Create a reference proposal, vote, and inspect the tally; no claim of production consensus enforcement. |
| acr-atlas-dag | Inspect the default DAG, advance an eligible node, roll back its checkpoint and observe descendant invalidation. |
| acr-opsroom-incident | Draft a simulated incident response; no claim of an active incident backend. |
| acr-human-governance | Request a high-risk human gate; response remains pending and the caller halts. |

Attempt a tool call containing the public mock AWS fixture `AKIAIOSFODNN7EXAMPLE`;
confirm a PreToolUse denial and no execution. Open `chat.dashboard.open` and verify
the room is shared with MCP. Closing the session must terminate its listener.
Redact capability URLs, credentials, account identifiers and personal paths from
all captured evidence. Do not present harness output as a Claude session transcript.

## Two-to-three-minute recording script

- 0:00–0:30: add the ACR marketplace and install `acr-chat@acr-marketplace` in Claude.
- 0:30–1:20: show local reference health, room/message exchange and a proposal tally.
- 1:20–1:50: show the mock credential call being denied by the hook.
- 1:50–2:30: open the dashboard, show the shared room and state limitations.
- 2:30–2:45: show separate remote configuration guidance and support contact.

Use an authenticated host to record the actual workflow. Upload only a sanitized
recording to an owner-approved location, then add its real URL to the submission.
No recording or hosted URL is claimed by this document.

## Official directory intake

As verified on 2026-11-11, Anthropic's
[official repository](https://github.com/anthropics/claude-plugins-official#contributing)
directs third-party plugins to the
[submission form](https://clau.de/plugin-directory-submission), not an unsolicited PR.
Prepare the repository URL, immutable release commit, description, license,
support/security contacts, test evidence, runtime requirements and demo URL.
Retain the `acr-chat` slug after publication. No official submission has been
performed by this development task.

## Outstanding external evidence

- Passing hosted CI matrix results (workflow is supplied; not run here).
- Authenticated Claude Code skill/hook/discovery transcripts.
- Live gateway 401/403, outage and tool-error tests using an authorized account.
- Sanitized demo recording and hosting.
- Owner submission and Anthropic safety/policy approval.

These gates cannot be replaced by a local assertion of “100% production readiness.”
