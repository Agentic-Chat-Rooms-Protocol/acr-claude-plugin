# Dev handoff: subscription-aware MCP endpoint routing for the ACR daemon stack

Audience: engineers who own `acr-core` (daemon), `acr-mcp-server`, `acr-cli`, `acr-bridge` and the client SDKs.
Goal: free users talk to the **local** MCP stack, paid users (Cloud Pro / Enterprise) talk to the **remote** gateway at
`https://mcp.agentchatrooms.dev/mcp`, with the most secure implementation that is still simple to ship.

Reviewed (public repos, read-only). Nothing in those repos was executed; the sketches in Appendix A were compiled and
tested in a scratch module.

| Repo | Commit |
|---|---|
| `acr-docs` | `a8b1049` |
| `acr-core` | `ddd7cb3` |
| `acr-mcp-server` | `5ebd021` |
| `acr-bridge` | `5b0b4a7` |
| `acr-meta-mcp` | `6d85787` |
| `acr-cli` | `b2aac88` |
| `acr-node` | `760bf9b` |

> **Limits of this guide.** It uses only the public contract (`acr-docs/docs/specs/remote-mcp.md`,
> `port-mapping.md`) and public code. The Remote MCP gateway, billing and entitlement systems are not public and were
> **not** read. Anything that depends on them is marked *Confirm* and listed in section 10. The MCP specification site
> could not be fetched during this review, so statements attributed to it are from memory and are also *Confirm*.

## 1. Decision (TL;DR)

**Do not put subscription logic, a Cloud token, or a remote proxy in the daemon.** Keep the daemon local-only and
subscription-agnostic, and do the routing in a small client-side resolver backed by server-verified entitlement.

Why, in one paragraph: the daemon's HTTP API currently has no authentication, binds every network interface, and ships
with CORS `*` and Private Network Access **on by default** (section 2). A daemon that held or forwarded a paid Cloud
credential would hand it to any web page or LAN host that can reach port 20443. The daemon also has no tier concept
today, so "the daemon picks the URL" would mean inventing one, plus a credential store, in the least-protected
component. A client-side resolver needs none of that, and the remote gateway already enforces entitlement itself.

What the daemon **does** need is hardening (section 7). That is a prerequisite for any paid-tier work, and is useful
on its own.

| Question | Answer |
|---|---|
| Who decides local vs remote? | A resolver in the client layer (CLI / MCP launcher / SDK), not the daemon |
| Who enforces the subscription? | The remote gateway, on every request (`401` / `403 insufficient_scope`) |
| What does the daemon change? | Loopback bind, Host and Origin checks, local API auth, no unauthenticated config toggle |
| Can a user override the URL? | The **mode** (`local` / `remote`), yes. The **remote URL**, never |
| What happens when the paid endpoint fails? | An explicit error. No silent fallback to local |
| Where do Cloud tokens live? | The MCP host's own OAuth store if it has one, else the OS keychain. Never the daemon, never a plaintext file |

## 2. Current state (findings)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| C1 | The daemon has no tier, subscription, entitlement or cloud-URL concept | No such identifiers in `cmd/daemon/main.go`, `pkg/gateway/gateway.go` | Routing must be added somewhere; section 5 says where |
| C2 | The daemon listens on all interfaces | `cmd/daemon/main.go:105` `Addr: fmt.Sprintf(":%d", *portFlag)` | LAN hosts can reach every route |
| C3 | CORS `*` and PNA default to **on** | `cmd/daemon/main.go:20-21` (`-cors`, `-pna` default `true`); `pkg/gateway/gateway.go:173-182` | Any web origin may read responses; PNA header invites public-site-to-localhost calls |
| C4 | Routes are unauthenticated | `RegisterRoutes` in `pkg/gateway/gateway.go`; `X-ACR-Session` is allowed by CORS but no code enforces it (*Confirm*) | Rooms, messages, agents, escalations, audit, files are open to any caller |
| C5 | Security config is mutable by anyone | `handleSecurityConfig` (`gateway.go:203`) accepts `POST`/`PUT` and does not check `Content-Type`; a cross-origin `text/plain` POST is a "simple" request with no preflight (*Confirm in a browser*) | A web page may be able to switch CORS/PNA on or off |
| C6 | Default port mismatch | Daemon, `acr-mcp-server`, `acr-bridge`, `acr-cli` use `20443`. This Claude plugin uses `http://localhost:8080` (`.claude-plugin/plugin.json`, `scripts/acr-mcp-bridge.js:20`, README) | Users who copy the plugin default point at nothing. Fix in section 11 |
| C7 | Three MCP surfaces with **different tool names** | Local: `chat.*` (Go server maps to daemon REST). Remote: `acr_*` (15 tools plus `acr_container_status`). No automatic mapping (`remote-mcp.md`) | One dual-mode server would need a translation layer; section 5.7 avoids it |
| C8 | The remote gateway is not port-mapped or configurable | `port-mapping.md`: remote is excluded from `~/.acr/ports.json` | The URL is a constant, which is what we want |
| C9 | The existing vault is not safe for a Cloud token | `acr-meta-mcp/packages/auth-vault/src/vault.ts:15` falls back to a hard-coded master secret; `crypto.ts:12` uses a fixed default salt | Do not reuse `AuthVault` for Cloud credentials unless that fallback is removed |
| C10 | `acr tunnel` is a stub with a plaintext fallback | `acr-cli/lib/src/commands/tunnel_command.dart:35` falls back to `http://143.198.98.229:20443`; the command prints status and a generated token but performs no network I/O | Unreachable today (`defaultsTo` is always set), but it conflicts with "https, pinned host only". Remove it |
| C11 | The standalone `acr-mcp-server` and `acr-core/cmd/mcp-server` carry the same Go program | The two `main.go` files are byte-identical (`diff` is empty); the standalone README and `package.json` describe a TypeScript stack | Pick one home for the resolver; section 6 |

