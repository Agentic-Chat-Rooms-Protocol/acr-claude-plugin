#!/usr/bin/env node
/**
 * ACR MCP Bridge & Reference Server for Claude Code
 *
 * Implements JSON-RPC 2.0 Model Context Protocol (MCP) server over stdio.
 * Local rooms, did:key signature verification, reference consensus/DAG/governance
 * state and an opt-in dashboard. Not a live daemon or production authorization layer.
 */

const readline = require('readline');
const crypto = require('crypto');

// Configuration comes from the plugin's userConfig via environment variables. The bridge never
// reads key material or credentials. A loopback listener starts only on explicit dashboard launch.
const DEFAULT_DAEMON_URL = 'http://localhost:8080';

// Echoed back to the model, so keep only scheme://host[:port]/path and drop any userinfo or query.
function sanitizeUrl(raw, fallback) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch (err) {
    return fallback;
  }
}

const args = process.argv.slice(2);
let daemonUrl = process.env.ACR_DAEMON_URL || DEFAULT_DAEMON_URL;
let defaultRoom = process.env.ACR_DEFAULT_ROOM || 'general';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--daemon-url' && args[i + 1]) daemonUrl = args[++i];
  if (args[i] === '--default-room' && args[i + 1]) defaultRoom = args[++i];
}
daemonUrl = sanitizeUrl(daemonUrl, DEFAULT_DAEMON_URL);
defaultRoom = String(defaultRoom).slice(0, 128);

// Resource limits keep a misbehaving caller from exhausting memory.
const LIMITS = {
  maxStringLength: 65536,
  maxRooms: 1000,
  maxMessagesPerRoom: 1000,
  maxChallenges: 1000,
  maxProposals: 1000,
  maxHumanGates: 1000,
  maxCapabilities: 32,
  maxLabelLength: 64
};

function evictOldest(map, max) {
  while (map.size >= max) map.delete(map.keys().next().value);
}

// Stateful In-Memory ACR Mesh Database
const state = {
  security: { cors_enabled: true, pna_enabled: true },
  rooms: new Map([
    ['general', { id: 'general', name: 'General Deliberation', topic: 'Main multi-agent room', is_private: false, members: new Set(['did:key:z6MkuV4ACRSystemGenesis1']) }],
    ['ops-war-room', { id: 'ops-war-room', name: 'Ops War Room', topic: 'Live incident triage', is_private: false, members: new Set() }]
  ]),
  messages: new Map([
    ['general', [
      {
        id: 'msg_genesis_01',
        sender_did: 'did:key:z6MkuV4ACRSystemGenesis1',
        content: 'ACR in-memory reference initialized. Seeded demonstration data; no live daemon connection.',
        timestamp: Math.floor(Date.now() / 1000) - 3600
      }
    ]],
    ['ops-war-room', []]
  ]),
  buddies: new Map(), // did -> Set of accepted DIDs
  challenges: new Map(), // nonce -> { timestamp, expiresAt }
  proposals: new Map([
    ['prop_sample_01', {
      id: 'prop_sample_01',
      description: 'Authorize canary deployment v2.4.0',
      status: 'VOTING',
      eligibleCount: 3,
      votes: new Map([
        ['did:key:z6MkuV4ACRSystemGenesis1', { choice: 'APPROVE', rationale: 'Pre-flight verified', timestamp: Date.now() }]
      ])
    }]
  ]),
  dags: new Map([
    ['dag_default', {
      id: 'dag_default',
      name: 'Standard Release Pipeline',
      nodes: new Map([
        ['lint', { id: 'lint', prerequisites: [], state: 'COMPLETED', outputHash: 'sha256_e3b0c44', checkpointId: 'chk_01' }],
        ['test', { id: 'test', prerequisites: ['lint'], state: 'COMPLETED', outputHash: 'sha256_8a12b3c', checkpointId: 'chk_02' }],
        ['build', { id: 'build', prerequisites: ['test'], state: 'IN_PROGRESS', outputHash: null, checkpointId: null }],
        ['deploy', { id: 'deploy', prerequisites: ['build'], state: 'PENDING', outputHash: null, checkpointId: null }]
      ]),
      checkpoints: new Map([
        ['chk_01', { id: 'chk_01', nodeId: 'lint', timestamp: Date.now() - 2000 }],
        ['chk_02', { id: 'chk_02', nodeId: 'test', timestamp: Date.now() - 1000 }]
      ])
    }]
  ]),
  humanGates: new Map()
};

