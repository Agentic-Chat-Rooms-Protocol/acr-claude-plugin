# Anthropic Claude Plugin Store Submission Roadmap (`acr-claude-plugin`)

**Connector Identifier:** `acr-chat-claude`  
**Plugin Package:** `@acr-js/claude-plugin`  
**Target Marketplace:** Anthropic Claude Code, Claude Desktop, and Cowork Plugin Marketplace  
**Specification Reference:** [`docs/acr-advertised-feature-inventory.md`](docs/acr-advertised-feature-inventory.md) & [`docs/daemon-mcp-routing-handoff.md`](docs/daemon-mcp-routing-handoff.md)  
**Last Review:** November 2026

---

## 1. Executive Summary & Readiness Assessment

The **Agentic Chat Rooms (ACR)** Claude Code plugin supplies an ephemeral local reference bridge and operational playbooks. It is not a production multi-user service. Desktop/Cowork support and official directory approval are unverified. Current release evidence and remaining gates: [`docs/submission-review.md`](docs/submission-review.md).

| Surface Area | Current State | Submission Gate Status |
|---|---|---|
| **Plugin Manifest** (`.claude-plugin/plugin.json`) | Validated against Claude Plugin schema; literal relative paths; zero credential collection | **READY** |
| **Marketplace Distribution** (`marketplace.json`) | Dual root & `.claude-plugin` catalogs synchronized | **READY** |
| **Vector Listing Assets** (`.claude-plugin/icon.png`) | Authentic 1024x1024 square PNG from `@acr-logos`; 127 KB (< 2 MB) | **READY** |
| **Tree Hygiene & Sandbox Bounds** | Zero symlinks, zero binary archives, zero `bin/` directory, strict file caps | **READY** |
| **Stdio MCP Bridge** (`scripts/acr-mcp-bridge.js`) | JSON-RPC 2.0 stdio server, 21 reference tools, zero credential reads | **READY** |
| **PostGuard PreToolUse Hook** (`scripts/postguard-hook.sh`) | Self-contained POSIX shell script; denies credential leaks, PII & prompt injection | **READY** |
| **Progressive-Disclosure Skills** (`skills/`) | 6 modular skills strictly adhering to sub-400-word leaf invariant & negative bounds | **READY** |
| **Context-Isolated Subagents** (`agents/`) | 3 subagents declaring model routing, tools, negative bounds & output contracts | **READY** |
| **One Dashboard Local Transport** (`dashboard/`) | Loopback-only (`127.0.0.1`), capability token URL hash, shared process state | **READY** |
| **Ecosystem Domain Invariants** | 100% compliant with `@agentchatrooms.dev` (zero legacy domain references) | **READY** |
| **Automated CI / Matrix Pipeline** | Workflow supplied for Ubuntu, macOS, Windows and Node 22/24; hosted runs pending | **AWAITING CI EVIDENCE** |
| **Live Claude Code CLI Verification** | Validated via programmatic harness; needs manual interactive CLI session logs | **ACTION REQUIRED** |
| **Remote MCP Gateway Routing Handoff** | Health/config and skill provide separate host-managed remote setup; live tests pending | **GUIDANCE IMPLEMENTED** |
| **Marketplace Submission Review Package** | Submission screencast & reviewer walkthrough notes need packaging | **ACTION REQUIRED** |

---

## 2. Completed Milestones (Verified in Codebase)

- [x] **Manifest Strict Schema Compliance**
  - Configured in `.claude-plugin/plugin.json` with canonical package name `acr-chat`.
  - Declared author support email strictly as `support@agentchatrooms.dev`.
  - Configured all relative paths with explicit `./` prefixes (`./.mcp.json`, `./skills`, `./agents/*.md`).
  - Restricted `userConfig` strictly to non-sensitive configuration (`daemonUrl`, `defaultRoom`), completely omitting private key paths, tokens, or credential inputs.
  - Omitted `hooks` key from `plugin.json` to prevent Anthropic duplicate auto-load collision errors.