The remote contract that the design relies on (`remote-mcp.md`):

- Streamable HTTP, JSON or SSE responses; OAuth 2.1 bearer token; RFC 9728 discovery at
  `/.well-known/oauth-protected-resource`; scopes `acr:rooms` and `acr:cloud:pro`.
- Missing, unknown or expired token: `401` with `WWW-Authenticate` `invalid_token`.
  Valid token without the Pro scope (Community tier): `403 insufficient_scope`. Pro or Enterprise: `200`.
  Every `401`/`403` carries the required `scope` and a `resource_metadata` URL. The gateway fails closed.
- Self-serve OAuth consent is "rolling out"; until then Pro/Enterprise customers contact `support@agentchatrooms.dev`.

## 3. Threat model

Assets: the paid Cloud access/refresh token, the user's local room data, and the integrity of "which endpoint am I
talking to".

| Threat | Example | Primary control |
|---|---|---|
| **Token sent to the wrong host** (highest impact) | Attacker edits an env var, `ports.json`, or hits the open config API so "remote" points at their server | Remote URL is compiled in and validated; redirects are not followed; token audience is bound to the pinned URL |
| Spoofed or squatted local daemon | Another process listens on 20443 and returns a hostile "remote URL" | Clients never accept an endpoint from the daemon; only the pinned constant |
| Web page drives the local daemon | Page at `https://evil.example` calls `http://127.0.0.1:20443` | Origin allowlist, Host check, local API token, loopback bind |
| DNS rebinding | `evil.example` resolves to `127.0.0.1` | Host header allowlist; loopback **literal** only, never resolve `localhost` |
| LAN exposure | Neighbour reaches `:20443` | Bind `127.0.0.1` by default |
| Privilege confusion | A free user flips a local "tier" flag and expects paid features | Not exploitable: the gateway enforces entitlement. A local flag is a routing hint only |
| Silent tier downgrade/upgrade | Remote is down, client quietly writes to local, state splits | No cross-tier fallback; surface the active endpoint |
| Credential leakage | Token in logs, argv, URL query, env of child processes, or a plaintext file | Keychain or host OAuth store; redaction; header-only transport |
| Token passthrough / confused deputy | A proxy forwards a token it received to another service | Daemon is never a proxy; token audience is the remote gateway only (*Confirm* against the current MCP authorization spec) |

## 4. Options compared

| | A. Daemon routes (literal reading) | **B. Client-side resolver (recommended)** | C. Two separate servers, user picks |
|---|---|---|---|
| Where the decision lives | `acr-core` REST gateway | CLI / MCP launcher / SDK | The user's MCP client config |
| Cloud credential held by | The daemon | The keychain or the MCP host | The MCP host |
| Needs daemon auth first | Yes (large) | Hardening only | Hardening only |
| Tool-name translation | Daemon must map `chat.*` ↔ `acr_*` | None (surfaces stay separate) | None |
| Behaviour on lapse | Daemon must detect and rewire | Resolver re-evaluates on `403`/`401` | Manual |
| Attack surface added to the daemon | High | None | None |
| Effort | High | Medium | Low |

Recommendation: ship **C** immediately as the documented baseline (it is what the Claude plugin README already
describes), and build **B** on top of it as the provisioning and routing layer. Reject **A**. If product insists on A,
do not start until every item in section 7 is done and reviewed, and keep the token in the keychain, not the daemon DB.

## 5. Recommended design

### 5.1 Principles

1. **Enforcement is server-side.** The gateway decides entitlement; the client only chooses where to send a request.
2. **Remote URL is a constant.** Mode is selectable; the remote address is not.
3. **Default to local.** No credential, an expired one, or an unverifiable one means local.
4. **Never cross tiers silently.** An error that names the active endpoint beats a quiet reroute.
5. **The daemon stays dumb.** No tokens, no proxying, no tier.
6. **One spec, shared test vectors, several implementations.** Go, Dart and TypeScript clients must not drift.

### 5.2 Components

| Component | Repo | Role |
|---|---|---|
| Resolution spec and test vectors | `acr-docs` (`docs/specs/mcp-endpoint-resolution.md`, `docs/specs/fixtures/endpoint-vectors.json`) | Single source of truth |
| Go resolver package (`mcpendpoint`) | `acr-core` (`pkg/mcpendpoint`) | Validation and mode selection; imported by `cmd/mcp-server` |
| `acr login` / `logout` / `mcp status` / `mcp install` | `acr-cli` | OAuth, keychain, writes MCP client config, shows the active endpoint |
| Remote server entry for hosts with OAuth | Client config (generated) | Host owns the token; ACR code never sees it |
| TS port of the resolver | `acr-node` / `acr-bridge` (only if they need it) | Same vectors, same behaviour |

Put the Go resolver in `acr-core/pkg` and have `acr-mcp-server` consume it, so there is one Go copy (finding C11).

### 5.3 Resolution algorithm and URL rules

