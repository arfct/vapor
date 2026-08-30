# CLAUDE.md

This repo follows the Artifact Primer: https://github.com/arfct/ops/tree/main/primer

- Standards (style, commits, branches): https://github.com/arfct/ops/blob/main/primer/standards.md
- Work tracking: Linear workspace `arfct`, team Artifact (A) — https://github.com/arfct/ops/blob/main/primer/linear.md
- Bugs: https://github.com/arfct/ops/blob/main/primer/bugs.md · Deployment: https://github.com/arfct/ops/blob/main/primer/deployment.md
- Agent conventions and boundaries: https://github.com/arfct/ops/blob/main/primer/agents.md

## This repo

vapor is a collaborative markdown editor — a fork of [mist](https://github.com/inanimate-tech/mist), deployed at https://vapor.fyi. `npm run dev` for local development, `npm run deploy` (with `CLOUDFLARE_ACCOUNT_ID` set) to ship to Cloudflare Workers. This is a fork: keep upstream's build tooling (ESLint config, CI) unchanged unless upstream changes it — don't propose tooling swaps here.

### Start of Session

Read project documents to load context:

- `docs/design-system.md` — visual design, typography, colours, layout
- `docs/technical-architecture.md` — platform, framework stack, directory structure, critical rules
- `docs/plans/2026-08-30-agent-collaborators-design.md` — agent collaborators spec (tokens, tool surface, performance engine)

Also check `plans/` for any active plan.

### Project Overview

vapor is a collaborative markdown editor — a cross between GitHub Gist and Google Docs. Users can quickly share and do multiplayer editing on markdown documents in real-time. Everything is public by URL (no auth yet). Documents persist live with no save button. Documents auto-expire after 99 hours. AI agents can join documents as human-like collaborators over MCP (see "Agent collaborators" below).

User-visible naming is "vapor" (`APP_NAME`, page titles, wordmark). The markdown-export frontmatter key stays `mist:` for round-trip compatibility with existing exports, and the theme localStorage key stays `mist-theme` so users' theme choices survive.

### Tech Stack

- **Backend:** Cloudflare Workers + Durable Objects (SQLite storage)
- **Frontend:** React Router 7 (SSR) + Cloudflare Agents SDK
- **Editor:** TipTap 3 + Yjs (CRDT multiplayer)
- **Styling:** Tailwind CSS 4
- **Language:** TypeScript (strict mode)
- **Testing:** Vitest with v8 coverage

### Prerequisites

Requires Node.js 22+ (see `.nvmrc`). Before running commands:

```bash
source ~/.nvm/nvm.sh && nvm use
```

### Commands

```bash
npm run dev          # Local development server
npm run build        # Production build
npm run deploy       # Build and deploy to Cloudflare Workers
npm run typecheck    # Full TypeScript type checking (runs cf-typegen + react-router typegen + tsc)
npm run lint         # ESLint
npm run test         # Vitest with coverage
npm run test:watch   # Vitest in watch mode
npm run cf-typegen   # Generate Cloudflare Worker types

# Run a single test file
npx vitest run tests/unit/lib/critic-parser.test.ts

# Run tests matching a pattern
npx vitest run -t "pattern"
```

### Architecture

See `docs/technical-architecture.md` for full details.

#### Directory Layout

- `agents/` — Server-side Durable Object agents: `DocumentAgent` (document state) and `VaporMcp` (MCP server)
- `app/components/` — React UI components
- `app/lib/` — Editor logic, CriticMarkup, Yjs provider, utilities
- `app/shared/` — Constants and types shared between client and server
- `app/routes/` — File-based routing (`home.tsx`, `doc.$id.tsx`, `new.ts`)
- `workers/app.ts` — Cloudflare Worker entry point
- `workers/routes.ts` — Pure handlers for `/:id.md` and the `/mcp` help page
- `tests/` — Unit tests (`tests/unit/`) and integration tests (`tests/integration/`)

#### Routes

Documents render at the root path, not under `/docs`:

| Route | Handler |
|---|---|
| `/` | `home.tsx` |
| `/new` | `new.ts` |
| `/:id` | `doc.$id.tsx` |
| `/:id.md` | `workers/routes.ts` — raw markdown export |
| `/mcp` | `agents/mcp.ts` (`VaporMcp`) — MCP server |
| `/agents/*` | `agents/document.ts` (`DocumentAgent`) — Yjs WebSocket |

Root slugs share one namespace with a small reserved-word list (`app/shared/constants.ts`); the id generator and the `/:id` loader both guard against collisions.

#### Import Path Alias

`~` resolves to `app/` (configured in tsconfig and vitest). Use `~/lib/foo` instead of relative paths.

#### Critical Rule: Server/Client Separation

Client-side React components must **never** import from `agents/`. The `agents` package uses `cloudflare:` protocol imports that don't exist in the browser. Use `app/shared/` for types needed by both sides.

#### Real-Time Collaboration Flow

The multiplayer system works as follows:

1. **`DocumentAgent`** (`agents/document.ts`) — a Durable Object that holds a Yjs `Y.Doc` in memory, persists state to SQLite on every update, and relays Yjs sync/awareness messages between connected WebSocket clients.
2. **`yjs-provider.ts`** (`app/lib/`) — client-side WebSocket provider that connects to the agent at `/agents/document-agent/:docId` and handles Yjs sync protocol encoding/decoding.
3. **TipTap** uses `@tiptap/extension-collaboration` (bound to the Yjs doc's `XmlFragment`) and `@tiptap/extension-collaboration-caret` for cursor awareness.
4. **Worker entry** (`workers/app.ts`) — `routeAgentRequest()` intercepts `/agents/:agent/:name` requests before React Router handles the rest.

#### CriticMarkup / Suggest Mode

Track-changes functionality spans multiple files:

- `app/lib/critic-marks.ts` — ProseMirror mark definitions (criticAddition, criticDeletion, criticComment, criticHighlight) with `inclusive: false`
- `app/lib/suggest-mode.ts` — ProseMirror plugin that intercepts edits and applies addition/deletion marks instead of direct changes
- `app/lib/critic-parser.ts` — Parses CriticMarkup syntax (`{++ ++}`, `{-- --}`, etc.) into clean text + mark ranges
- `app/lib/critic-serializer.ts` — Serializes marks back to CriticMarkup delimiter syntax
- `app/lib/critic-markup.ts` — TipTap extension that wires up the CriticMarkup marks and delimiter decorations

#### Agent collaborators

AI agents connect as MCP clients and edit through the same CriticMarkup/Yjs machinery humans use, with a performance engine that paces their typing to look human. Full design: `docs/plans/2026-08-30-agent-collaborators-design.md`.

- **`VaporMcp`** (`agents/mcp.ts`) — an `McpAgent` (Cloudflare Agents SDK) served at `/mcp`. Stateless per document: each tool call names a `doc_id` and forwards to that doc's `DocumentAgent` via DO-to-DO RPC. Tool schemas and definitions live in `agents/mcp-tools.ts`.
- **`DocumentAgent`** (extended) — owns the token roster, performance queue, and event log alongside the Yjs doc; all mutations happen inside the DO that owns the document.
- **`workers/routes.ts`** — pure (no `cloudflare:` imports) handlers for `GET /:id.md` (raw markdown) and the `GET /mcp` browser help page, wired into `workers/app.ts`.

#### Testing Constraints

- The `agents` package uses `cloudflare:` imports — it **cannot** be imported in plain Vitest. Test agent logic through integration tests or mock the imports. Unit tests should focus on pure logic in `app/lib/` and `app/shared/`.
- Coverage thresholds ramp linearly from 0% to 80% between Feb–Dec 2026 (see `vitest.config.ts`).
- Tests live in `tests/unit/` and `tests/integration/`, mirroring the source structure.

#### ESLint Conventions

- Unused variables must be prefixed with `_` (e.g., `_args`, `_ctx`).
- Tagged template expressions are allowed (for `this.sql` in Durable Objects).