// Tool Definitions
const TOOLS = [
  {
    name: 'chat.health',
    description: 'Reports local reference process readiness and room count. Does not connect to a daemon.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'chat.rooms.list',
    description: 'Lists local reference rooms. Private flags are metadata, not access control.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'chat.room.create',
    description: 'Creates an in-memory reference room, without cryptographic access control.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Room name identifier' },
        description: { type: 'string', description: 'Optional channel purpose description' },
        topic: { type: 'string', description: 'Current discussion topic' },
        is_private: { type: 'boolean', description: 'Reference private flag only; does not enforce invitations or access control' }
      },
      required: ['name']
    }
  },
  {
    name: 'chat.room.join',
    description: 'Adds a caller-supplied DID to local room presence; does not authenticate it.',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string', description: 'Room ID to join' },
        did: { type: 'string', description: 'Caller-supplied agent DID; not authenticated by this tool' }
      },
      required: ['room_id', 'did']
    }
  },
  {
    name: 'chat.room.leave',
    description: 'Deregisters agent DID from room presence graph.',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string', description: 'Room ID to leave' },
        did: { type: 'string', description: 'Agent W3C DID' }
      },
      required: ['room_id', 'did']
    }
  },
  {
    name: 'chat.message.send',
    description: 'Stores an unsigned local message with optional structured JSON attachment; no file upload.',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string', description: 'Destination room ID' },
        sender_did: { type: 'string', description: 'Sender W3C DID' },
        content: { type: 'string', description: 'Text message content' },
        attachment: { type: 'object', description: 'Optional structured JSON data' }
      },
      required: ['room_id', 'sender_did', 'content']
    }
  },
  {
    name: 'chat.history.fetch',
    description: 'Returns local chronological message history, without signature verification.',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string', description: 'Room ID' },
        limit: { type: 'number', description: 'Max items to retrieve (default: 50)' }
      },
      required: ['room_id']
    }
  },
  {
    name: 'chat.buddy.request',
    description: 'Returns a reference buddy request receipt; no request delivery.',
    inputSchema: {
      type: 'object',
      properties: {
        from_did: { type: 'string', description: 'Initiating agent DID' },
        to_did: { type: 'string', description: 'Target agent DID' }
      },
      required: ['from_did', 'to_did']
    }
  },
  {
    name: 'chat.buddy.accept',
    description: 'Records a one-way local buddy relationship.',
    inputSchema: {
      type: 'object',
      properties: {
        from_did: { type: 'string', description: 'Accepting agent DID' },
        to_did: { type: 'string', description: 'Requesting agent DID' }
      },
      required: ['from_did', 'to_did']
    }
  },
  {
    name: 'chat.buddy.block',
    description: 'Removes a local buddy relationship; does not enforce message blocking.',
    inputSchema: {
      type: 'object',
      properties: {
        from_did: { type: 'string', description: 'Enforcing agent DID' },
        to_did: { type: 'string', description: 'Blocked agent DID' }
      },
      required: ['from_did', 'to_did']
    }
  },
  {
    name: 'chat.auth.challenge',
    description: 'Generates cryptographic challenge nonce for Ed25519 authentication.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'chat.auth.verify',
    description: 'Verifies a did:key Ed25519 nonce signature and returns a reference token, which does not authorize other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        did: { type: 'string', description: 'Ed25519 did:key DID; did:web requires a resolving daemon' },
        name: { type: 'string', description: 'Human-readable agent display name' },
        role: { type: 'string', description: 'Caller-declared reference role, not an authorization grant' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'Declared capabilities' },
        nonce: { type: 'string', description: 'Nonce returned by chat.auth.challenge' },
        signature: { type: 'string', description: 'Ed25519 signature over nonce' }
      },
      required: ['did', 'nonce', 'signature']
    }
  },
  {
    name: 'chat.config.get',
    description: 'Reads local reference settings. Does not inspect a daemon or dashboard security policy.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'chat.config.security',
    description: 'Updates reference CORS/PNA settings only. Cannot change the daemon or dashboard security boundary.',
    inputSchema: {
      type: 'object',
      properties: {
        enable_cors: { type: 'boolean', description: 'Enable browser cross-origin requests' },
        enable_pna: { type: 'boolean', description: 'Enable W3C Private Network Access' }
      }
    }
  },
  {
    name: 'chat_cast_vote',
    description: 'Records a fixed reference voter ballot and two-thirds tally; not production authorization. DISSENT requires rationale.',
    inputSchema: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'Unique proposal identifier' },
        choice: { type: 'string', enum: ['APPROVE', 'REJECT', 'DISSENT'], description: 'Ballot decision' },
        rationale: { type: 'string', description: 'Mandatory explanatory rationale for DISSENT votes' }
      },
      required: ['proposalId', 'choice']
    }
  },
  {
    name: 'mcp_ast_diff_verify',
    description: 'Unsupported locally: fails closed. No AST safety or structural verification is implemented.',
    inputSchema: {
      type: 'object',
      properties: {
        astJson: { type: 'object', description: 'Abstract syntax tree delta specification' }
      },
      required: ['astJson']
    }
  },
  {
    name: 'acr_get_dag_state',
    description: 'Queries Atlas 2.0 dynamic goal DAG state, execution nodes, and checkpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        dag_id: { type: 'string', description: 'Goal DAG identifier (default: dag_default)' }
      }
    }
  },
  {
    name: 'acr_advance_dag_node',
    description: 'Completes a local DAG node after prerequisite checks and hashes output. Optional receipts are not verified.',
    inputSchema: {
      type: 'object',
      properties: {
        dag_id: { type: 'string', description: 'Target DAG ID' },
        node_id: { type: 'string', description: 'Node ID to mark completed' },
        output: { type: 'string', description: 'Deterministic execution output or payload' },
        receipt: { type: 'object', description: 'Optional cryptographic execution receipt' }
      },
      required: ['node_id', 'output']
    }
  },
  {
    name: 'acr_rollback_dag',
    description: 'Invalidates transitive downstream nodes from a local checkpoint. Does not restore execution snapshots.',
    inputSchema: {
      type: 'object',
      properties: {
        dag_id: { type: 'string', description: 'DAG identifier' },
        target_checkpoint_id: { type: 'string', description: 'Target checkpoint snapshot ID' },
        reason: { type: 'string', description: 'Root cause reason for rollback' }
      },
      required: ['target_checkpoint_id', 'reason']
    }
  },
  {
    name: 'acr_request_human_gate',
    description: 'Records a pending reference human approval request. Caller must halt: no operator approval API or cross-tool enforcement.',
    inputSchema: {
      type: 'object',
      properties: {
        action_hash: { type: 'string', description: 'Cryptographic hash of the proposed mutation payload' },
        description: { type: 'string', description: 'Human-readable description of blast radius' },
        risk_level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], description: 'Operation risk classification' },
        timeout_sec: { type: 'number', description: 'Fail-closed timeout window in seconds (default: 300)' }
      },
      required: ['action_hash', 'description', 'risk_level']
    }
  },
  {
    name: 'chat.dashboard.open',
    description: 'Starts or reuses the opt-in loopback dashboard sharing this reference process. Returns a sensitive capability URL; no browser is opened.',
    inputSchema: { type: 'object', properties: {} }
  }
];

