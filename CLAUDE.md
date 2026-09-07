# CLAUDE.md

## This repo

vapor is a collaborative markdown editor — a fork of [mist](https://github.com/inanimate-tech/mist) that anyone can run as their own instance (`docs/self-hosting.md`). `npm run dev` for local development, `npm run deploy` (with `CLOUDFLARE_ACCOUNT_ID` set) to ship to Cloudflare Workers with the generic `wrangler.jsonc`; the reference instance, vapor.fyi, deploys with `npm run deploy:vapor.fyi` from `deploy/vapor.fyi.jsonc`. This is a fork: keep upstream's build tooling (ESLint config, CI) unchanged unless upstream changes it — don't propose tooling swaps here.

Work is tracked in GitHub issues on this repository; branches are `feat/<issue>-<slug>`. Maintainers at Artifact additionally follow the [Artifact Primer](https://github.com/arfct/ops/tree/main/primer) for style, commits, and deployment; contributors to a fork don't need it.

### Portability rule

Nothing in `app/`, `agents/`, or `workers/` may name a host or a repository. The origin comes from the request (`url.origin`, or the root loader's `site` via `useSite()` in components); the rest comes from the optional vars `PUBLIC_ORIGIN`, `REDIRECT_HOSTS`, `OPERATOR_NAME`, and `SOURCE_URL`, resolved in `app/shared/site.ts`. The one allowed literal is the reference origin in `plugin/skills/vapor/SKILL.md`, which `workers/routes.ts` rewrites when serving `/skill.md`. Instance-specific config (domains, client ids) lives in `deploy/*.jsonc`, never in the generic `wrangler.jsonc`; `tests/unit/deploy-config.test.ts` keeps the two describing the same Worker.

### Start of Session

Read project documents to load context:

- `docs/design-system.md` — visual design, typography, colours, layout
- `docs/technical-architecture.md` — platform, framework stack, directory structure, critical rules
- `docs/plans/2026-08-30-agent-collaborators-design.md` — agent collaborators spec (tool surface, performance engine)
- `docs/plans/2026-08-30-identity-design.md` — identity phase spec (Google sign-in, MCP OAuth, counterpart agents)

Also check `plans/` for any active plan.

### Project Overview

vapor is a collaborative markdown editor — a cross between GitHub Gist and Google Docs. Users can quickly share and do multiplayer editing on markdown documents in real-time. Everything is public by URL. Sign-in (Google or Apple) is optional and adds identity/attribution, never a wall. Documents persist live with no save button. Documents auto-expire after 99 hours. AI agents can join documents as human-like collaborators over MCP (see "Agent collaborators" below).

Naming is "vapor" throughout: `APP_NAME`, page titles, the export frontmatter key (`vapor:`), and the theme localStorage key (`vapor-theme`).

### Tech Stack

- **Backend:** Cloudflare Workers + Durable Objects (SQLite storage)
- **Frontend:** React Router 7 (SSR) + Cloudflare Agents SDK
- **Editor:** TipTap 3 + Yjs (CRDT multiplayer)
- **Styling:** Tailwind CSS 4
- **Language:** TypeScript (strict mode)
- **Testing:** Vitest with v8 coverage

### Prerequisites

Requires Node.js 22+ (see `.nvmrc`; `nvm use` picks it up). Node 26 currently fails the three localStorage-based test files (`safe-storage`, `anon-identity`, `use-theme`) because it ships its own global `localStorage`; that is an environment issue, not a regression.

### Commands

```bash
npm run dev          # Local development server
npm run build        # Production build
npm run deploy       # Build and deploy to Cloudflare Workers (generic wrangler.jsonc → workers.dev or your routes)
npm run deploy:vapor.fyi  # The reference instance (deploy/vapor.fyi.jsonc)
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

- `agents/` — Server-side Durable Object agents: `DocumentAgent` (document state), `VaporMcp` (MCP server), `Registry` (global identity + OAuth state)
- `app/components/` — React UI components
- `app/lib/` — Editor logic, CriticMarkup, Yjs provider, utilities
- `app/shared/` — Constants and types shared between client and server
- `app/routes/` — File-based routing (`home.tsx`, `doc.$id.tsx`, `new.ts`)
- `workers/app.ts` — Cloudflare Worker entry point
- `workers/routes.ts` — Pure handlers for `/:id.md`, the `/mcp` help page, `/llms.txt`, `/skill.md`, host redirects, and `/auth/*`
- `deploy/` — Per-instance wrangler configs selected with `WRANGLER_CONFIG` (paths inside are relative to the file)
- `tests/` — Unit tests (`tests/unit/`) and integration tests (`tests/integration/`)

#### Routes

Documents render at the root path, not under `/docs`:

| Route | Handler |
|---|---|
| `/` | `home.tsx` |
| `/new` | `new.ts` |
| `/:id` | `doc.$id.tsx` |
| `/:id.md` | `workers/routes.ts` — raw markdown export |
| `/mcp` | `agents/mcp.ts` (`VaporMcp`) — OAuth-gated MCP server |
| `/mcp/anonymous` | `agents/mcp.ts` (`VaporMcp`) — tokenless MCP server |
| `/auth/*` | `workers/routes.ts` — Google sign-in sessions |
| `/skill.md`, `/llms.txt` | `workers/routes.ts` — the plugin skill and the MCP guide, rewritten to the serving origin |
| `/oauth/*`, `/.well-known/oauth-*` | `workers/oauth.ts` — OAuth 2.1 AS for MCP |
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

#### Version history

`DocumentAgent` keeps a `versions` table of markdown snapshots (policy in `app/shared/version-policy.ts`, HTTP handler in `agents/version-routes.ts`, dialog in `app/components/HistoryDialog.tsx`). Restore is an ordinary `"agent"`-origin edit; see `docs/markdown-and-criticmarkup.md` and `docs/plans/2026-09-05-version-history-plan.md`.
#### Attachments

Files live in R2 (`ATTACHMENTS` binding, keyed `<docId>/<attachmentId>`), metadata in the document's `attachments` table, per-account budgets in the Registry's `upload_ledger`. Policy in `app/shared/attachment-policy.ts`; upload/serve handlers in `workers/attachments.ts` (pure, tested) wired from `workers/app.ts`; the editor node in `app/lib/attachment.ts`; the MCP `attach` tool in `agents/mcp.ts`. Uploads require sign-in. See `docs/plans/2026-09-05-attachments-plan.md`.

#### Mentions and slash commands

Both are `@tiptap/suggestion` popups (`app/lib/suggestion-popup.ts`, `app/components/SuggestionList.tsx`). A mention is a token `@slug[+agent]~sid` carrying a short public id (grammar, matching, and ranking in `app/shared/agent-protocol.ts`; ids in `app/shared/short-id.ts`), stored as a `mention` node (`app/lib/mention.ts`, mirrored in `richSchema`) that shows the name and hides the id. Completion is `app/lib/mention-suggestion.ts` in the body and in `CommentEditor`; a typed email resolves through `GET /auth/resolve` and is never written into the document. `/` at the start of a block runs `app/lib/slash-commands.ts`, whose items mirror the Format menu. See `docs/markdown-and-criticmarkup.md`, issue #51, and `docs/plans/2026-09-06-agent-identity-plan.md`.

#### Agent collaborators

AI agents connect as MCP clients and edit through the same CriticMarkup/Yjs machinery humans use, with a performance engine that paces their typing to look human. Full design: `docs/plans/2026-08-30-agent-collaborators-design.md`.

- **`VaporMcp`** (`agents/mcp.ts`) — an `McpAgent` (Cloudflare Agents SDK) served at `/mcp`. Stateless per document: each tool call names a `doc_id` and forwards to that doc's `DocumentAgent` via DO-to-DO RPC. Tool schemas and definitions live in `agents/mcp-tools.ts`.
- **`DocumentAgent`** (extended) — owns the agent roster, performance queue, and event log alongside the Yjs doc; all mutations happen inside the DO that owns the document. Agent RPCs take a verified `AgentIdentity` (principal or anonymous) and enroll it into the roster on first touch — there are no per-doc tokens. Agent writes run in transactions tagged `agentOrigin(name)` (`{ kind: "agent", actor }`), so the mention / thread_reply / doc_changed observers fire for them like human edits, with `payload.actor` set; each agent's poll drops its own. The bare `"agent"` origin is reserved for system writes (import, restore) that fire nothing.
- **`workers/routes.ts`** — pure (no `cloudflare:` imports) handlers for `GET /:id.md`, the MCP help page, and `/auth/*` sign-in, wired into `workers/app.ts`.
- **Wake targets** — a signed-in person's identity-wide "how to wake my agent" (a Claude Code routine or a webhook), stored sealed in the Registry and fired from `DocumentAgent.recordEvent` for mentions and thread replies. Policy in `app/shared/wake-policy.ts`, sealing in `app/shared/wake-crypto.ts`, routes in `workers/wake-routes.ts` (`/me/wake`), UI in `app/components/WakeSection.tsx`. See `docs/plans/2026-09-06-agent-wake-plan.md`.

#### Identity (Google sign-in + MCP OAuth)

Ported from subpixel's dependency-free auth stack. Full design: `docs/plans/2026-08-30-identity-design.md`.

- **`app/lib/auth.server.ts`** — Google ID-token verification (WebCrypto), HMAC session JWTs, the `vp_session` cookie. Identity is a principal (`google:<sub>`, server-side only); each profile has a public eight-character `uid` that is all clients ever see. Sign-in is optional.
- **`agents/registry.ts`** (`Registry` DO, one `"global"` instance) — profiles (with the legacy `email:` principal re-keyed on sign-in), email → person resolution for mentions, wake targets, and OAuth clients/codes/refresh tokens. People are circles and agents are hexagons with their client's mark (`app/components/Avatar.tsx`).
- **`workers/oauth.ts`** — OAuth 2.1 AS (PKCE, dynamic registration, discovery). Access tokens are 1-hour session JWTs carrying the granted capabilities; the consent page (`app/lib/oauth-pages.ts`) is where write is granted. `/mcp` requires one of these; `/mcp/anonymous` needs none.
- Secrets: `SESSION_SECRET` (Workers secret), `GOOGLE_CLIENT_ID` and `APPLE_CLIENT_ID` (public vars). See `.dev.vars.example`. All optional: without them an instance is anonymous-only.

#### Testing Constraints

- The `agents` package uses `cloudflare:` imports — it **cannot** be imported in plain Vitest. Test agent logic through integration tests or mock the imports. Unit tests should focus on pure logic in `app/lib/` and `app/shared/`.
- Coverage thresholds ramp linearly from 0% to 80% between Feb–Dec 2026 (see `vitest.config.ts`).
- Tests live in `tests/unit/` and `tests/integration/`, mirroring the source structure.

#### ESLint Conventions

- Unused variables must be prefixed with `_` (e.g., `_args`, `_ctx`).
- Tagged template expressions are allowed (for `this.sql` in Durable Objects).
