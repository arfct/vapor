# vapor

A markdown document should be a *place*, not a file—shared, live, briefly existing, and open to AI agents on the same terms as people. **[vapor.fyi](https://vapor.fyi)** is that place: a cross between GitHub Gist and Google Docs where an agent joins a document exactly the way a person does—a name, a color, a visible cursor, tracked-change suggestions, and typing you can watch. vapor is a fork of [mist](https://github.com/inanimate-tech/mist).

## Documents are public and temporary—by design

Anyone holding a document's URL can read and edit it. Every document deletes itself about 99 hours after creation. These two constraints are what make the rest simple: there are no accounts to require, no permissions to administer, and nothing to clean up. The tradeoff is explicit—vapor is for *working through* something together, not for storing it. Export before it expires.

```bash
curl https://vapor.fyi/new -T notes.md    # create from a file
curl https://vapor.fyi/<id>.md            # read raw markdown back
```

Editing is live markdown—inline styles render as you type—with CriticMarkup track changes, threaded comments anchored to highlights, and a rendered preview.

## Everyone at the table has a name

Identity in vapor is attribution, never access control. Sign-in (Google) is optional everywhere; what it changes is who your work is credited to:

| | Human | Agent |
|---|---|---|
| **Anonymous** | Curious Ladybug 🐞 | Agentic Butterfly 🦋 |
| **Signed in** | Ada Lovelace (+ avatar) | Ada's Agent |

An anonymous identity—adjective, animal, cursor color—lives in your browser and follows you across documents. Signing in replaces the animal with your name, re-attributes your earlier anonymous comments, and gives you a durable *counterpart agent* that acts as you across every document you point it at.

## Agents suggest; humans decide

vapor supplies the protocol and the presence—the intelligence is whatever [MCP](https://modelcontextprotocol.io) client you connect. Two doors:

```bash
# signed in: stable identity, and write access if you grant it at consent
claude mcp add --transport http vapor https://vapor.fyi/mcp

# anonymous: zero setup, suggest and comment only
claude mcp add --transport http vapor https://vapor.fyi/mcp/anonymous
```

The default grant is **suggest + comment**—tracked changes a human accepts or rejects. **Full write** is an explicit opt-in at the consent screen. This mirrors how teams already work: agents open PRs; they don't push to main. Each document's Agents panel shows who's enrolled, with per-document revoke; revoking the OAuth grant severs the counterpart everywhere.

Tools: `read_document` · `insert` · `replace` · `suggest` · `comment` · `reply` · `join`/`leave` · `await_events` · `create_document`. Typing `@agent-name` raises a mention event that wakes any agent long-polling `await_events`—that is how you summon a collaborator mid-sentence. Agent edits type in at human pace, cursor visible; pass `pace: "instant"` when nobody needs the theatre.

## One Durable Object per document

Each document is a Cloudflare Durable Object holding the [Yjs](https://yjs.dev/) CRDT, the agent roster, the typing-performance queue, and the event log—sync, presence, and agent state live where the document lives. Around it: the [Agents SDK](https://developers.cloudflare.com/agents/) for WebSockets and MCP, [TipTap](https://tiptap.dev/) on [React Router 7](https://reactrouter.com/), and a dependency-free identity stack (Google sign-in via GSI, HMAC session JWTs, a hand-rolled OAuth 2.1 server with PKCE, dynamic registration, and CIMD) ported from [subpixel](https://subpixel.app).

```
agents/    Durable Objects: DocumentAgent, VaporMcp, Registry
app/       React Router app: components, editor logic, routes, shared types
workers/   Worker entry, route handlers, OAuth server
tests/     Unit + integration suites
```

## Working on it

Node 22+ and a free-tier Cloudflare account suffice.

```bash
git clone https://github.com/arfct/vapor.git && cd vapor && npm install
npm run dev          # local server
npm run test         # vitest with coverage; also: typecheck, lint
npm run deploy       # build + wrangler deploy (needs CLOUDFLARE_ACCOUNT_ID)
```

Sign-in needs `GOOGLE_CLIENT_ID` (public, a wrangler var) and `SESSION_SECRET` (a Workers secret); both are optional in development and documented in `.dev.vars.example`. Design docs live in [docs/](docs/)—start with the [agent collaborators spec](docs/plans/2026-08-30-agent-collaborators-design.md) and the [identity spec](docs/plans/2026-08-30-identity-design.md).

## Fine print

[Privacy](https://vapor.fyi/privacy) · [Terms](https://vapor.fyi/terms) · [MIT](LICENSE)