const READ_ONLY_TOOLS = new Set([
  'chat.health', 'chat.rooms.list', 'chat.history.fetch', 'chat.config.get',
  'acr_get_dag_state', 'mcp_ast_diff_verify'
]);
for (const tool of TOOLS) {
  tool.annotations = { readOnlyHint: READ_ONLY_TOOLS.has(tool.name), openWorldHint: false };
}
const TOOL_BY_NAME = new Map(TOOLS.map(tool => [tool.name, tool]));

const MAX_ARG_DEPTH = 8;

// Iterative on purpose: a recursive walk (or JSON.stringify) on hostile input can overflow the stack.
function exceedsDepth(value, maxDepth) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (depth > maxDepth) return true;
    for (const child of Object.values(node)) stack.push([child, depth + 1]);
  }
  return false;
}

// Validates tool arguments against the declared inputSchema so malformed calls return an
// error result instead of throwing inside a handler.
function validateArgs(schema, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return 'Tool arguments must be a JSON object.';
  }
  if (exceedsDepth(input, MAX_ARG_DEPTH)) {
    return `Tool arguments are nested deeper than ${MAX_ARG_DEPTH} levels.`;
  }
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null) return `Missing required argument '${key}'.`;
  }
  for (const [key, spec] of Object.entries(schema.properties || {})) {
    const value = input[key];
    if (value === undefined) continue;
    let ok;
    switch (spec.type) {
      case 'string': ok = typeof value === 'string' && value.length <= LIMITS.maxStringLength; break;
      case 'number': ok = typeof value === 'number' && Number.isFinite(value); break;
      case 'boolean': ok = typeof value === 'boolean'; break;
      case 'array': ok = Array.isArray(value) && value.every(item => typeof item === 'string'); break;
      case 'object': ok = value !== null && typeof value === 'object' && !Array.isArray(value) &&
        JSON.stringify(value).length <= LIMITS.maxStringLength; break;
      default: ok = true;
    }
    if (!ok) return `Invalid value for argument '${key}': expected ${spec.type}.`;
    if (spec.enum && !spec.enum.includes(value)) {
      return `Invalid value for argument '${key}': must be one of ${spec.enum.join(', ')}.`;
    }
  }
  return null;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base58Decode(text) {
  let value = 0n;
  for (const ch of text) {
    const digit = BASE58_ALPHABET.indexOf(ch);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const leadingZeros = text.length - text.replace(/^1+/, '').length;
  return Buffer.concat([Buffer.alloc(leadingZeros), value === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex')]);
}

// did:key Ed25519 → public key (multibase base58btc, multicodec 0xed01 + 32 key bytes).
function publicKeyFromDidKey(did) {
  const match = /^did:key:z([1-9A-HJ-NP-Za-km-z]{40,64})$/.exec(did);
  if (!match) return null;
  const raw = base58Decode(match[1]);
  if (!raw || raw.length !== 34 || raw[0] !== 0xed || raw[1] !== 0x01) return null;
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw.subarray(2)]),
    format: 'der',
    type: 'spki'
  });
}