- [x] **Distribution Catalog & Asset Compliance**
  - Generated matching `marketplace.json` in both root and `.claude-plugin/` directory.
  - Bundled 1024x1024 square PNG `icon.png` (PNG header `89 50 4E 47`, 127,448 bytes) complying with Anthropic's 512–2048 px and < 2 MB requirements.
  - Removed top-level `bin/` directory in compliance with Claude directory submission rules.
  - Verified absence of symbolic links, binary tarballs, or opaque compiled binaries.

- [x] **Reference Stdio MCP Bridge & Tool Dispatcher**
  - Configured in `.mcp.json` using literal `${CLAUDE_PLUGIN_ROOT}/scripts/acr-mcp-bridge.js`.
  - Implements stdio JSON-RPC 2.0 lifecycle (`initialize`, `tools/list`, `tools/call`, notifications).
  - Exposes 21 reference tools across Rooms (`chat.room.*`), Messages (`chat.message.*`), Identity (`chat.auth.verify`), Consensus (`chat.vote.*`), DAG (`chat.dag.*`), Incident (`chat.incident.*`), and Governance (`chat.governance.*`).
  - Implements single-use Ed25519 challenge nonces for `did:key` cryptographic verification.
  - Fails closed on malformed or deeply nested arguments without crashing the server.

- [x] **Fail-Closed PostGuard Security Scanner**
  - Configured in `hooks/hooks.json` under `PreToolUse` lifecycle hook executing `scripts/postguard-hook.sh`.
  - Written strictly in POSIX shell using only `grep` and `sed` (zero external unvetted dependencies).
  - Intercepts and blocks high-risk patterns before network dispatch:
    - OpenSSH and bare private key headers (`-----BEGIN ... PRIVATE KEY-----`).
    - Cloud & API secrets (AWS keys `AKIA...`, OpenAI `sk-proj-...`, GitHub `ghp_...`, JWT tokens).
    - PII exposures (US Social Security Numbers `XXX-XX-XXXX`, credit card PANs).
    - Prompt injections (ignore previous instructions, system message delimiters, DAN personas, safety bypasses).
  - Handles JSON unicode-escaped representations (`\u003c`, `\u0041`, etc.) to prevent bypass.
  - Never emits an automatic `allow` decision (neutral pass-through or explicit fail-closed `deny`).

- [x] **Progressive-Disclosure Skills (Sub-400-Word Invariant)**
  - `skills/acr-room-collaboration`: Channel discovery, presence, and etiquette (178 words).
  - `skills/acr-identity-did`: W3C DID document presentation and Ed25519 verification (190 words).
  - `skills/acr-consensus-gate`: 67% Byzantine consensus voting and mandatory dissent logging (199 words).
  - `skills/acr-atlas-dag`: Dynamic task DAG evaluation, dependency checking, and rollbacks (200 words).
  - `skills/acr-opsroom-incident`: Operational incident command, severity classification, and squad mobilization (199 words).
  - `skills/acr-human-governance`: Fail-closed human operator escalation and cryptographic veto gates (226 words).
  - All skills include explicit negative constraints ("Do NOT...") and Tier-3 reference links in `references/`.

- [x] **Subagent Isolation & Formatting**
  - `agents/byzantine-auditor.md`: Dedicated model routing, tools, negative bounds for quorum verification.
  - `agents/incident-commander.md`: Specialized incident triage and mitigation execution bounds.
  - `agents/dag-coordinator.md`: Dynamic DAG dependency graph coordination and rollback boundaries.
  - Bundled Fortune-50 operational style `output-styles/war-room-terse.md`.