```text
resolve(override, grantedScopes, localURL):
  local := validateLocal(localURL)              # always validated, even if remote wins
  if override == "local":  return local
  if override == "remote": return REMOTE_URL    # constant; still needs a valid token
  if grantedScopes ⊇ {acr:rooms, acr:cloud:pro}: return REMOTE_URL
  return local
```

Local URL source precedence (reusing `port-mapping.md`): CLI flag, then `ACR_DAEMON_URL`, then `~/.acr/ports.json`, then
the default `http://127.0.0.1:20443`. The override is `--mode` or `ACR_MCP_MODE=local|remote`. **No variable selects the
remote URL.** A dev or staging host, if one exists, is a separate compiled-in allowlist entry shipped in a release,
never an environment variable (*Confirm* whether a staging host is needed).

Validation, enforced identically in every language:

| | Remote | Local |
|---|---|---|
| Scheme | `https` only | `http` only |
| Host | exactly `mcp.agentchatrooms.dev` (case-insensitive, no trailing dot) | `localhost` (pinned to `127.0.0.1`), `127.0.0.1`, or `::1` |
| Port | empty or `443` | `1024-65535`, default `20443` |
| Path | exactly `/mcp` | empty or `/` |
| Userinfo, query, fragment | rejected | rejected |
| Redirects | **never followed**; a `3xx` is an error | never followed |
| TLS errors | hard fail; no insecure override | n/a |

Rejected inputs the vectors must cover: `mcp.agentchatrooms.dev.evil.com`, `mcp.agentchatrooms.dev@evil.com`,
`user:pw@` forms, `:8443`, `/mcp/`, `/%6dcp`, `?next=//evil.com`, `//host/mcp`, `0.0.0.0`, LAN addresses,
`localhost.evil.com`, `127.0.0.1.evil.com`, `2130706433`, `0x7f.0.0.1`, `127.1`, `[::ffff:127.0.0.1]`, and `http://`
for remote.

### 5.4 Entitlement signals

| Signal | Use | Trust |
|---|---|---|
| `scope` in the OAuth token response | Pick `remote` vs `local` at login time | Routing hint |
| `401` / `403 insufficient_scope` from the gateway | Re-auth, or stop and show an upgrade message | **Authoritative** |
| `acr_container_status` (tier, quota, rate limit, sandbox TTL) | Display only | Informational; response shape *Confirm* |

Do not decode the access token locally to read a tier. Its format is private and may change (*Confirm*). Cache the
result as `{mode, scopes, checkedAt}` with a TTL no longer than the token's lifetime, and negative-cache a `403` for
about 60 seconds so a lapsed account does not hammer the gateway.

### 5.5 Credentials

- **Preferred:** let the MCP host do OAuth (Claude Code, Claude Desktop, Cursor and ChatGPT are understood to support
  remote MCP with OAuth; *Confirm* per client and version). The generated config contains the pinned URL and **no secret**. ACR code never handles a token.
- **When ACR must hold a token** (for example `acr` CLI features): OAuth 2.1 authorization code with PKCE `S256`,
  loopback redirect `http://127.0.0.1:<ephemeral>/callback` (RFC 8252) or device code on headless hosts. Discover via
  RFC 9728, then authorization-server metadata. Send the `resource` parameter (RFC 8707) and verify the metadata's
  `resource` equals the pinned URL before sending any token. Request only `acr:rooms acr:cloud:pro`, and only when the
  user opts in; free users are never prompted.
- **Storage:** macOS Keychain, Windows Credential Manager, or libsecret. If none exists, refuse and tell the user; do not
  fall back to a plaintext file. Never put the token in `ports.json`, the daemon's database, argv, a URL, a log, or a
  child process environment.
- **Two credentials, never interchangeable:** the local API token (section 7, never leaves the machine) and the Cloud
  token (audience is the remote gateway only, never sent to `127.0.0.1`).
- `acr logout` deletes the keychain item and revokes the refresh token if the server supports it (*Confirm*).
- Do not use `${user_config.*}` to collect the token for the Claude plugin. Use the host's remote-server OAuth.

### 5.6 Failure semantics

| Condition | Behaviour |
|---|---|
| No credential, or `scope` lacks `acr:cloud:pro` | Local. No prompt |
| `401 invalid_token`, refresh succeeds | Retry once, silently |
| `401`, refresh fails | Stay on remote, report "sign in again". **Do not** reroute to local |
| `403 insufficient_scope` | Stop. Show "your plan does not include Cloud MCP" with the upgrade/step-up link from the challenge. Do not resend the token. Negative-cache |
| Timeout, `5xx` or network error on a **read** (`initialize`, `tools/list`, `acr_list_rooms`, `acr_get_messages`, `acr_get_agent_did`, `acr_verify_message_sig`, `acr_get_consensus_state`, `acr_get_goal_dag`, `acr_container_status`) | Error naming the endpoint. Exponential backoff with jitter, at most 3 tries, circuit breaker. No auto-failover |
| Timeout, `5xx` or network error on a **mutation** (`acr_post_message`, `acr_create_room`, `acr_join_room`, `acr_rotate_keys`, `acr_propose_action`, `acr_cast_vote`, `acr_update_goal_status`, `acr_declare_incident`, `acr_escalate_human_review`, and any `chat.*` write) | **No automatic retry.** The mutation may have committed before the failure. Report "outcome unknown", name the endpoint, and let the caller verify with a read (for example `acr_get_messages`). Retry automatically only if the gateway documents an idempotency key that makes replays safe (*Confirm*), or if the failure happened before the request was sent (connection refused, DNS or TLS handshake failure) |
| `3xx` | Error (possible redirect attack). Implemented as a `CheckRedirect` error, not `http.ErrUseLastResponse`, which would return the `3xx` as a normal response |
| TLS failure | Hard error |
| Subscription lapses | `403` flips the resolver to local for the next session and prints "Cloud MCP paused; local MCP unchanged" |

