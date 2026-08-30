# Agent collaborators — design

AI agents join vapor documents as collaborators that look and behave like people: they have a name, a colour, a cursor, they type at a human rhythm, they leave suggestions and comments. Vapor supplies the protocol and the presence; the intelligence lives in external MCP clients (Claude Code, claude.ai connectors, custom agents).

Decisions made during brainstorming, 2026-08-30:

- **Roles**: editor/reviewer, co-writer, and on-demand assistant are all in scope; the protocol is general enough for any agent behaviour ("open platform").
- **Identity**: lightweight per-doc token roster. Tokens optionally carry an `owner` so a person's counterpart agent is attributable to them. Real auth comes later; the protocol doesn't change when it does.
- **Human-ness**: full simulation — presence, cursor movement, incremental typing, pauses.
- **Brains**: external only in this phase. Vapor makes no LLM calls.
- **Capability default**: new tokens get `suggest` + `comment`, not `write`. Direct writes are an explicit grant — the in-doc equivalent of the org's "agents open PRs, they don't push to main."
- **Build tooling**: unchanged from upstream mist (fork rule — see arfct/ops standards).

## Architecture

Three pieces, all in the existing worker:

```
MCP client (Claude Code, claude.ai, …)
    │  streamable HTTP /mcp  (Bearer token)
    ▼
VaporMcp (McpAgent Durable Object)      ← tool schemas, token check, anchor resolution
    │  DO-to-DO RPC
    ▼
DocumentAgent (existing DO, extended)   ← roster, performance queue, events, Y.Doc
    │  Yjs sync + awareness (unchanged)
    ▼
Human browsers
```

- **`VaporMcp`** (`agents/mcp.ts`) — an `McpAgent` from the Agents SDK, served at `/mcp` via `routeAgentRequest` in the worker entry. Stateless with respect to documents: every tool call names a `doc_id`, and `VaporMcp` calls that document's `DocumentAgent` stub. One MCP session can work across many documents.
- **`DocumentAgent`** (extended, not replaced) — gains three SQLite tables (`agent_tokens`, `performances`, `events`) and RPC methods the MCP layer calls. All Yjs mutation happens here, inside the DO that owns the doc.
- **Worker entry** (`workers/app.ts`) — adds `GET /:id.md` (raw markdown export) before React Router, alongside the existing agent routing.

Client/server separation rule is unchanged: nothing in `app/` imports from `agents/`; shared types go in `app/shared/`.

## Routing change

Documents render at the root path:

| Route | Handler | Notes |
|---|---|---|
| `/` | `home.tsx` | unchanged |
| `/new` | `new.ts` | unchanged |
| `/:id` | `docs.$id.tsx` (renamed pattern only) | was `/docs/:id` |
| `/:id.md` | worker entry, before React Router | raw markdown, CriticMarkup preserved |
| `/mcp` | `routeAgentRequest` → `VaporMcp` | streamable HTTP |
| `/agents/*` | `routeAgentRequest` → `DocumentAgent` | unchanged (Yjs WebSocket) |

Root slugs are now a shared namespace. A reserved-word list (`new`, `mcp`, `agents`, `api`, `assets`, `demo`, `favicon.ico`, `robots.txt`, `.well-known`) lives in `app/shared/constants.ts`; the id generator rejects collisions and the `/:id` loader 404s reserved names defensively.

## Tokens and the roster

Each document keeps an `agent_tokens` table: `token_hash` (SHA-256), `name`, `color`, `owner` (nullable free-text for now; user id later), `capabilities` (subset of `read`, `comment`, `suggest`, `write`), `created_at`, `last_seen_at`.

- **Minting**: an "Invite agent" action in the doc UI generates a token, stores its hash, and shows copy-paste MCP connection config (URL + bearer token). Agent names are slugs (`[a-z0-9-]{2,32}`, unique per doc) so `@name` mentions parse unambiguously; the UI shows a friendlier display form. Anyone who can open the doc can mint — the same trust model as the rest of vapor (public by URL). No MCP tool mints tokens; an agent cannot widen its own access.
- **Presentation**: `Authorization: Bearer <token>` on the MCP request. The token alone identifies doc-scoped permissions; tools still take `doc_id` because one token may later span docs — in this phase a token is valid only for the doc that minted it.
- **Capabilities**: `read` is implied for any valid token. `suggest` writes CriticMarkup marks; `write` edits directly; `comment` creates/replies to threads. Default grant: `suggest` + `comment`.

## Tool surface

All tools return structured content; markdown in, markdown out. `pace` is `natural` (default), `fast`, or `instant`.

| Tool | Capability | Purpose |
|---|---|---|
| `read_document(doc_id)` | read | Markdown with per-block anchors, presence list, open threads |
| `insert(doc_id, anchor, where, markdown, pace?)` | write | Insert before/after a block, or append to doc |
| `replace(doc_id, from_anchor, to_anchor?, markdown, pace?)` | write | Replace a block range |
| `suggest(doc_id, anchor, find, replacement, note?)` | suggest | CriticMarkup addition/deletion marks on matched text |
| `comment(doc_id, anchor, quote, text)` | comment | Open a thread anchored to a highlight |
| `reply(doc_id, thread_id, text)` | comment | Reply in a thread |
| `join(doc_id, status?)` / `leave(doc_id)` | read | Enter/exit presence; status is a short activity string |
| `await_events(doc_id, since_cursor?, timeout_s?)` | read | Long-poll for mentions, thread replies, doc-changed digests |
| `create_document(markdown?)` | none — unauthenticated, like `/new` | New doc; returns id, URL, and a fresh default-capability token for it |

