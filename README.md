# vapor

**[vapor.fyi](https://vapor.fyi)** — ephemeral, multiplayer markdown documents that people and AI agents edit together.

A cross between GitHub Gist and Google Docs: paste a URL at someone and you're co-writing, live cursors and all. Then invite an agent, and it joins the same document the same way — a name, a colour, a cursor, human-paced typing, tracked-change suggestions, and comments.

Every document is public to anyone holding its URL, saves itself continuously, and deletes itself about 99 hours after creation. vapor is a fork of [mist](https://github.com/inanimate-tech/mist).

## Using it

Go to [vapor.fyi](https://vapor.fyi) and start typing, or:

```bash
# create a document from a file
curl https://vapor.fyi/new -T notes.md

# read any document back as raw markdown
curl https://vapor.fyi/<id>.md
```

- **Live markdown** — inline styles render as you type, formatting characters dimmed in place.
- **Suggest mode** — track changes as [CriticMarkup](https://criticmarkup.com/): additions, deletions, comments, highlights, with accept/reject.
- **Threaded comments** anchored to highlighted text.
- **Preview mode**, drag-and-drop `.md` import, dark/light/auto themes.

## Who you are

Sign-in (Google) is optional everywhere and never a wall — it buys attribution, not access. Everyone at the table gets a name:

| | Human | Agent |
|---|---|---|
| **Anonymous** | Curious Ladybug 🐞 | Agentic Butterfly 🦋 |
| **Signed in** | Ada Lovelace (+ avatar) | Ada's Agent |

Anonymous identities (an adjective, an animal, a colour) live in your own browser and persist across documents — you're the same Cowardly Lion everywhere. Sign in and your name and avatar replace the animal, your earlier anonymous comments in the doc are re-attributed to you, and your agent becomes a durable counterpart owned by your account.

## Agents

vapor supplies the protocol and the presence; the intelligence is whatever [MCP](https://modelcontextprotocol.io) client you connect. Two doors:

**Signed in** — the agent gets a stable identity across all documents and, if you grant it at consent, direct-write access. Adding it triggers a browser sign-in once, then it's remembered:

```bash
claude mcp add --transport http vapor https://vapor.fyi/mcp
```

On claude.ai: Settings → Connectors → Add custom connector → `https://vapor.fyi/mcp`.

**Anonymous** — zero setup, suggest and comment only:

```bash
claude mcp add --transport http vapor https://vapor.fyi/mcp/anonymous
```

Capabilities are chosen at consent: **suggest + comment** by default (tracked changes a human accepts or rejects — agents open PRs, they don't push to main), **full write** as an explicit opt-in. Each document's **Agents** panel shows who's enrolled and offers per-document revoke; revoking the OAuth grant severs the counterpart everywhere.

### Tools

`read_document` (markdown with stable per-block anchors, presence, threads) · `insert` · `replace` · `suggest` · `comment` · `reply` · `join` / `leave` · `await_events` (long-poll for mentions, replies, and change digests) · `create_document`

Typing `@agent-name` in a document raises a `mention` event; an agent holding `await_events` open wakes on it. That's how you summon a specific collaborator mid-sentence.

Edits from agents don't just appear — they type in at a human pace, cursor visible, with pauses at sentence ends. Pass `pace: "instant"` when nobody needs the theatre.

## How it works

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Durable Objects](https://developers.cloudflare.com/durable-objects/) — one DO per document holds the [Yjs](https://yjs.dev/) CRDT, the agent roster, the typing-performance queue, and the event log.
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) — real-time WebSocket sync and the MCP server (`McpAgent`).
- [TipTap 3](https://tiptap.dev/) on [React Router 7](https://reactrouter.com/) (SSR), [Tailwind CSS 4](https://tailwindcss.com/), TypeScript, Vitest.
- Identity: Google sign-in via the GSI credential flow (no auth library, no client secret), HMAC session JWTs, and a hand-rolled OAuth 2.1 authorization server for MCP clients — PKCE, dynamic client registration, and CIMD. Ported from [subpixel](https://subpixel.app)'s auth stack.

```
agents/       Durable Objects: DocumentAgent, VaporMcp, Registry
app/
  components/ UI components
  lib/        Editor logic, CriticMarkup, Yjs provider, auth
  routes/     File-based routes (docs live at /:id)
  shared/     Types and constants shared client/server
workers/      Worker entry, pure route handlers, OAuth server
tests/        Unit + integration suites
```

## Developing

Node 22+ and a Cloudflare account (free tier works).

```bash
git clone https://github.com/arfct/vapor.git
cd vapor && npm install
npm run dev
```

```bash
npm run typecheck    # cf-typegen + react-router typegen + tsc
npm run lint         # ESLint
npm run test         # Vitest with coverage
npm run deploy       # build + wrangler deploy
```

Deploying needs `CLOUDFLARE_ACCOUNT_ID` in the environment. Sign-in needs two more pieces of config, both optional in dev (the app runs fine without them): `GOOGLE_CLIENT_ID` (a public Google OAuth client id — set as a wrangler var) and `SESSION_SECRET` (a Workers secret; locally, both go in `.dev.vars` — see `.dev.vars.example`). Fathom analytics is optional via `VITE_FATHOM_SITE_ID` / `VITE_FATHOM_DOMAINS`.

Design and architecture docs live in [docs/](docs/), including the [agent collaborators spec](docs/plans/2026-08-30-agent-collaborators-design.md) and the [identity spec](docs/plans/2026-08-30-identity-design.md).

## Fine print

[Privacy](https://vapor.fyi/privacy) · [Terms](https://vapor.fyi/terms) · [MIT](LICENSE)
