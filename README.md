# vapor

You paste a draft into chat and now there are two copies, both going stale. vapor gives the draft one URL instead: a live markdown document anyone can open and edit, people and AI agents side by side, each with a cursor. It deletes itself after 99 hours.

vapor is a single Cloudflare Worker you can run yourself: see [Running your own vapor](docs/self-hosting.md). The reference instance is [vapor.fyi](https://vapor.fyi); the examples below use it, and every command works the same against your own origin. A fork of [mist](https://github.com/inanimate-tech/mist).

## Documents

Anyone with the URL can read and edit. Live markdown with track changes (CriticMarkup), comments anchored to highlights, and a rendered preview. No accounts required, no save button, nothing kept past 99 hours—export before then.

```bash
curl https://vapor.fyi/new -T notes.md    # create from a file
curl https://vapor.fyi/<id>.md            # raw markdown back
```

## People and agents

Sign-in (Google or Apple) is optional and only changes attribution:

| | Human | Agent |
|---|---|---|
| Anonymous | Curious Ladybug 🐞 | Agentic Butterfly 🦋 |
| Signed in | Ada Lovelace | Ada's Claude |

Your anonymous animal lives in localStorage and follows you between documents. Sign in and your name takes over, earlier comments included. People are circles; agents are hexagons carrying the mark of the client they connected from, in their owner's colour. Your email never appears in a document: mentions carry a short public id, and `@` completion shows names.

## Connecting an agent

vapor is an [MCP](https://modelcontextprotocol.io) server. Two ways in:

```bash
# signed in: stable identity, write access if you grant it
claude mcp add --transport http vapor https://vapor.fyi/mcp

# anonymous: no setup, suggest and comment only
claude mcp add --transport http vapor https://vapor.fyi/mcp/anonymous
```

The same URL works in claude.ai, ChatGPT (developer mode), Codex CLI, Cursor, Gemini CLI, and VS Code. Every instance serves its own guide at `/mcp` (and `/llms.txt` for agents) with the snippet for each client, and every document's Share → Invite an agent dialog has the same.

Agents get suggest and comment by default; full write is a separate grant on the consent screen. Their edits type in at human pace with a visible cursor (`pace: "instant"` skips the show). Each document's Agents panel lists who's enrolled, with revoke.

Tools: `read_document` · `insert` · `replace` · `suggest` · `comment` · `reply` · `attach` · `create_document` · `join` · `leave` · `events_poll` · `events_subscribe`. Attachments (images inline, other files as a chip) need the signed-in endpoint with write. Mention the agent in a document (type `@` and pick it), or reply in one of its threads, and the agent hears about it: by polling `events_poll` for a while after sharing a link, or through a signed webhook from `events_subscribe`.

A fenced block whose language is `agent` carries standing instructions for agents. People don't see it in the rendered page; `read_document` returns it as `instructions`.

To have a mention wake an agent that isn't running anywhere, sign in and set a wake target once under Share → Invite an agent, in the Claude tab (routine) or the Other tab (webhook): a [Claude Code routine](https://code.claude.com/docs/en/routines)'s fire URL and token, or an HTTPS webhook. Every mention of your agent, and every reply in its threads, in any document it is on, fires it. The canonical routine prompt is at the end of the `/mcp` guide. Design in [the wake plan](docs/plans/2026-09-06-agent-wake-plan.md).

## The drafting habit

The vapor plugin for Claude Code bundles the MCP connection with a skill that changes where drafts live: plans and proposals go up as vapor docs instead of chat walls, Claude answers comments over MCP, and the settled document is exported to the repo before the 99-hour cliff. The bundled connection is the reference instance's signed-in endpoint — the first tool call prompts a Google sign-in and consent screen.

```bash
claude plugin marketplace add arfct/vapor
claude plugin install vapor@vapor
```

Just the skill, no plugin: every instance serves it at `/skill.md`, addressed to that instance (source in [`plugin/skills/vapor/SKILL.md`](plugin/skills/vapor/SKILL.md)):

```bash
curl -s https://vapor.fyi/skill.md --create-dirs -o ~/.claude/skills/vapor/SKILL.md
```

The skill is in the [Agent Skills](https://agentskills.io) format, so the same file works elsewhere. Codex CLI, Cursor, and GitHub Copilot all read `~/.agents/skills/`; Gemini CLI takes the whole thing, connection included, as an extension:

```bash
curl -s https://vapor.fyi/skill.md --create-dirs -o ~/.agents/skills/vapor/SKILL.md
gemini extensions install https://github.com/arfct/vapor
```

In a repository, `.agents/skills/vapor/SKILL.md` (a symlink here) gives every contributor's agent the workflow. `gemini-extension.json` and `skills/` at the root exist for the Gemini install and point at the same file. Running a fork and want the plugin to connect to it instead? [Shipping a plugin for your instance](docs/self-hosting.md#shipping-a-plugin-for-your-instance).

## Run your own

```bash
git clone https://github.com/arfct/vapor && cd vapor
npm install
npm run dev                       # http://localhost:5173, everything emulated locally
npx wrangler login
npx wrangler r2 bucket create vapor-attachments
npm run deploy                    # → https://vapor.<you>.workers.dev
```

That is a working instance. A custom domain, Google sign-in, the optional instance variables (`PUBLIC_ORIGIN`, `REDIRECT_HOSTS`, `OPERATOR_NAME`, `SOURCE_URL`), deploying from GitHub Actions, and keeping a separate production config are all in [docs/self-hosting.md](docs/self-hosting.md). Nothing in the code names a host: an instance describes itself from the URL it is served at.

## How it's built

Each document is one Cloudflare Durable Object holding the [Yjs](https://yjs.dev/) doc, agent roster, and event log. [TipTap](https://tiptap.dev/) and [React Router 7](https://reactrouter.com/) on the front, the [Agents SDK](https://developers.cloudflare.com/agents/) underneath, and a dependency-free auth stack (Google sign-in, OAuth 2.1 with PKCE and CIMD) ported from [subpixel](https://subpixel.app).

```
agents/    Durable Objects: DocumentAgent, VaporMcp, Registry
app/       React Router app
workers/   Worker entry, routes, OAuth server
deploy/    Per-instance wrangler configs (the reference instance's lives here)
tests/     Unit + integration
```

## Developing

Node 22+ (`.nvmrc`).

```bash
npm install
npm run dev      # local server
npm run test     # also: typecheck, lint
npm run deploy   # needs CLOUDFLARE_ACCOUNT_ID
```

Sign-in needs `SESSION_SECRET` (a Workers secret) and `GOOGLE_CLIENT_ID` and/or `APPLE_CLIENT_ID` (wrangler vars); all optional in development. See `.dev.vars.example`. Design docs live in [docs/plans/](docs/plans/); the architecture in [docs/technical-architecture.md](docs/technical-architecture.md).

[Privacy](https://vapor.fyi/privacy) · [Terms](https://vapor.fyi/terms) · [MIT](LICENSE)
