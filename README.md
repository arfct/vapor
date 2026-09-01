# vapor

You paste a draft into chat and now there are two copies, both going stale. vapor gives the draft one URL instead: a live markdown document anyone can open and edit, people and AI agents side by side, each with a cursor. It deletes itself after 99 hours.

Running at [vapor.fyi](https://vapor.fyi). A fork of [mist](https://github.com/inanimate-tech/mist).

## Documents

Anyone with the URL can read and edit. Live markdown with track changes (CriticMarkup), comments anchored to highlights, and a rendered preview. No accounts required, no save button, nothing kept past 99 hours—export before then.

```bash
curl https://vapor.fyi/new -T notes.md    # create from a file
curl https://vapor.fyi/<id>.md            # raw markdown back
```

## People and agents

Sign-in (Google) is optional and only changes attribution:

| | Human | Agent |
|---|---|---|
| Anonymous | Curious Ladybug 🐞 | Agentic Butterfly 🦋 |
| Signed in | Ada Lovelace | Ada's Agent |

Your anonymous animal lives in localStorage and follows you between documents. Sign in and your name takes over, earlier comments included.

## Connecting an agent

vapor is an [MCP](https://modelcontextprotocol.io) server. Two ways in:

```bash
# signed in: stable identity, write access if you grant it
claude mcp add --transport http vapor https://vapor.fyi/mcp

# anonymous: no setup, suggest and comment only
claude mcp add --transport http vapor https://vapor.fyi/mcp/anonymous
```

Agents get suggest and comment by default; full write is a separate grant on the consent screen. Their edits type in at human pace with a visible cursor (`pace: "instant"` skips the show). Mention `@agent-name` in a document to wake an agent waiting on `await_events`.

Tools: `read_document` · `insert` · `replace` · `suggest` · `comment` · `reply` · `join` · `leave` · `await_events` · `create_document`. Each document's Agents panel lists who's enrolled, with revoke.

## The drafting habit

The vapor plugin for Claude Code bundles the MCP connection with a skill that changes where drafts live: plans and proposals go up as vapor docs instead of chat walls, Claude answers comments over MCP, and the settled document is exported to the repo before the 99-hour cliff. The bundled connection is the signed-in door (`/mcp`) — the first tool call prompts a Google sign-in and consent screen.

```bash
claude plugin marketplace add arfct/vapor
claude plugin install vapor@vapor
```

Just the skill, no plugin (source in [`plugin/skills/vapor/SKILL.md`](plugin/skills/vapor/SKILL.md), served at [vapor.fyi/skill.md](https://vapor.fyi/skill.md)):

```bash
curl -s https://vapor.fyi/skill.md --create-dirs -o ~/.claude/skills/vapor/SKILL.md
```

## How it's built

Each document is one Cloudflare Durable Object holding the [Yjs](https://yjs.dev/) doc, agent roster, and event log. [TipTap](https://tiptap.dev/) and [React Router 7](https://reactrouter.com/) on the front, the [Agents SDK](https://developers.cloudflare.com/agents/) underneath, and a dependency-free auth stack (Google sign-in, OAuth 2.1 with PKCE and CIMD) ported from [subpixel](https://subpixel.app).

```
agents/    Durable Objects: DocumentAgent, VaporMcp, Registry
app/       React Router app
workers/   Worker entry, routes, OAuth server
tests/     Unit + integration
```

## Developing

Node 22+.

```bash
npm install
npm run dev      # local server
npm run test     # also: typecheck, lint
npm run deploy   # needs CLOUDFLARE_ACCOUNT_ID
```

Sign-in needs `GOOGLE_CLIENT_ID` (a wrangler var) and `SESSION_SECRET` (a Workers secret); both optional in development. See `.dev.vars.example`. Design docs live in [docs/plans/](docs/plans/).

[Privacy](https://vapor.fyi/privacy) · [Terms](https://vapor.fyi/terms) · [MIT](LICENSE)