Document that **local and cloud rooms are separate stores.** Switching tiers does not migrate room state, and users
must be told so at the moment of switching (*Confirm* whether a migration path is planned).

### 5.7 Tool-surface policy

Keep two server names and let the host namespace the tools (`mcp__acr__chat_*`, `mcp__acr-remote__acr_*`). Do not
add a `chat.*` ↔ `acr_*` translation layer in v1. Consequences to handle:

- Agent `tools:` allowlists in plugins must name the server they use. The Claude plugin's agents currently use dotted
  names; follow-up in section 11.
- If a unified surface is wanted later, make it an explicit, versioned mapping table in `acr-docs`, owned by the
  gateway team, with contract tests on both sides.

For the Claude plugin, offer remote as an **opt-in** (`claude mcp add --transport http acr-remote
https://mcp.agentchatrooms.dev/mcp`, as the README already says) rather than bundling an unauthenticated remote entry
that free users would see failing. A product alternative is a second, remote-only "ACR Cloud" plugin so that
"which plugin is installed" is the tier switch with zero runtime logic. That is a product decision; *Confirm*.

## 6. Step-by-step implementation

Work in the order below. Each phase is independently shippable and should be its own PR in its own repo.

### Phase 0: harden the daemon (`acr-core`) - gate for everything else

See section 7. Enforcing local API auth (D4) breaks every existing daemon consumer that does not send a token. At the
reviewed revision `cmd/mcp-server/main.go` calls `client.Get` and `client.Post` with no `Authorization` header, so room
creation, joins, reads and message sends would all return `401`. Roll D4 out in three steps, each its own release:

1. **0a - ship the non-breaking daemon changes:** D2, D3 (including preflight handling), D5, D6, D7, and the
   `-bind` flag and `~/.acr/api-token` generation from D1/D4, with enforcement **off** (`-require-auth=false`).
   Log a one-line warning at startup that unauthenticated access is deprecated.
2. **0b - make every daemon consumer token-aware:** read the token from `ACR_API_TOKEN`, falling back to
   `~/.acr/api-token`, and send it as `Authorization: Bearer <token>` on every request, SSE included. Known
   consumers: `cmd/mcp-server` (and the duplicate in `acr-mcp-server`), the `acr-cli` client, the `acr-bridge`
   daemon client and platform bridges, the SDK clients, and the web UI. Audit for others; do not rely on this list.
3. **0c - flip the default to enforce** (`-require-auth` defaults to `true`) only after every consumer in 0b has
   shipped, and call it out in the changelog as a breaking change.

Do not start Phase 3 until 0c is merged. The Phase 2 resolver work may proceed in parallel with 0a and 0b, because
it does not depend on enforcement.

### Phase 1: specify (`acr-docs`)

1. Add `docs/specs/mcp-endpoint-resolution.md` covering sections 5.3 to 5.6.
2. Add `docs/specs/fixtures/endpoint-vectors.json` with every accept/reject case from 5.3 and the resolution table
   from Appendix A. All implementations load this file in their tests.
3. Cross-link from `remote-mcp.md` and `port-mapping.md`. State in `port-mapping.md` that the remote URL is
   deliberately not configurable.

### Phase 2: resolver package (`acr-core`)

1. Add `pkg/mcpendpoint` using Appendix A as the starting point.
2. Make `cmd/mcp-server` call `ValidateLocal` on `ACR_DAEMON_URL`, and replace its `&http.Client{Timeout: 10 * time.Second}`
   with `NewHTTPClient()`, which keeps that 10 s timeout and adds a redirect error. The server handles stdio requests
   serially, so an unbounded client would let one unresponsive daemon block every later request. Use
   `NewStreamClient()` only for SSE, where an overall timeout would cut the stream. Because `postJSON` only rejects
   status `>= 400`, a client that returned a `3xx` as a normal response would make a redirected write look
   successful. Fail at startup with a clear message on an invalid URL instead of continuing.
3. Run the shared vectors in `go test`.
4. Remove the duplicated standalone `acr-mcp-server/main.go`, or make it import the package (finding C11).

### Phase 3: login and provisioning (`acr-cli`)

1. `acr login`: PKCE flow per 5.5; store in the OS keychain; print granted scopes.
2. `acr logout`: delete and revoke.
3. `acr mcp status`: print mode, endpoint, reason (`granted scopes include acr:cloud:pro`), and token expiry. Never
   print the token. This is the "surface the active endpoint" requirement.
4. `acr mcp install --client claude-code|claude-desktop|cursor`: always register the local server; add `acr-remote`
   (pinned URL, no secret) only when the resolver says `remote`. Re-running it after a downgrade removes the remote
   entry.
5. Delete the plaintext fallback and the stub in `tunnel_command.dart` (finding C10), or replace it with a real
   implementation that uses the same pinned-URL rules.
6. Dart tests load the shared vectors.

### Phase 4: SDKs and bridge (`acr-node`, `acr-bridge`)

Only where they need to choose an endpoint. Port the resolver to TypeScript, load the shared vectors, and default to
`http://127.0.0.1:20443`. Do not add token handling to the platform bridges.

### Phase 5: client packaging (this repo, `acr-chatgpt-plugin`)