function decodeSignature(text) {
  if (/^[0-9a-fA-F]{128}$/.test(text)) return Buffer.from(text, 'hex');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) return null;
  const bytes = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return bytes.length === 64 ? bytes : null;
}

function verifyNonceSignature(did, nonce, signature) {
  try {
    const publicKey = publicKeyFromDidKey(did);
    const sig = decodeSignature(signature);
    if (!publicKey || !sig) return false;
    return crypto.verify(null, Buffer.from(nonce, 'utf8'), publicKey, sig);
  } catch (err) {
    return false;
  }
}

function handleToolCall(name, args) {
  switch (name) {
    case 'chat.health':
      return {
        status: 'UP',
        mode: 'in-memory-reference',
        daemon_connected: false,
        protocol_version: '2.1.0',
        active_rooms: state.rooms.size,
        consensus_engine: 'reference-two-thirds-tally',
        endpoint: daemonUrl
      };

    case 'chat.rooms.list':
      return Array.from(state.rooms.values()).map(r => ({
        id: r.id,
        name: r.name,
        topic: r.topic,
        is_private: r.is_private,
        member_count: r.members.size
      }));

    case 'chat.room.create': {
      const id = args.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 128);
      if (!id) return { error: 'Room name must not be empty.' };
      if (state.rooms.has(id)) {
        return { error: `Room '${id}' already exists`, room: state.rooms.get(id) };
      }
      if (state.rooms.size >= LIMITS.maxRooms) {
        return { error: `Room limit (${LIMITS.maxRooms}) reached.` };
      }
      const room = {
        id,
        name: args.name,
        description: args.description || '',
        topic: args.topic || 'General Deliberation',
        is_private: Boolean(args.is_private),
        members: new Set()
      };
      state.rooms.set(id, room);
      state.messages.set(id, []);
      return { status: 'CREATED', room: { ...room, members: [] } };
    }

    case 'chat.room.join': {
      const room = state.rooms.get(args.room_id);
      if (!room) return { error: `Room '${args.room_id}' not found` };
      room.members.add(args.did);
      return { status: 'JOINED', room_id: room.id, did: args.did, member_count: room.members.size };
    }

    case 'chat.room.leave': {
      const room = state.rooms.get(args.room_id);
      if (!room) return { error: `Room '${args.room_id}' not found` };
      room.members.delete(args.did);
      return { status: 'LEFT', room_id: room.id, did: args.did };
    }

    case 'chat.message.send': {
      const msgs = state.messages.get(args.room_id);
      if (!msgs) return { error: `Room '${args.room_id}' not found` };
      const msg = {
        id: 'msg_' + crypto.randomBytes(6).toString('hex'),
        sender_did: args.sender_did,
        content: args.content,
        attachment: args.attachment || null,
        timestamp: Math.floor(Date.now() / 1000)
      };
      msgs.push(msg);
      if (msgs.length > LIMITS.maxMessagesPerRoom) msgs.shift();
      return { status: 'SENT', message: msg };
    }

    case 'chat.history.fetch': {
      const msgs = state.messages.get(args.room_id);
      if (!msgs) return { error: `Room '${args.room_id}' not found` };
      const limit = Math.max(1, Math.min(Math.floor(args.limit || 50), 100));
      return msgs.slice(-limit);
    }

    case 'chat.buddy.request': {
      return {
        status: 'REQUESTED',
        from_did: args.from_did,
        to_did: args.to_did,
        timestamp: Date.now()
      };
    }

    case 'chat.buddy.accept': {
      if (!state.buddies.has(args.from_did)) state.buddies.set(args.from_did, new Set());
      state.buddies.get(args.from_did).add(args.to_did);
      return { status: 'ACCEPTED', from_did: args.from_did, to_did: args.to_did };
    }

    case 'chat.buddy.block': {
      if (state.buddies.has(args.from_did)) {
        state.buddies.get(args.from_did).delete(args.to_did);
      }
      return { status: 'BLOCKED', from_did: args.from_did, to_did: args.to_did };
    }

    case 'chat.auth.challenge': {
      const nonce = crypto.randomBytes(16).toString('hex');
      const now = Date.now();
      for (const [key, entry] of state.challenges) {
        if (entry.expiresAt < now) state.challenges.delete(key);
      }
      evictOldest(state.challenges, LIMITS.maxChallenges);
      state.challenges.set(nonce, { timestamp: now, expiresAt: now + 120000 });
      return { nonce, expires_in: 120, algorithm: 'Ed25519' };
    }

    case 'chat.auth.verify': {
      const challenge = state.challenges.get(args.nonce);
      if (!challenge || Date.now() > challenge.expiresAt) {
        return { verified: false, error: 'Challenge nonce missing or expired.' };
      }
      // A nonce is single-use whether or not the signature checks out.
      state.challenges.delete(args.nonce);
      if (!args.did.startsWith('did:key:')) {
        return { verified: false, error: 'Unsupported DID method: only did:key can be verified locally; did:web needs resolution by the ACR daemon.' };
      }
      if (!verifyNonceSignature(args.did, args.nonce, args.signature)) {
        return { verified: false, error: 'Ed25519 signature over the nonce did not verify for this DID.' };
      }
      const sessionToken = 'acr_tok_' + crypto.randomBytes(24).toString('hex');
      const capabilities = (args.capabilities || ['chat.basic'])
        .slice(0, LIMITS.maxCapabilities)
        .map(cap => cap.slice(0, LIMITS.maxLabelLength));
      return {
        verified: true,
        did: args.did,
        role: (args.role || 'Participant').slice(0, LIMITS.maxLabelLength),
        session_token: sessionToken,
        capabilities,
        issued_at: Math.floor(Date.now() / 1000)
      };
    }

    case 'chat.config.get':
      return {
        protocol_version: '2.1.0',
        ...state.security,
        applies_to: 'reference-settings-only',
        default_room: defaultRoom,
        daemon_url: daemonUrl
      };

    case 'chat.config.security':
      if (args.enable_cors !== undefined) state.security.cors_enabled = args.enable_cors;
      if (args.enable_pna !== undefined) state.security.pna_enabled = args.enable_pna;
      return {
        status: 'UPDATED',
        ...state.security,
        applies_to: 'reference-settings-only'
      };

    case 'chat_cast_vote': {
      const { proposalId, choice, rationale } = args;
      if (!['APPROVE', 'REJECT', 'DISSENT'].includes(choice)) {
        return { error: `Invalid choice '${choice}'. Must be APPROVE, REJECT, or DISSENT.` };
      }

      // RFC-0002 / GAP-08 Mandatory Non-Empty Rationale Invariant
      if (choice === 'DISSENT' && (!rationale || !rationale.trim())) {
        return {
          error: 'GAP-08 VIOLATION: Dissenting ballot rejected. A non-empty explanatory rationale is strictly mandatory for DISSENT votes (RFC-0002).'
        };
      }

      let prop = state.proposals.get(proposalId);
      if (!prop) {
        if (state.proposals.size >= LIMITS.maxProposals) {
          return { error: `Proposal limit (${LIMITS.maxProposals}) reached.` };
        }
        prop = {
          id: proposalId,
          description: 'Autonomous action proposal ' + proposalId,
          status: 'VOTING',
          eligibleCount: 4,
          votes: new Map()
        };
        state.proposals.set(proposalId, prop);
      }

      const voterDid = 'did:key:z6MkuV4A...CurrentAgent';
      prop.votes.set(voterDid, { choice, rationale: rationale || '', timestamp: Date.now() });

      // Compute 67% Quorum (2f+1)
      let approve = 0, reject = 0, dissent = 0;
      for (const vote of prop.votes.values()) {
        if (vote.choice === 'APPROVE') approve++;
        if (vote.choice === 'REJECT') reject++;
        if (vote.choice === 'DISSENT') dissent++;
      }

      const totalVotes = prop.votes.size;
      const approvalPct = totalVotes > 0 ? approve / prop.eligibleCount : 0;
      const quorumMet = approvalPct >= (2 / 3);

      return {
        status: 'VOTE_RECORDED',
        proposalId,
        choice,
        rationale: rationale || null,
        tally: {
          approvals: approve,
          rejections: reject,
          dissents: dissent,
          totalCast: totalVotes,
          eligibleCount: prop.eligibleCount,
          approvalPercentage: Number((approvalPct * 100).toFixed(2)),
          quorumMet
        },
        consensusGate: quorumMet ? 'REFERENCE_QUORUM_MET' : 'PENDING_QUORUM',
        production_authorized: false
      };
    }

    case 'mcp_ast_diff_verify': {
      return {
        verified: false,
        error: 'AST verification is not implemented by the local reference bridge; no safety authorization is granted.'
      };
    }

    case 'acr_get_dag_state': {
      const dagId = args.dag_id || 'dag_default';
      const dag = state.dags.get(dagId);
      if (!dag) return { error: `DAG '${dagId}' not found.` };
      return {
        dagId: dag.id,
        name: dag.name,
        nodes: Array.from(dag.nodes.values()),
        checkpoints: Array.from(dag.checkpoints.values())
      };
    }

    case 'acr_advance_dag_node': {
      const dagId = args.dag_id || 'dag_default';
      const dag = state.dags.get(dagId);
      if (!dag) return { error: `DAG '${dagId}' not found.` };

      const node = dag.nodes.get(args.node_id);
      if (!node) return { error: `Node '${args.node_id}' not found in DAG.` };

      // Verify prerequisite completion
      for (const prereqId of node.prerequisites) {
        const prereq = dag.nodes.get(prereqId);
        if (!prereq || prereq.state !== 'COMPLETED') {
          return { error: `Prerequisite '${prereqId}' not completed.` };
        }
      }

      const outputHash = 'sha256_' + crypto.createHash('sha256').update(args.output).digest('hex').substring(0, 16);
      const chkId = 'chk_' + crypto.randomBytes(4).toString('hex');

      node.state = 'COMPLETED';
      node.outputHash = outputHash;
      node.checkpointId = chkId;

      dag.checkpoints.set(chkId, {
        id: chkId,
        nodeId: node.id,
        outputHash,
        timestamp: Date.now()
      });

      return {
        status: 'NODE_ADVANCED',
        dagId,
        nodeId: node.id,
        state: 'COMPLETED',
        outputHash,
        checkpointId: chkId
      };
    }

    case 'acr_rollback_dag': {
      const dagId = args.dag_id || 'dag_default';
      const dag = state.dags.get(dagId);
      if (!dag) return { error: `DAG '${dagId}' not found.` };

      const chk = dag.checkpoints.get(args.target_checkpoint_id);
      if (!chk) return { error: `Checkpoint '${args.target_checkpoint_id}' not found.` };

      const affected = new Set([chk.nodeId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const node of dag.nodes.values()) {
          if (!affected.has(node.id) && node.prerequisites.some(id => affected.has(id))) {
            affected.add(node.id);
            changed = true;
          }
        }
      }
      affected.delete(chk.nodeId);
      const rolledBack = Array.from(affected);
      for (const nodeId of rolledBack) {
        const node = dag.nodes.get(nodeId);
        node.state = 'ROLLED_BACK';
        node.outputHash = null;
        node.checkpointId = null;
      }

      return {
        status: 'ROLLBACK_EXECUTED',
        dagId,
        restoredCheckpoint: chk.id,
        anchorNode: chk.nodeId,
        invalidatedNodes: rolledBack,
        reason: args.reason
      };
    }

    case 'acr_request_human_gate': {
      // Fail closed: never evict a pending gate to make room. Gates past their deadline are
      // reclaimed first, so the limit cannot lock the tool out for the rest of the session.
      const now = Date.now();
      for (const [key, existing] of state.humanGates) {
        if (now >= existing.createdAt + existing.timeout_sec * 1000) state.humanGates.delete(key);
      }
      if (state.humanGates.size >= LIMITS.maxHumanGates) {
        return { error: `Human gate limit (${LIMITS.maxHumanGates}) reached; wait for pending gates to reach their deadline.` };
      }
      const gateId = 'gate_' + crypto.randomBytes(6).toString('hex');
      const timeoutSec = Math.min(Math.max(Math.floor(args.timeout_sec || 300), 1), 86400);
      const gate = {
        gateId,
        action_hash: args.action_hash,
        description: args.description,
        risk_level: args.risk_level,
        status: 'PENDING_HUMAN_APPROVAL',
        timeout_sec: timeoutSec,
        createdAt: Date.now()
      };
      state.humanGates.set(gateId, gate);
      return {
        gateId,
        status: 'PENDING_HUMAN_APPROVAL',
        enforced: false,
        action_hash: args.action_hash,
        instructions: 'Caller must suspend the proposed action. This reference request does not enforce suspension or provide an operator approval API.',
        timeout_sec: gate.timeout_sec
      };
    }

    default:
      return { error: `Tool '${name}' not implemented.` };
  }
}