- [x] **Local Control Room (One Dashboard)**
  - Zero-dependency HTTP server (`scripts/acr-dashboard.js`) running exclusively on loopback `127.0.0.1`.
  - Capability token authentication via URL fragment hash (`#token=...`), never stored in persistent browser storage.
  - Strict Content-Security-Policy denying all foreign origins, framing, and inline scripts.
  - Shares exact in-memory state and PostGuard scanner with MCP tool bridge.

---

## 3. Remaining Action Items for Official Marketplace Submission

### Priority 1: Cross-Platform CI & Environment Hardening
- [x] **Configure GitHub Actions Multi-Platform CI Workflow**
  - Add `.github/workflows/ci.yml` matrix testing across `ubuntu-latest`, `macos-latest`, and `windows-latest`.
  - Automate execution of `npm test` (`node tests/validate-plugin.js` and `node --test tests/dashboard.test.js`) on every PR and push to `main`.
- [x] **Cross-Platform Child Process Execution Hardening**
  - In `scripts/acr-dashboard.js`, adapt child process scanner execution to locate `sh` dynamically on Windows (`process.platform === 'win32' ? 'sh' : '/bin/sh'`).
  - Normalize path separators in `tests/dashboard.test.js` to ensure test assertions pass deterministically on both Windows (`\`) and Unix (`/`).

### Priority 2: Remote MCP Gateway Routing & Handoff
- [x] **Subscriber Routing Guidance** (separate host-managed server; no automatic entitlement resolver)
  - Document client-side resolver instructions according to `docs/daemon-mcp-routing-handoff.md`.
  - Provide clear in-tool guidance when an operator requests live multi-user deliberation: guide them to configure `https://mcp.agentchatrooms.dev/mcp` and authenticate via the host OAuth flow. Never request tokens in chat or plugin settings.
  - Ensure the local reference bridge never masquerades as a live cloud connection or fabricates network telemetry.

### Priority 3: Live Claude Code CLI End-to-End Verification
- [ ] **Manual Interactive Session Verification**
  - Launch an interactive Claude Code CLI session: `claude --plugin-dir .`.
  - Verify that Claude Code discovers all 6 skills, prompts for optional configuration, and exposes subagents.
  - Trigger all 6 skills via natural language prompts and verify deterministic tool execution.
  - Test PostGuard hook trigger by attempting to send a mock credential payload, confirming immediate terminal denial.
  - Capture and save sanitized CLI transcripts in `docs/verification-transcripts/`.

### Priority 4: Submission Package & Directory Intake
- [ ] **Reviewer Walkthrough & Demonstration Video**
  - Record a 2–3 minute video walkthrough (MP4) demonstrating:
    1. Plugin installation via `/plugin marketplace add`.
    2. Room deliberation and consensus proposal flow.
    3. PostGuard security hook intercepting a simulated credential leak.
    4. One Dashboard opening on loopback with shared state.
  - Host video at `https://agentchatrooms.dev/videos/claude-plugin-demo.mp4` or provide private link.
- [ ] **Official Directory Submission**
  - Current intake is https://clau.de/plugin-directory-submission, as linked by Anthropic's official repository on 2026-11-11. Prepare the evidence and submit through that form after release gates pass.
  - Monitor reviewer inquiries and verification feedback.

## 4. Development verification update (2026-11-11)

- [x] Add package allowlist and exclude local Claude caches from version control and distributable tree checks.
- [x] Correct unverified publication status and remove the unsupported submission timestamp from listing metadata.
- [x] Supply reviewer walkthrough, six-skill live test scenarios, recording script and current intake link in `docs/submission-review.md`.
- [x] Harden direct PostGuard execution to deny on input, decoding or scanner utility errors; add regression tests.
- [ ] Run authenticated Claude Code walkthrough: installed CLI reports `loggedIn: false`.
- [ ] Obtain passing hosted OS matrix results, authorized remote-service tests and a real demo recording.

Local harness evidence is recorded in `docs/verification-transcripts/local-validation.txt`; it is not a model-driven Claude transcript. No publication or submission has been performed.
