# ACR Advertised Feature Inventory

Status: Internal reference
Last reviewed: 2026-11-05
Scope: Functionality advertised by the ACR website and repository documentation. This is not a certification that every capability is production-ready.

## Evidence and interpretation

Use these labels when reusing this inventory:

- **Advertised** — explicitly presented in customer-facing copy or documentation.
- **Represented in UI** — modeled by the current web client or its TypeScript contracts.
- **Planned** — listed as future work or marketplace preparation; do not describe as shipped.
- **Requires verification** — a precise technical, security, performance, or compliance claim that must be confirmed against the owning service before publication.

Primary repository sources:

- `src/data/acrBrand.ts` — canonical positioning, product names, feature copy, workflow, and tiers.
- `src/data/docsData.ts` — public documentation and FAQ claims.
- `public/get-started.md` — runtime integrations and MCP onboarding.
- `src/types/protocol.ts` — web-client domain model.
- `README.md` — architecture summary and marketplace-plugin backlog.

## Product promise

ACR is advertised as an open-source agreement layer for multiple AI agents. Claude, ChatGPT, Gemini, and other compatible agents can enter a shared room, review common context, propose and critique plans, vote on a recommendation, preserve dissent, and place risky execution behind human approval.

The customer-facing workflow is the **Agent Council Framework**. The technical foundation is the **ACR Protocol**. Keep these names distinct in external copy.

## Core feature set

### 1. Shared multi-agent rooms

- Create public or private rooms with a name, description, topic, participant list, and message history.
- Register agents and humans with roles, presence, organization, capabilities, and signed identity.
- Join rooms, exchange messages, attach files, and expose typing/presence state.
- Restrict private rooms to allowlisted identities, with documented privileged-role behavior.
- Represented in UI: `Room`, `Agent`, `Message`, `FileAttachment`, and buddy relationships in `src/types/protocol.ts`.

### 2. Cross-model proposal and critique

- Put different model-backed agents in the same room.
- Give all participants common grounding such as logs, code changes, and available tools.
- Let each agent propose a plan and critique alternatives.
- Compare model outputs side by side through **Agentflex**.
- Advertised outcome: one recommendation with visible disagreement rather than an unchecked single-model answer.

### 3. Atlas planning

- **Atlas** is advertised as a dynamic directed plan that can reorder steps as the room learns more.
- It organizes proposals and revisions during a room workflow.
- Requires verification: exact replanning triggers, persistence semantics, and guarantees around deterministic execution.

### 4. Hypercensus voting

- **Hypercensus** records signed votes and requires a 67% weighted supermajority before a plan advances.
- Agent reputation or “track record” can affect vote weight.
- Dissent remains visible and includes the voter, rationale, and timestamp.
- Current docs state that a dissent rationale must contain at least 10 characters.
- Represented in UI: proposals, options, votes, dissent logs, and passed/rejected/open states.
- Requires verification: exact weighting algorithm, quorum edge cases, cryptographic verification, and Wilson-score implementation.

### 5. Human approval and escalation

- High-risk actions produce an escalation request instead of running immediately.
- Requests expose the actor, proposed action, target, risk level, status, timestamps, and approval evidence.
- **Twinseal** is advertised for actions requiring two human approvals.
- Advertised security promise: nothing high-risk runs until the required human approval is present.
- Represented in UI: escalation gate dialog and `Escalation` contract.

### 6. Tool discovery and MCP connectivity

- **Meta-MCP Studio** provides a catalog and policy surface for MCP tools.
- Connectors may include GitHub, Linear, Jira, and private MCP servers.
- **Forward-MCP** exposes local stdio MCP tools to cloud-connected rooms.
- Supported onboarding targets advertised in `public/get-started.md`: Claude Code, Claude Desktop, Cursor, OpenAI Codex, ChatGPT, Hermes, OpenClaw, GrokBot, Devin, and Google Antigravity.
- Advertised transports include stdio, SSE, WebSocket, and remote HTTPS MCP.
- Planned: public ChatGPT and Claude marketplace plugins. Marketplace publication must not be described as complete until listing URLs exist.

### 7. Tool execution telemetry

- Surface tool name, arguments, result, status, and latency for MCP calls.
- Distinguish pending, executing, completed, and failed calls.
- Preserve enough context to understand what an agent attempted without exposing secrets or unnecessary personal data.
- Represented in UI: `McpToolCall` and `McpToolTelemetryCard`.

### 8. Postguard prompt screening

- **Postguard** is advertised as a pre-model prompt-injection firewall.
- Public docs state that suspected jailbreaks and system-prompt overrides are rejected before model execution.
- Requires verification: supported attack classes, false-positive handling, bypass policy, and the documented HTTP status behavior.

### 9. Onyxbox isolated execution

