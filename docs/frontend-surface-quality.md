# Frontend surface quality: One Dashboard

## Baseline and plan

The requested specification was absent from the starting checkout. This contract
uses the bundled MCP bridge and feature documentation as the baseline, not the
separate hosted Remote MCP gateway.

1. Inventory actual reference capabilities and correct misleading guarantees.
2. Share one tool registry, validator, dispatcher and in-memory process between
   MCP and an explicitly requested local dashboard.
3. Provide a responsive, keyboard-accessible control room, live reference
   overview, searchable tool navigation, typed forms and inspectable results.
4. Verify every tool over HTTP, shared MCP state, rejected requests and browser
   workflows. Keep existing plugin checks passing.

## Feature inventory and limits

| Surface | Tools | Actual local behavior and limits |
|---|---|---|
| Health | `chat.health` | Process readiness and real room count; no daemon connection or invented latency/audit metrics. |
| Rooms and presence | `chat.rooms.list`, `chat.room.create`, `chat.room.join`, `chat.room.leave` | In-memory rooms and caller-supplied DIDs. Private flags are metadata, not access control. |
| Messaging | `chat.message.send`, `chat.history.fetch` | Bounded local messages and structured attachments; no message signatures, file uploads or verified history. |
| Buddy graph | `chat.buddy.request`, `chat.buddy.accept`, `chat.buddy.block` | Request receipt and one-way local relationship changes; no invitation delivery or publish-level block enforcement. |
| Identity | `chat.auth.challenge`, `chat.auth.verify` | Real single-use Ed25519 nonce verification for `did:key`. No `did:web` resolution; issued reference tokens do not authorize other tools. No private-key collection. |
| Configuration | `chat.config.get`, `chat.config.security` | Reference settings only, never daemon configuration or changes to the dashboard's fixed browser security policy. |
| Consensus | `chat_cast_vote` | Two-thirds tally with mandatory dissent rationale; one fixed reference voter, no authenticated electorate, signed ballots or production authorization. |
| AST | `mcp_ast_diff_verify` | Not implemented: explicitly fails closed rather than inventing a verified safety result. |
| Atlas DAG | `acr_get_dag_state`, `acr_advance_dag_node`, `acr_rollback_dag` | Prerequisite checking, output hashes, checkpoint records and transitive downstream invalidation. No execution engine, receipt verification or snapshot restoration. |
| Governance | `acr_request_human_gate` | Bounded pending requests and deadlines only; no approval/veto endpoint, signature verification or enforcement against unrelated tool calls. The caller must halt. |
| Dashboard | `chat.dashboard.open` | Lazily starts the local server and returns a capability URL; repeated calls reuse the same listener. |

Intentional corrections to the original reference behavior: unsupported AST
checks return an error instead of verified success; missing room history returns
an error; reference configuration updates persist; rollback clears all
transitive descendants' active hashes/checkpoint pointers. Consensus returns
`REFERENCE_QUORUM_MET` with `production_authorized: false`, never authorization;
human requests return `PENDING_HUMAN_APPROVAL` with `enforced: false`.

Ops Room incident command, PostGuard and terse output are agent/skill/hook
workflows, not additional daemon APIs. PostGuard runs through Claude's hook and the browser transport reuses that same
bundled scanner before dispatch, denying execution if the scanner fails or
returns an invalid decision. Browser calls use the same schema validation as MCP
but do not inherit Claude's interactive permissions or a production policy engine.

## One Dashboard acceptance contract

- Every registry tool, including optional and structured arguments, is usable
  from a generated form. No browser-only alternate business logic.
- MCP and browser calls see identical state, validation errors and tool results
  within one bridge process. A separately launched CLI dashboard has separate
  state; it does not attach to an existing MCP process.
- The overview uses actual tool results. Seeded rooms/DAG/proposal are reference
  fixtures, not a live deployment. No mock success, metrics or approval buttons.
- Errors remain visible; pending actions disable repeat submission. Mutations
  require explicit confirmation. Empty optional values are omitted; explicit
  `false`, zero, empty strings, objects and arrays remain representable.
- Keyboard labels, focus indicators, responsive layout, reduced-motion support,
  readable contrast and live status announcements are required.
- Restarting loses all process state. The browser keeps the dashboard bearer
  token in memory only, removes it from the URL, and never collects private keys.

## Security boundary

The dashboard is opt-in. It binds only `127.0.0.1` on an OS-selected port, checks
the exact Host and browser Origin, permits no CORS, and requires a random
256-bit bearer token on every API request. The launch URL carries the token in
its fragment, not in an HTTP path/query. Only fixed static assets are served.
JSON bodies are bounded to 256 KiB with header/request timeouts and connection
limits. PostGuard runs only a fixed local script with JSON on stdin (never shell
interpolation), a fixed utility search path, a three-second timeout and bounded
output. CSP forbids inline code, external resources, framing and form navigation;
responses disable caching, MIME sniffing and referrer propagation.

The launch URL grants full access to the **reference** tools: treat it as a
local capability, do not publish it, and stop the process to revoke it. The
dashboard bearer token is distinct from identity verification's reference token.
Local malware, browser extensions and a compromised same-origin runtime are
outside this boundary. Remote execution requires an explicitly secured tunnel;
never widen the bind address or disable checks to expose it.

## Running and verification

Claude calls `chat.dashboard.open` and presents the returned URL to the operator.
No browser, shell, remote daemon or HTTP listener starts during normal MCP use.
For independent local use, run `npm run dashboard`; Ctrl+C stops it.
After a browser reload, reopen the capability URL returned by the tool/CLI.

Run `npm test` for plugin regressions and dashboard transport/parity tests.
Browser acceptance covers navigation, typed forms, mutation confirmation,
error reporting, cross-surface state and a narrow viewport. Production daemon,
hosted gateway OAuth, incident automation and cryptographic audit guarantees
are explicitly outside the implemented reference surface.

### Verification record (2026-11-05)

Automated coverage includes the existing 60 plugin checks and 17 dashboard
checks: every registered tool, shared MCP/browser state, genuine signature
verification, reference-only quorum/governance results, transitive rollback,
authorization/origin/body limits, PostGuard blocking and scanner failure modes,
and listener startup/shutdown.

Browser acceptance exercised all 21 generated forms and their labels, explicit
false/zero values, JSON objects/arrays, creation and history, cancellation,
confirmation focus restoration, visible AST and PostGuard errors, safe rendering
of HTML-like content, search, token removal and reload behavior. Layout was
checked at 1280px and 390px without horizontal page overflow.

Not verified: a live daemon or hosted gateway, remote tunnels, non-Chromium
browsers, or a full assistive-technology audit. These checks do not certify
production ACR identity, consensus, governance or audit guarantees.