- Claude plugin: fix the `8080` default (section 11), add a README pointer, keep the bundled bridge as the in-memory
  reference. No credential config.
- ChatGPT plugin: remote-only by design. Keep its URL equal to the pinned constant and add a test asserting that.

### Phase 6: rollout

1. Ship Phases 0a-0b and 2 without a feature flag (they only tighten behaviour or add opt-in capability). Phase 0c is a
   breaking change: ship it as its own release, after every consumer has shipped token support.
2. Ship Phase 3 as a beta command group. Because self-serve OAuth is still "rolling out", pre-release testing must use
   an account provisioned through `support@agentchatrooms.dev`.
3. Announce the `127.0.0.1` bind change in the changelog. Users who relied on LAN access must opt in with
   `-bind <address> -allow-nonloopback -allowed-host <address-or-name>` (repeatable). `-allow-nonloopback` also requires
   local API auth to be enforced, and the daemon refuses to start without at least one `-allowed-host` when the bind is
   not loopback. A wildcard bind (`0.0.0.0`, `::`) is accepted only with explicit `-allowed-host` entries, never as an
   implicit allow-all.

## 7. Daemon changes (`acr-core`)

These are the only daemon changes required. None adds subscription logic.

| # | Change | Where |
|---|---|---|
| D1 | Bind to `127.0.0.1` by default. Add `-bind` / `ACR_BIND`. Refuse a non-loopback bind unless `-allow-nonloopback` is set, local API auth is enforced (D4), **and** at least one `-allowed-host` is given (D2) | `cmd/daemon/main.go:105` |
| D2 | Host allowlist (DNS rebinding). Default `localhost`, `127.0.0.1`, `::1`. With `-allow-nonloopback`, add only the exact addresses or names given by `-allowed-host` / `ACR_ALLOWED_HOSTS`; never a wildcard. A normal request to an allowed LAN address must succeed, and one to any other Host must get `403` | new middleware |
| D3 | Replace `Access-Control-Allow-Origin: *` with an exact-match allowlist (`ACR_ALLOWED_ORIGINS`). Reject, server-side, any request carrying a non-allowlisted `Origin`. Answer CORS preflights (`OPTIONS` with `Access-Control-Request-Method`) for allowlisted origins directly, before token enforcement, because a preflight never carries the credential. Apply the same rule to the SSE handler (`gateway.go:253`). Emit the PNA header only on a preflight from an allowlisted origin that asked for it | `corsHeaders`, `handleSSE` |
| D4 | Require `Authorization: Bearer <local token>` on **every** route except the public list in D7: reads (rooms, messages, audit, files, agents) and the SSE stream as well as mutations. Host and Origin checks stop browsers, not other processes or LAN peers, so they are not authentication. Token is 256 random bits at `~/.acr/api-token` (mode `0600`), compared in constant time, and an empty or unset token must reject everything (fail closed). Browsers cannot send headers from `EventSource`, so web clients stream with `fetch` and the `X-ACR-Session` header; never put a token in a URL. Browser sessions come from the existing `/api/v1/auth/challenge` and `/verify` DID flow (*Confirm* design with the daemon owners). Roll out per Phase 0a-0c | `RegisterRoutes` |
| D5 | Remove unauthenticated `POST`/`PUT` on `/api/v1/config/security`. Require D4 and a loopback peer, and ignore any request with an `Origin` header | `handleSecurityConfig` |
| D6 | Make CORS and PNA default **off**; turn on only through D3's allowlist | `cmd/daemon/main.go:20-21` |
| D7 | The only routes reachable without a token: `/healthz`, `/health`, `/api/v1/health`, and the auth-bootstrap routes `/api/v1/auth/challenge` and `/api/v1/auth/verify` (*Confirm* the bootstrap routes expose nothing sensitive). Keep health responses to non-sensitive fields; optionally add `"mcp": {"local": true}`. Never add tier, token or a remote URL | health handlers |

Reference sketches (compiled and tested; see Appendix A for the test tables):