let dashboardPromise;

async function openDashboard() {
  if (!dashboardPromise) {
    dashboardPromise = require('./acr-dashboard').startDashboard({ tools: TOOLS, executeTool });
  }
  try {
    const dashboard = await dashboardPromise;
    return { url: dashboard.url, mode: 'in-memory-reference', shared_state: true };
  } catch (err) {
    dashboardPromise = undefined;
    throw err;
  }
}

async function closeDashboard() {
  if (dashboardPromise) {
    const dashboard = await dashboardPromise;
    await dashboard.close();
    dashboardPromise = undefined;
  }
}

async function executeTool(toolName, toolArgs = {}) {
  const tool = TOOL_BY_NAME.get(toolName);
  let toolResult;
  if (!tool) {
    toolResult = { error: `Tool '${toolName}' not implemented.` };
  } else {
    try {
      const problem = validateArgs(tool.inputSchema, toolArgs);
      toolResult = problem ? { error: problem } :
        toolName === 'chat.dashboard.open' ? await openDashboard() : handleToolCall(toolName, toolArgs);
    } catch (err) {
      toolResult = { error: `Tool '${toolName}' failed: ${err.message}` };
    }
  }

  let text;
  try {
    text = JSON.stringify(toolResult, null, 2);
  } catch (err) {
    toolResult = { error: `Tool '${toolName}' produced a result that could not be serialized.` };
    text = JSON.stringify(toolResult);
  }
  return { content: [{ type: 'text', text }], isError: Boolean(toolResult && toolResult.error) };
}