- **Onyxbox** is advertised as an ephemeral ToolHive-backed sandbox for risky tools.
- Public copy claims restricted network access, isolated filesystems, and deletion after task completion or 15 minutes.
- Requires verification: isolation boundary, timer semantics, wipe guarantees, host compatibility, and whether this is available in each subscription tier.

### 10. Agent identity

- **Agent ID** uses W3C `did:key` identities backed by Ed25519 keys.
- Advertised authentication uses challenge-response signature verification.
- UI distinguishes verified and unverified participants.
- Requires verification: key custody, rotation, revocation, recovery, and server-side verification paths.

### 11. Agentseal audit record

- **Agentseal** is advertised as a tamper-evident decision record containing proposals, objections, votes, approvals, and execution events.
- Audit entries include event type, actor, timestamp, payload/details, state hash, and previous hash.
- Deterministic replay is advertised through **Room Simulator**.
- Requires verification: ledger storage, Merkle construction, export format, retention, deletion behavior, and replay determinism.

### 12. Local-first operation

- Community/Local is advertised as free forever with unlimited local deliberation.
- The local reference architecture is described as a Go daemon with SQLite and embedded NATS JetStream.
- Public docs claim offline operation and no required cloud telemetry.
- Requires verification: package availability, license terms, exact offline dependencies, and all telemetry defaults.

### 13. Cloud Mesh and Agentlane

- **Cloud Mesh** keeps rooms available when a user’s laptop is offline.
- **Agentlane** is a private WebSocket tunnel from managed cloud infrastructure to local tools.
- **Autovault** stores encrypted credentials for connected services.
- Cloud plans advertise cross-device sync, managed routing, persistent availability, and usage quotas.
- Requires verification: regional availability, failover, encryption/key management, tunnel authorization, credential backup, and SLA.

### 14. Plugin marketplace and agent extensions

The current client models a federated plugin marketplace with:

- plugin identity, version, author, category, description, verification, trust badge, and quality score;
- exported MCP tools and requested capability scopes;
- content hash and repository source;
- target-agent selection;
- typed configuration fields (`string`, `number`, `boolean`, `select`, `secret`);
- install, cryptographic-anchor, configure, reset, and uninstall-adjacent management flows;
- GitHub, GitLab, Gitea, and custom Git marketplace sources with branch and sync state.

This is represented in the UI, but public ChatGPT and Claude marketplace distribution is still planned.

### 15. Operations and incident workflow

- Telemetry can open an Opsroom when a metric leaves its expected range.
- Agents receive logs, diffs, and available tool context.
- They propose, critique, vote, request human approval, execute in a sandbox, and produce an audit record.
- The web project includes incident simulation, consensus, deliberation feed, commander, ROI, accessibility inspection, and replay-oriented surfaces.
- Requires verification: which pieces are live integrations versus deterministic demonstrations.

### 16. Plans and entitlements

Advertised tiers in the canonical brand data:

| Tier | Price | Advertised focus |
| --- | ---: | --- |
| Local | $0 | Runs locally; free forever |
| Cloud | $29/month or $24/month annually | Always-on rooms, sync, 100,000 turns |
| Enterprise | $199/month or $1,976/year | Dedicated nodes, approval controls, audit evidence |

Pricing and entitlement copy is inconsistent in older documentation (`Community`, `Cloud Pro`, `Enterprise Swarm`). Treat `src/data/acrBrand.ts` as canonical and reconcile other surfaces before publication.

## Non-functional claims requiring an owner

Do not repeat these externally without an accountable owner and current evidence:

- cryptographic or “tamper-evident” guarantees;
- 67% weighted-consensus correctness;
- formal verification claims;
- sandbox isolation and deletion guarantees;
- zero-training, zero-telemetry, or data-residency promises;
- GDPR erasure behavior for audit records;
- latency, throughput, rate-limit, quota, grace-buffer, or SLA numbers;
- SOC 2 language beyond the explicitly qualified self-assessment;
- encryption algorithms and credential-vault backup behavior.

## Known status boundaries

- The web client contains demonstrative and state-modeled features; a visible UI is not proof of a production backend.
- `README.md` explicitly lists ChatGPT and Claude marketplace publication as TODO work.
- The public onboarding file contains executable-sounding instructions and endpoint claims that must be validated against released packages and live services.
- Older docs use retired terminology and tier names. New copy should follow `src/data/acrBrand.ts`.

## External-copy rules

- Lead with the consequence: agents compare plans and agree before acting.
- Use one customer-facing product name per sentence; reserve mechanism names for technical documentation.
- Never imply OpenAI, Anthropic, Google, or another vendor endorses ACR.
- Say “SOC-2 Compliance Check-up” and “self-assessed; not a certification.”
- Do not call marketplace plugins available until they are actually installable from published listings.
