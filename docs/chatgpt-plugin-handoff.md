# Dev handoff: applying the Claude plugin store hardening to `acr-chatgpt-plugin`

Audience: the engineer who owns [`acr-chatgpt-plugin`](https://github.com/Agentic-Chat-Rooms-Protocol/acr-chatgpt-plugin).
Source of lessons: this repository, rounds 1–2 of Anthropic Plugin Store preparation (PR #1 and the round-2 hardening PR).
Reviewed: `acr-chatgpt-plugin` at commit `5b6b230`. Nothing in that repo was executed; it was read only.

> **Limits of this guide.** The Anthropic validator's rules are known from its output. OpenAI's submission rules were
> **not** available for this review, so every item below marked *Confirm* needs a check against OpenAI's current
> plugin/app submission documentation before you act on it. Do not assume the Claude rules apply 1:1.

## 1. How the two plugins differ

| | Claude plugin (this repo) | ChatGPT plugin |
|---|---|---|
| Server | Local stdio bridge, `scripts/acr-mcp-bridge.js` | Remote gateway, `https://mcp.agentchatrooms.dev/mcp` (streamable-http) |
| Tools | 20 `chat.*` / `chat_*` / `acr_*` tools, in-memory | 15 `acr_*` tools served by the gateway |
| Cost | Free, local daemon | Cloud Pro / Enterprise, OAuth scopes `acr:rooms`, `acr:cloud:pro` |
| Manifest | `.claude-plugin/plugin.json`, `.mcp.json`, `hooks/hooks.json` | `plugin.json` (`extensions["com.openai"]`), `mcp.json`, `.app.json`, `agents/openai.yaml` |
| Tooling | CommonJS `.js`, no scripts shipped except the bridge and one shell hook | ESM `.mjs` scripts (`verify-plugin`, `bundle-submission`, `generate-assets`) and `node:test` |

**Do not port** (Claude-specific): the `${CLAUDE_PLUGIN_ROOT}` literal-path rule, `hooks/hooks.json` duplicate-entry rule,
`agents[]` ending in `.md`, `userConfig`, and the PostGuard shell hook (ChatGPT has no PreToolUse hook).

**Do port** (the underlying lessons): no committed build artifacts or "published" receipts, no credential reads in
shipped config, honest listing metadata, real icon/screenshot assets, input validation and signature checking in the
server, and tests that lock all of this in.

## 2. Findings in `acr-chatgpt-plugin`

| # | Finding | Evidence | Priority |
|---|---|---|---|
| F1 | Build artifact and "published" receipt are committed | `dist/acr-protocol-openai-plugin-v1.0.0.zip`, `publication-receipt.json` (`status: PUBLISHED_TO_REGISTRY`, a sha256 and a package path from another tree) | High |
| F2 | Listing metadata asserts unverified facts | `connector-listing.json`: `distribution.package`, `sizeBytes`, `domainVerification.status: VERIFIED` | High |
| F3 | Config reads an installer credential from the environment | `mcp.json` → `api_key_profile.env: "ACR_CLOUD_TOKEN"` | High |
| F4 | OAuth URLs look swapped | `mcp.json`: `client_url` = `.../authorize`, `authorization_url` = `.../token` | High (*Confirm*) |
| F5 | Placeholder assets | `assets/icon*.png` are 157-byte files; `logo*.png` 2,200 bytes; `screenshot-1/2.png` identical, 5,310 bytes; produced by `scripts/generate-assets.mjs` | High |
| F6 | Canvas app is a mock with no CSP | `web-ui/canvas-app.html`: inline `<script>`, `alert()`/`prompt()`, no bindings to `.app.json` | Medium |
| F7 | Every tool is annotated `destructiveHint: false` | 15/15 tools, including `acr_rotate_keys`, `acr_escalate_human_review`, `acr_update_goal_status`, `acr_cast_vote` | Medium (*Confirm*) |
| F8 | Hard-coded verification token and demo URL in the manifest | `plugin.json` → `domain_verification.token`, `demo_recording_url` | Medium |
| F9 | Package hygiene | `package.json` has `"main": "index.js"` (file does not exist); README tells users to run `npm run bundle` | Low |
| F10 | No tests that guard any of the above | `tests/plugin.test.mjs` checks structure only | Medium |

## 3. Step-by-step

Work on a branch (for example `chore/store-readiness-round-1`) and commit after each step.

### Step 1 — Remove committed artifacts (F1)

```bash
git rm dist/acr-protocol-openai-plugin-v1.0.0.zip publication-receipt.json
printf 'dist/\n' >> .gitignore
```

A receipt claiming publication belongs to the registry, not to source control, and a zip in the tree is an opaque
binary for any reviewer. If OpenAI requires a zip for submission, build it on demand from tracked files only:

```bash
mkdir -p dist && git archive --format=zip --prefix=acr-protocol-openai-plugin/ -o dist/acr-protocol-openai-plugin.zip HEAD
```

Then delete `scripts/bundle-submission.mjs` and the `bundle` script in `package.json`. In this repo the bundler was removed
for the same reason; it also removes a Node program that a reviewer would otherwise have to read.
**Verify:** `git ls-files | grep -E '\.(zip|tgz|gz)$|receipt'` prints nothing.

### Step 2 — Make `connector-listing.json` truthful (F2)

- Delete `distribution.package` and `distribution.sizeBytes` (they describe a file that no longer exists).
- Replace `domainVerification.status: "VERIFIED"` and any `submissionStatus`-style fields with `"PENDING"` until the
  registry actually confirms them. Never set success states by hand.
- Keep only facts a script can re-derive from the tree (tool count, skill count, paths).

**Verify:** every path named in the file exists (`node -e` is fine for a local one-off; put the check in Step 9's test).

### Step 3 — Remove the credential read (F3)

`mcp.json` tells the platform to read `ACR_CLOUD_TOKEN` from the installer's environment and send it as a bearer header.
That is the same credential-read-plus-send pattern the Anthropic validator held this plugin for in round 2. This plugin
resolved it by removing every credential read; it now accepts no key paths or secrets at all.

1. Delete the `api_key_profile` block. Rely on the interactive OAuth 2.1 flow, where ChatGPT stores and attaches the token.
2. If non-interactive / autonomous use is a real requirement, *Confirm* how OpenAI expects a user-supplied key to be
   declared (a connector setting the user types in, not an environment read) and document it in the README.
3. Never ship a token, even an example, in any manifest.

### Step 4 — Fix or confirm the OAuth fields (F4)

`client_url` pointing at `/authorize` and `authorization_url` pointing at `/token` look reversed.

1. Fetch the issuer metadata from `https://auth.agentchatrooms.dev/.well-known/oauth-authorization-server` (and the RFC 9728
   document at the `resource_metadata` URL) and read the real `authorization_endpoint` / `token_endpoint`.
2. *Confirm* in OpenAI's plugin schema what each field means, then set them to match.
3. `authorization_servers` lists a second entry, `https://mcp.agentchatrooms.dev/oauth`. Keep it only if that is a real issuer.
4. Run one end-to-end sign-in in a test workspace; a swapped URL fails at the first token exchange.

### Step 5 — Replace placeholder assets with the real logo kit (F5)

Source of truth: [`acr-logos`](https://github.com/Agentic-Chat-Rooms-Protocol/acr-logos).

1. Delete `scripts/generate-assets.mjs`; generated solid-colour PNGs must not ship.
2. Export `icon.png` / `icon-dark.png` (square) and `logo.png` / `logo-dark.png` from the kit. The light and dark files must
   differ; today they are byte-identical.
3. Capture real screenshots of the canvas and a deliberation room. `screenshot-1.png` and `screenshot-2.png` must differ.
4. *Confirm* OpenAI's required dimensions, format and size limits before exporting.
5. For reference, the Claude icon is a 1024×1024 RGBA PNG (about 127 KB) exported from the kit's `logo-alt-gradient.png`.
   Anthropic's limits are 512–2048 px square, PNG/JPEG, under 2 MB; SVG and WebP are rejected.

**Verify:** `file assets/*.png` shows plausible dimensions; `sha256sum assets/*.png` shows no duplicates.

### Step 6 — Review manifest fields that assert facts (F8)

- `domain_verification.token`: confirm that it is a public challenge value served from the site's `.well-known` path and not
  a secret. If it is a secret, rotate it and move it out of the repo.
- `demo_recording_url`: request it (`curl -sI <url>`) and keep it only if it returns 200. Otherwise remove the field.
- Keep `homepage`, `repository`, `license` and contact fields identical to `package.json` and the README.

### Step 7 — Harden the canvas app (F6)

`web-ui/canvas-app.html` is a visual mock.

1. Add a restrictive CSP in the document head, for example
   `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:">`,
   and move the inline `<script>` into `web-ui/canvas-app.js` so that `script-src 'self'` works. *Confirm* the host's required CSP and bridge API first.
2. Replace `alert()` / `prompt()` with in-page controls. Keep the rule that a DISSENT vote needs a non-empty rationale.
3. Render any room or user text with `textContent`, never `innerHTML`.
4. Wire the `.app.json` `bindings` (`onVoteCast`, `onNodeSelect`, …) to the host's tool-call bridge, or label the app as a
   preview in `description` so the listing does not over-promise.
5. No network calls from the canvas; all data comes through the host.

### Step 8 — Re-audit tool annotations (F7)

All 15 tools set `destructiveHint: false`. Reclassify state-changing, hard-to-reverse tools. At minimum review
`acr_rotate_keys` (identity change), `acr_escalate_human_review`, `acr_update_goal_status`, `acr_cast_vote` and
`acr_post_message` (published, signed content). Keep `readOnlyHint: true` only on pure reads
(`acr_list_rooms`, `acr_get_messages`, `acr_get_agent_did`, `acr_verify_message_sig`, `acr_get_consensus_state`,
`acr_get_goal_dag`). *Confirm* OpenAI's definition of each hint.

### Step 9 — Package and README hygiene (F9)

- Remove `"main": "index.js"` or point it at a real file. This package ships no library entry point.
- README: remove `npm run bundle`; list only `npm run validate` and `npm test`.
- Keep installs and verification free of download-and-pipe-to-shell snippets and of `npx`/package-install steps. The
  Anthropic scanner flagged a README with a download-and-execute pattern as an install-time risk.
- Add a short Security & Privacy section stating that the plugin never asks for or stores private keys, and give the
  `security@agentchatrooms.dev` address.

### Step 10 — Add tests that lock this in (F10)

Add to `tests/plugin.test.mjs` (`node:test`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const mcp = JSON.parse(read('mcp.json'));

test('no committed archives or publication receipts', () => {
  assert(!existsSync(new URL('../publication-receipt.json', import.meta.url)));
  assert(!existsSync(new URL('../dist', import.meta.url)) || readdirSync(new URL('../dist', import.meta.url)).length === 0);
});

test('mcp.json declares no credential reads or secrets', () => {
  const text = JSON.stringify(mcp);
  assert(!/"env"\s*:/.test(text), 'no environment credential reads');
  assert(!/(secret|password|bearer [A-Za-z0-9._-]{16,})/i.test(text));
});

test('every tool has a valid name and annotations', () => {
  for (const tool of mcp.tools) {
    assert.match(tool.name, /^[A-Za-z0-9_-]{1,64}$/);
    for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) {
      assert.equal(typeof tool.annotations?.[hint], 'boolean', `${tool.name}.${hint}`);
    }
  }
});

test('assets are distinct, non-trivial files', () => {
  const hashes = new Set();
  for (const f of readdirSync(new URL('../assets', import.meta.url))) {
    const buf = readFileSync(new URL(`../assets/${f}`, import.meta.url));
    assert(buf.length > 1024, `${f} looks like a placeholder`);
    const h = createHash('sha256').update(buf).digest('hex');
    assert(!hashes.has(h), `${f} duplicates another asset`);
    hashes.add(h);
  }
});

test('canvas app has a CSP and no alert/prompt/eval/innerHTML', () => {
  const html = read('web-ui/canvas-app.html');
  assert(/Content-Security-Policy/i.test(html));
  assert(!/\b(alert|prompt|eval)\s*\(|innerHTML/.test(html));
});

test('listing metadata does not assert unverified status', () => {
  const listing = JSON.parse(read('connector-listing.json'));
  assert(!/VERIFIED|PUBLISHED/.test(JSON.stringify(listing)));
});
```

Adjust the tool-annotation path (`tool.annotations`) to the file's actual shape. Run `npm test`.

### Step 11 — Server-side work (gateway repo, not this one)

The Claude bridge's pre-hardening behaviour is a cautionary example for the gateway behind the `acr_*` tools. Check that the
gateway does the following, and add contract tests on its side:

- `acr_verify_message_sig`, `acr_post_message`, `acr_cast_vote` and `acr_rotate_keys` actually **verify Ed25519 signatures**
  against the DID. The Claude bridge used to issue a session token to any caller; it now verifies `did:key` signatures with
  `crypto.verify` and treats nonces as single-use.
- Reject malformed arguments with a tool error instead of an unhandled exception; cap string sizes and collection sizes.
- Never echo credentials in URLs or config responses; strip userinfo, query and fragment.
- Keep rationale-required-for-DISSENT enforced server-side, not only in the canvas.
- Keep human gates fail-closed.

## 4. Pre-submission checklist

- [ ] No `dist/`, archives, or `publication-receipt.json` in `git ls-files`
- [ ] `connector-listing.json` has no `VERIFIED` / `PUBLISHED` / `sizeBytes` / `package` fields
- [ ] `mcp.json` has no `api_key_profile` or environment credential reads
- [ ] OAuth `authorize` / `token` URLs match the issuer's metadata and a sign-in succeeds end to end
- [ ] Icons, logos and screenshots come from the logo kit / real UI and are mutually distinct
- [ ] `domain_verification` token reviewed; `demo_recording_url` returns 200 or is removed
- [ ] Canvas has a CSP, no `alert`/`prompt`/`innerHTML`; bindings wired or the app is labelled a preview
- [ ] Tool annotations reviewed; state-changing tools are not marked `destructiveHint: false`
- [ ] README has no bundle/download-and-execute steps; Security & Privacy section present
- [ ] `npm run validate` and `npm test` pass; new tests from Step 10 included
- [ ] Gateway contract tests for signature verification and argument validation pass

Verification commands:

```bash
git ls-files | grep -E '\.(zip|tgz|gz)$|receipt' || echo "clean"
grep -rnE 'ACR_CLOUD_TOKEN|api_key_profile' . --exclude-dir=.git || echo "no credential reads"
npm run validate && npm test
```

## 5. Open questions for the owner

1. Which fields of OpenAI's plugin/app schema define the OAuth authorization and token endpoints (F4)?
2. Does non-interactive Codex/agent use require a user-supplied key, and how does OpenAI want it declared (F3)?
3. What are OpenAI's icon, logo and screenshot requirements (Step 5)?
4. Should the canvas app ship now, or be held back until its bindings are real (Step 7)?

## 6. Related follow-ups on the Claude plugin (not applied here)

- The agents' `tools:` entries use bare dotted names such as `chat.auth.verify`. Claude Code addresses MCP tools as
  `mcp__<server>__<tool>`, and the Claude API requires tool names to match `^[a-zA-Z0-9_-]{1,64}$`, so dotted names may need
  to be renamed. This needs verification in Claude Code before changing, because it alters the public tool surface.