```go
bind := flag.String("bind", "127.0.0.1", "listen address; non-loopback needs -allow-nonloopback, -allowed-host and enforced local API auth")
srv := &http.Server{Addr: net.JoinHostPort(*bind, strconv.Itoa(*portFlag)) /* ... */}

// LoopbackHosts is the default Host allowlist. With -allow-nonloopback, add the exact
// addresses or names clients use (for example 192.168.1.5); never a wildcard.
var LoopbackHosts = map[string]bool{"localhost": true, "127.0.0.1": true, "::1": true}

// PublicPaths are reachable without a token. Everything else, reads and SSE included, needs one.
var PublicPaths = map[string]bool{
	"/healthz": true, "/health": true, "/api/v1/health": true,
	"/api/v1/auth/challenge": true, "/api/v1/auth/verify": true,
}

func HostGuard(allowed map[string]bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			h = strings.Trim(r.Host, "[]")
		}
		if !allowed[strings.ToLower(h)] {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// OriginGuard rejects non-allowlisted origins and answers CORS preflights itself. A preflight
// never carries credentials, so it must be answered before RequireToken sees it.
func OriginGuard(allowed map[string]bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o := r.Header.Get("Origin")
		if o == "" {
			next.ServeHTTP(w, r)
			return
		}
		if !allowed[o] {
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", o)
		h.Add("Vary", "Origin")
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ACR-Session, X-ACR-Client")
			h.Set("Access-Control-Max-Age", "600")
			if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
				h.Set("Access-Control-Allow-Private-Network", "true")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireToken fails closed: an empty configured token or a missing "Bearer " prefix never passes.
func RequireToken(token []byte, public map[string]bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if public[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || len(token) == 0 || subtle.ConstantTimeCompare([]byte(got), token) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="acr-local"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

`OriginGuard` closes finding C5 even though the browser sends a "simple" request: a cross-origin `POST` still carries an
`Origin` header, and the server now refuses it before the handler runs. Host and Origin guards only constrain
browsers. They do not authenticate a non-browser caller, including a LAN peer that omits `Origin` and sends an
allowed `Host`; `RequireToken` on every non-public route (reads and SSE too) is what stops that. Wire the guards in the
order `HostGuard` → `OriginGuard` (answers preflights) → `RequireToken` → handlers.

## 8. Test plan

| Layer | Test | Pass when |
|---|---|---|
| Resolver | Shared vectors: every accept/reject URL in 5.3 | Identical result in Go, Dart and TS |
| Resolver | Mode table: no creds, `acr:rooms` only, `acr:cloud:pro` only, both, each override | Matches Appendix A table |
| Resolver | Invalid local URL while remote is chosen | Still an error (no latent bad config) |
| HTTP client | Server replies `302` to another host (REST and stream clients) | The call returns an error (not a `3xx` response); the target receives no request |
| HTTP client | `NewHTTPClient().Timeout`, and a daemon that never answers | 10 s timeout preserved; the MCP server does not block indefinitely |
| HTTP client | Remote presents an invalid or self-signed cert | Hard error, no override |
| Retry | Mutating tool call fails with a timeout or `5xx` after the request was sent | Exactly one request sent; caller is told the outcome is unknown |
| Retry | Read fails with a `5xx` | Retried with backoff, at most 3 tries |
| Contract | Against the gateway with a Community token | `403 insufficient_scope`, no fallback to local |
| Contract | Expired token | `401`, one refresh attempt, then re-auth prompt |
| Contract | Pro token | `200` on `initialize` and `tools/list` |
| Credential | Run login/use/logout with debug logging and a canary token | Canary appears in no log, argv, env, file or URL |
| Credential | Keychain unavailable | Refuses; writes no file |
| Daemon | Table in Appendix A (Host, Origin, token, preflight, public paths, reads, SSE) | All rows pass |
| Daemon | Start with `-bind 192.168.1.5 -allow-nonloopback -allowed-host 192.168.1.5` and a token | A request to `http://192.168.1.5:20443` with the token succeeds; without the token or with another Host it fails |
| Daemon | Start with `-allow-nonloopback` and no `-allowed-host`, or a non-loopback bind without enforced auth | Refuses to start |
| Daemon | Browser test: allowlisted origin sends an authenticated `fetch` with `Authorization` | Preflight returns `204` with the CORS headers, then the authenticated request succeeds |
| Daemon | Browser test: cross-origin `text/plain` `POST` to `/api/v1/config/security` from a non-allowlisted origin | `403`, config unchanged |
| Daemon | Start with default flags | Listens on `127.0.0.1` only (`ss -ltn`) |
| Transition | Upgrade then downgrade while a session is open | Endpoint shown in `acr mcp status` flips with an explicit message; no room data written to the wrong store |
| Regression | Existing free-tier flows | Unchanged against a hardened daemon, using the local API token |
| Rollout | Each daemon consumer from Phase 0b (MCP server, CLI, bridge, SDKs, web UI) against a daemon with `-require-auth=true` | All succeed before 0c flips the default |

## 9. Checklist

- [ ] D1-D7 merged in `acr-core`; default `acr-daemon` listens only on loopback
- [ ] Every daemon consumer sends the local token (Phase 0b) **before** enforcement becomes the default (Phase 0c)
- [ ] Reads and SSE require the token; only the D7 public routes do not
- [ ] `/api/v1/config/security` cannot be changed without the local token
- [ ] LAN opt-in works end to end with `-allowed-host`, and refuses to start without it
- [ ] `mcp-endpoint-resolution.md` and `endpoint-vectors.json` merged in `acr-docs`
- [ ] `pkg/mcpendpoint` merged; `cmd/mcp-server` validates `ACR_DAEMON_URL` at startup
- [ ] Standalone `acr-mcp-server` no longer carries a second copy of `main.go`
- [ ] `acr login` / `logout` / `mcp status` / `mcp install` work against a provisioned Pro account
- [ ] No code path sends a Cloud token to a host other than the pinned constant
- [ ] No fallback between tiers on error (tests prove it)
- [ ] Mutating tool calls are never auto-retried without a documented idempotency mechanism
- [ ] REST client keeps the 10 s timeout and treats a `3xx` as an error
- [ ] `acr tunnel` stub and its plaintext-IP fallback removed
- [ ] Claude plugin default port corrected to `20443`; ChatGPT plugin URL test added
- [ ] Changelog entry for the loopback bind and local API token

## 10. Open questions (owners of the private systems)

1. How is the tier encoded for the client: `scope` in the token response only, or also a token claim or an
   introspection endpoint? (This guide assumes `scope` only.)