Errors are typed: `stale_anchor` (includes a fresh snippet of the region so the agent can re-orient without a full re-read), `capability_denied`, `invalid_token`, `doc_not_found`, `doc_expired`, `find_not_matched`, `rate_limited`.

## Anchors

`read_document` returns blocks as `[b3 a91f] ## Heading text…` where `b3` is the block index and `a91f` is a short hash of the block's plain text. Edit tools resolve an anchor by hash first (index as a hint when the hash appears twice). If the hash no longer exists — a human edited that block since the read — the tool fails with `stale_anchor` rather than guessing. Anchors are computed on demand from the Y.Doc; nothing is stored. This is deliberately stateless; persistent block ids in the Yjs schema are a future upgrade if hash churn proves annoying in practice.

## Performance engine (human-ness)

Accepted mutations don't land atomically. `DocumentAgent` appends them to a `performances` queue and replays them:

1. The agent's awareness state appears (name, colour, `isAgent: true`) if not already present.
2. Its cursor moves to the target position; brief pause (300–900 ms).
3. Text lands in small Yjs transactions — 2–6 characters per tick, 30–80 ms apart (roughly 60–120 wpm), with occasional longer pauses at sentence boundaries. Deletions sweep similarly.
4. Cursor rests at the end of the change; presence lingers until `leave` or an idle timeout (5 min → awareness removed, token stays valid).

Scheduling uses the Agents SDK schedule/alarm machinery; while human connections exist the DO is active anyway. **If no humans are connected, performances apply instantly** — pacing is theatre for an audience, and skipping it saves duty cycles. `pace: "instant"` also bypasses the queue (bulk imports, counterpart syncs). Queued performances execute in order per agent; two agents can interleave.

Rate limit: per token, a budget consistent with the simulated typing speed (enforced even at `instant` — 10 mutations/min, 20k chars/hour) so an agent can't be human-like on screen and a firehose in the CRDT.

## Events and summoning

`DocumentAgent` records events (`mention`, `thread_reply`, `doc_changed` digest) in an `events` table with a monotonic cursor, pruned with the doc. A mention is `@name` matching a roster agent's name, detected in inserted text. `await_events` long-polls up to ~50 s and returns anything after the caller's cursor; clients re-call in a loop to feel resident. This is what makes a counterpart agent summonable: its owner's client holds `await_events` open, someone types `@nicks-agent fix the intro`, the client wakes and edits.

The UI renders agent presence with a distinguishing badge in the avatar stack and caret label — human-like, but never passing as human.

## Connect UI

Connecting an agent must be a copy-paste, not a documentation hunt.

- **Invite agent** action in the doc's share/menu area opens a dialog: agent name (slug, auto-suggested), capability toggles (suggest + comment pre-checked; write off by default), optional owner. Creating it shows the token **once** (only the hash is stored) alongside ready-to-paste connection snippets:
  - **Claude Code**: `claude mcp add --transport http vapor https://vapor.fyi/mcp --header "Authorization: Bearer <token>"`
  - **claude.ai**: the connector URL plus where to paste it (Settings → Connectors → Add custom connector).
  - **Generic MCP client**: the `mcpServers` JSON block.
  Each snippet has a copy button; the dialog warns the token can't be shown again (revoke and re-mint instead).
- **Roster panel** in the same dialog lists the doc's agents — name, colour, capability chips, owner, last seen — with revoke.
- **`GET /mcp` from a browser** (Accept: text/html) renders a short "how to connect" page instead of a protocol error, linking back to the invite flow.

## Other doors (this phase)

- **Raw REST**: `GET /:id.md` public (docs are public by URL); mutation stays MCP-only this phase. The existing `curl /new -T file.md` flow is unchanged.
- **Claude connector story**: `/mcp` + bearer token works as a claude.ai custom connector and in Claude Code (`claude mcp add`), zero extra code — this is the acceptance demo.

## Out of scope (recorded so they stay out)

Hosted brains (vapor calling LLMs), real user auth, cross-doc tokens, GitHub/gist sync, Slack, agent-to-agent protocols, a headless Yjs client SDK, persistent block ids.

## Testing

- **Unit** (`tests/unit/`): anchor computation and resolution (incl. duplicate-hash and stale cases), reserved-slug enforcement, markdown export via the existing critic-serializer, performance chunking as a pure function (text → timed ticks), mention detection, capability checks.
- **Integration** (`tests/integration/`): MCP tool round-trips against a real `DocumentAgent` (mint token → read → suggest → marks present in Y.Doc; write without capability → `capability_denied`; concurrent human edit → `stale_anchor`), `/:id.md` export, event cursor semantics.
- Agent-package import constraints per CLAUDE.md: DO logic tested through integration tests; pure logic extracted to `app/shared/` or `app/lib/` where unit-testable.

## Repo chores riding along (separate PRs, not this feature)

CLAUDE.md restructured onto the arfct org template (keeping mist's repo-specific content); vapor row in ops `deployment.md`; domains recorded in `arfct/internal`. Build tooling (ESLint, CI workflow) intentionally unchanged — fork rule.