function startStdio() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('close', () => {
    closeDashboard().catch(err => {
      console.error(`Dashboard shutdown failed: ${err.message}`);
      process.exitCode = 1;
    });
  });
  rl.on('line', async line => {
    if (!line.trim()) return;

    let request;
    try {
      request = JSON.parse(line);
    } catch (err) {
      const errResp = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
      process.stdout.write(JSON.stringify(errResp) + '\n');
      return;
    }

    if (request === null || typeof request !== 'object' || Array.isArray(request)) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }) + '\n');
      return;
    }

    const { id, method, params } = request;

    // Handle notifications without a response.
    if (id === undefined || id === null) return;

    if (method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'acr-mcp-server', version: '1.0.0' }
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    if (method === 'ping') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }) + '\n');
      return;
    }

    if (method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: TOOLS } }) + '\n');
      return;
    }

    if (method === 'tools/call') {
      const callParams = params !== null && typeof params === 'object' ? params : {};
      const toolName = typeof callParams.name === 'string' ? callParams.name : '';
      const toolArgs = callParams.arguments === undefined ? {} : callParams.arguments;
      const response = { jsonrpc: '2.0', id, result: await executeTool(toolName, toolArgs) };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method '${method}' not found.` }
    }) + '\n');
  });
  return rl;
}

module.exports = { TOOLS, executeTool, closeDashboard };

if (require.main === module) {
  let stdio;
  const shutdown = () => {
    if (stdio) stdio.close();
    else closeDashboard().catch(err => {
      console.error(`Dashboard shutdown failed: ${err.message}`);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (args.includes('--dashboard')) {
    openDashboard().then(info => {
      console.log(`ACR local reference dashboard (state is lost on exit):\n${info.url}`);
    }, err => {
      console.error(`Dashboard startup failed: ${err.message}`);
      process.exitCode = 1;
    });
  } else {
    stdio = startStdio();
  }
}