2. Timeline for self-serve OAuth consent, and whether device-code and loopback redirects are both registered.
3. Is refresh-token rotation on, and is RFC 7009 revocation supported?
4. Shape of `acr_container_status`, and whether it is safe to call on connect.
5. Is there a staging host that clients may need, and how should it be allowlisted without an environment variable?
6. Where should the resolver live long-term: `acr-core/pkg`, the CLI, or a published SDK?
7. Does the gateway validate token audience against its own URL (RFC 8707)? Clients assume it does.
8. Is there a planned migration path from local rooms to cloud rooms, or are they permanently separate?
8a. Does the gateway support an idempotency key (header or tool argument) for mutating tools? Without one, clients must
    not retry mutations automatically (section 5.6).
9. Which web origins legitimately need the daemon's CORS allowlist (D3)? The portal origin is not documented in the
   public specs.
10. Confirm the current MCP authorization and transport requirements (Origin validation for local HTTP servers,
    resource indicators, no token passthrough) against the latest MCP specification revision.
11. Which route set does the web UI use for authenticated streaming (D4), and can it use `fetch`-based SSE with a
    session header instead of `EventSource`?

## 11. Follow-ups in this repository (not part of this change)

- Change the `daemonUrl` default from `http://localhost:8080` to `http://127.0.0.1:20443` in
  `.claude-plugin/plugin.json`, `scripts/acr-mcp-bridge.js` (`DEFAULT_DAEMON_URL`), `README.md` and `tests/`.
- Agent `tools:` allowlists use dotted names (`chat.post`); hosts namespace MCP tools as
  `mcp__<server>__<tool>`, and the Anthropic API tool-name pattern is `^[a-zA-Z0-9_-]{1,64}$`. Align names and
  allowlists.
- Keep the README statement that the bundled bridge is an isolated in-memory reference server. If it ever connects to
  a real daemon, it must use `ValidateLocal` and send the local API token.

Incidental, outside this scope: `acr-core` tracks built binaries (`acr-daemon.exe`, `dist/`, release tarballs) in git.

## Appendix A: verified reference code

