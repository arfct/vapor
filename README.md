# vapor

Collaborative markdown editor. A cross between GitHub Gist and Google Docs — share and do multiplayer editing on markdown documents, quickly.

vapor is a fork of [mist](https://github.com/inanimate-tech/mist).

Everything is public by URL. Documents persist live with no save button. Multiple users (and AI agents — see below) see each other's cursors in real time.

## Features

- **Real-time multiplayer editing** via TipTap + Yjs, backed by Cloudflare Durable Objects
- **Live markdown formatting** — inline styles render as you type, with formatting characters shown in grey
- **Suggest mode** — track changes using CriticMarkup (additions, deletions, comments, highlights)
- **Threaded comments** with highlight anchoring
- **Preview mode** — rendered markdown with click, hover, or keypress toggle
- **AI agent collaborators** — invite Claude Code or any MCP client into a document as a named collaborator
- **CLI upload** — `curl https://your-domain/new -T file.md`
- **Drag and drop** `.md` files to create new documents
- **Dark/light/auto themes**
- **Documents auto-expire** after 99 hours

## Tech stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Durable Objects](https://developers.cloudflare.com/durable-objects/) (backend + persistence)
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (real-time WebSocket agent, MCP server)
- [React Router 7](https://reactrouter.com/) (SSR)
- [TipTap 3](https://tiptap.dev/) (editor)
- [Yjs](https://yjs.dev/) (CRDT for multiplayer)
- [Tailwind CSS 4](https://tailwindcss.com/) (styling)
- TypeScript, Vitest

## Getting started

### Prerequisites

- Node.js 22+ (see `.nvmrc`)
- A Cloudflare account (free tier works)

### Setup

```bash
git clone https://github.com/arfct/vapor.git
cd vapor
npm install
```

### Development

```bash
npm run dev
```

### Deploy

Set your Cloudflare account ID via environment variable:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
npm run deploy
```

### Optional: Analytics

To enable [Fathom](https://usefathom.com/) analytics, set these environment variables (or add to `.dev.vars`):

```
VITE_FATHOM_SITE_ID=your-site-id
VITE_FATHOM_DOMAINS=your-domain.com
```

### Commands

```bash
npm run dev          # Local development server
npm run build        # Production build
npm run deploy       # Build and deploy to Cloudflare Workers
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run test         # Vitest with coverage
npm run test:watch   # Vitest in watch mode
```

## Project structure

```
agents/       Durable Object agents (document state, MCP server)
app/
  components/ UI components
  lib/        Editor logic, utilities, CriticMarkup, Yjs provider
  routes/     File-based routing
  shared/     Types and constants shared between client and server
workers/      Cloudflare Worker entry point
tests/        Test suite
```

## AI agent collaborators

Agents join a document as collaborators that look and behave like people: a name, a colour, a cursor, human-paced typing, suggestions, and comments. vapor supplies the protocol and the presence — the intelligence is whatever MCP client you connect.

### Connecting

From the doc's **Invite agent** dialog, or directly:

```bash
claude mcp add --transport http vapor https://vapor.fyi/mcp --header "Authorization: Bearer <token>"
```

For claude.ai, add a custom connector at Settings → Connectors → Add custom connector, pointing at `https://vapor.fyi/mcp` with the same bearer token. Any other MCP client works the same way over streamable HTTP.

### Tokens

Tokens are minted per document from the **Invite agent** dialog — anyone who can open the doc can invite an agent, the same public-by-URL trust model as the rest of vapor. A new token defaults to `suggest` + `comment` capabilities; `write` (direct edits, no track-changes) is an explicit grant. The token is shown once at creation; revoke and re-mint if it's lost.

### Tools

- `read_document` — markdown with per-block anchors, presence list, open threads
- `insert` — insert markdown before/after a block, or append to the doc
- `replace` — replace a block range
- `suggest` — CriticMarkup addition/deletion marks on matched text
- `comment` — open a thread anchored to a highlight
- `reply` — reply in a thread
- `join` / `leave` — enter/exit presence
- `await_events` — long-poll for mentions, thread replies, doc-changed digests
- `create_document` — create a new doc and a token for it, no auth required

### Raw export

`GET /:id.md` returns a document's markdown, public by URL, no token needed.

### @mentions

Typing `@agent-name` in a document raises a `mention` event. An agent holding `await_events` open wakes on it — this is how you summon a specific collaborator into a conversation.

## Licence

[MIT](LICENSE)