The resolver and the guards in section 7 compiled with `go vet` and passed `go test` in a scratch module (toolchain
Go 1.27, module language level `go 1.21`; `acr-core`'s `go.mod` declares `go 1.26`). The tests, and review of the first
draft, caught real bugs that are fixed in the code below: host comparison must be case-insensitive; an empty configured
token must not match an empty header; a bare token without the `Bearer ` scheme must not pass; `http.ErrUseLastResponse`
returns a `3xx` as a success; and a client without `Timeout` removes the MCP server's 10 s bound.

`pkg/mcpendpoint/endpoint.go`:

```go
package mcpendpoint

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	// RemoteURL is compiled in. No flag, env var, file or server response may change it.
	RemoteURL        = "https://mcp.agentchatrooms.dev/mcp"
	DefaultLocalPort = 20443
	// RESTTimeout matches the 10 s client timeout cmd/mcp-server already uses.
	RESTTimeout = 10 * time.Second
)

type Mode string

const (
	Local  Mode = "local"
	Remote Mode = "remote"
)

var requiredScopes = []string{"acr:rooms", "acr:cloud:pro"}

// ValidateRemote accepts exactly RemoteURL after parsing, so lookalikes, userinfo,
// alternate ports, queries and fragments are all rejected.
func ValidateRemote(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	want, _ := url.Parse(RemoteURL)
	if u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
		u.Opaque != "" || u.ForceQuery {
		return errors.New("remote: scheme, userinfo, query or fragment not allowed")
	}
	if !strings.EqualFold(u.Hostname(), want.Hostname()) || (u.Port() != "" && u.Port() != "443") ||
		u.EscapedPath() != want.Path {
		return errors.New("remote: host or path not allowlisted")
	}
	return nil
}

// ValidateLocal accepts only a loopback literal so a hosts-file or DNS answer cannot redirect it.
func ValidateLocal(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
		(u.Path != "" && u.Path != "/") {
		return "", errors.New("local: scheme, userinfo, path, query or fragment not allowed")
	}
	host := u.Hostname()
	switch host {
	case "localhost":
		host = "127.0.0.1" // pin to the literal; never resolve the name
	case "127.0.0.1", "::1": // exact literals only: no 127.1, decimal, hex or IPv4-mapped forms
	default:
		return "", errors.New("local: host must be localhost, 127.0.0.1 or ::1")
	}
	port := DefaultLocalPort
	if p := u.Port(); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 1024 || n > 65535 {
			return "", errors.New("local: port must be 1024-65535")
		}
		port = n
	}
	return "http://" + net.JoinHostPort(host, strconv.Itoa(port)), nil
}

type Resolution struct {
	Mode   Mode
	URL    string
	Reason string
}

// Resolve picks a mode. override is "", "local" or "remote" and selects the mode only.
// scopes are the scopes the authorization server granted; they are a routing hint, because
// the gateway enforces entitlement on every call.
func Resolve(override string, scopes []string, localURL string) (Resolution, error) {
	local, err := ValidateLocal(localURL)
	if err != nil {
		return Resolution{}, err
	}
	switch override {
	case "local":
		return Resolution{Local, local, "explicit override"}, nil
	case "remote":
		return Resolution{Remote, RemoteURL, "explicit override"}, nil
	case "":
	default:
		return Resolution{}, errors.New("override must be local or remote")
	}
	if hasAll(scopes, requiredScopes) {
		return Resolution{Remote, RemoteURL, "granted scopes include acr:cloud:pro"}, nil
	}
	return Resolution{Local, local, "no paid scope; default"}, nil
}

func hasAll(have, want []string) bool {
	set := make(map[string]bool, len(have))
	for _, s := range have {
		set[s] = true
	}
	for _, w := range want {
		if !set[w] {
			return false
		}
	}
	return true
}

var errRedirect = errors.New("mcpendpoint: redirects are not followed")

// A non-nil error is required: http.ErrUseLastResponse would hand the 3xx back as a normal
// response, and callers that only check status >= 400 would treat it as success.
func noRedirect(*http.Request, []*http.Request) error { return errRedirect }

// NewHTTPClient is for request/response calls. It keeps the finite timeout and never follows
// redirects, so a 3xx cannot carry a bearer token to another origin.
func NewHTTPClient() *http.Client {
	return &http.Client{Timeout: RESTTimeout, CheckRedirect: noRedirect}
}

// NewStreamClient is for long-lived SSE. An overall Client.Timeout would cut the stream, so it
// is left at zero and the server must instead send response headers within RESTTimeout.
func NewStreamClient() *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.ResponseHeaderTimeout = RESTTimeout
	return &http.Client{Transport: tr, CheckRedirect: noRedirect}
}
```

Resolution table (also the `Resolve` unit test):

| Case | Override | Granted scopes | Result |
|---|---|---|---|
| Free, no credential | none | none | `local` |
| Community token | none | `acr:rooms` | `local` |
| Partial scope | none | `acr:cloud:pro` only | `local` |
| Paid | none | `acr:rooms acr:cloud:pro` | `remote` |
| Paid user forces local | `local` | both | `local` |
| Free user forces remote | `remote` | none | `remote` (gateway then returns `403`; no fallback) |
| Invalid local URL, paid | none | both | error |
| Unknown override | `cloud` | none | error |

Daemon guard table (also the guard unit test). "Reached" means the final handler ran:

| Case | Method and path | Host | Origin | Authorization | Expect | Reached |
|---|---|---|---|---|---|---|
| Local client | `POST /api/v1/config/security` | `127.0.0.1:20443` | none | valid | `204` | yes |
| IPv6 loopback | `POST` config | `[::1]:20443` | none | valid | `204` | yes |
| Allowlisted portal | `POST` config | `localhost:20443` | allowlisted | valid | `204` | yes |
| DNS rebinding | `POST` config | `evil.com:20443` | none | valid | `403` | no |
| LAN host, default allowlist | `POST` config | `192.168.1.5:20443` | none | valid | `403` | no |
| LAN host, listed in `-allowed-host` | `GET /api/v1/rooms` | `192.168.1.5:20443` | none | valid | `204` | yes |
| LAN host, listed, no token | `GET /api/v1/rooms` | `192.168.1.5:20443` | none | none | `401` | no |
| Web page, simple `POST` | `POST` config | `127.0.0.1:20443` | `https://evil.com` | none | `403` | no |
| Web page holding a token | `POST` config | `127.0.0.1:20443` | `https://evil.com` | valid | `403` | no |
| Mutation, no token | `POST` config | `127.0.0.1:20443` | none | none | `401` | no |
| Wrong token | `POST` config | `127.0.0.1:20443` | none | wrong | `401` | no |
| Read, no token | `GET /api/v1/rooms` | `127.0.0.1:20443` | none | none | `401` | no |
| SSE, no token | `GET /api/v1/events` | `127.0.0.1:20443` | none | none | `401` | no |
| Health, no token | `GET /api/v1/health` | `127.0.0.1:20443` | none | none | `204` | yes |
| Auth bootstrap, no token | `POST /api/v1/auth/challenge` | `127.0.0.1:20443` | none | none | `204` | yes |
| Empty configured token, empty header | `GET /api/v1/rooms` | `127.0.0.1:20443` | none | none | `401` | no |
| Empty configured token, `Bearer ` only | `GET /api/v1/rooms` | `127.0.0.1:20443` | none | empty bearer | `401` | no |
| Token without the `Bearer ` scheme | `GET /api/v1/rooms` | `127.0.0.1:20443` | none | bare token | `401` | no |
| Preflight, allowlisted origin | `OPTIONS` config | `127.0.0.1:20443` | allowlisted | none | `204` plus CORS headers | no |
| Preflight asking for PNA | `OPTIONS` config | `127.0.0.1:20443` | allowlisted | none | `204` plus `Access-Control-Allow-Private-Network` | no |
| Preflight, other origin | `OPTIONS` config | `127.0.0.1:20443` | `https://evil.com` | none | `403` | no |
| Preflight, bad host | `OPTIONS` config | `evil.com:20443` | allowlisted | none | `403` | no |
| Preflight without `Origin` | `OPTIONS` config | `127.0.0.1:20443` | none | none | `401` | no |

HTTP client tests: a `302` from either client returns an error and the redirect target receives no request;
`NewHTTPClient().Timeout` equals `RESTTimeout`; `NewStreamClient()` has no overall timeout but bounds
`ResponseHeaderTimeout`.

## Appendix B: commands to verify the findings

Line numbers refer to the commits in the table at the top.

```bash
# C2, C3, C5: run in a clone of acr-core
git clone --depth 1 https://github.com/Agentic-Chat-Rooms-Protocol/acr-core /tmp/acr-core && cd /tmp/acr-core
grep -n 'Addr:' cmd/daemon/main.go                                   # all interfaces
grep -n 'flag.Bool("cors"\|flag.Bool("pna"' cmd/daemon/main.go       # both default true
sed -n 203,232p pkg/gateway/gateway.go                               # POST/PUT with no auth, no Content-Type check

# C6: run from the root of this repository
grep -rn '8080' .claude-plugin/plugin.json scripts/acr-mcp-bridge.js README.md
```
