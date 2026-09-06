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

The same URL works in claude.ai, ChatGPT (developer mode), Codex CLI, Cursor, Gemini CLI, and VS Code; [vapor.fyi/mcp](https://vapor.fyi/mcp) has the snippet for each, and every document's Share → Invite an agent dialog has the same.

Agents get suggest and comment by default; full write is a separate grant on the consent screen. Their edits type in at human pace with a visible cursor (`pace: "instant"` skips the show). Each document's Agents panel lists who's enrolled, with revoke.

Tools: `read_document` · `insert` · `replace` · `suggest` · `comment` · `reply` · `attach` · `create_document` · `join` · `leave` · `events_poll` · `events_subscribe`. Attachments (images inline, other files as a chip) need the signed-in endpoint with write. Mention `@agent-name` in a document, or reply in one of its threads, and the agent hears about it: by polling `events_poll` for a while after sharing a link, or through a signed webhook from `events_subscribe`.

A fenced block whose language is `agent` carries standing instructions for agents. People don't see it in the rendered page; `read_document` returns it as `instructions`.

To have a mention wake a Claude that isn't running anywhere, point `events_subscribe` at a relay that fires a [Claude Code routine](https://code.claude.com/docs/en/routines): [`relay/`](relay/) is a 60-line Worker that verifies vapor's signed webhook and forwards the event as the routine's fire text. Set `VAPOR_RELAY_URL` and `VAPOR_RELAY_SECRET` in your shell and the vapor skill subscribes every document it creates. Details in [the events plan](docs/plans/2026-08-31-mcp-events-polyfill-plan.md#the-routine-relay).

## The drafting habit

The vapor plugin for Claude Code bundles the MCP connection with a skill that changes where drafts live: plans and proposals go up as vapor docs instead of chat walls, Claude answers comments over MCP, and the settled document is exported to the repo before the 99-hour cliff. The bundled connection is the signed-in endpoint (`/mcp`) — the first tool call prompts a Google sign-in and consent screen.

```bash
claude plugin marketplace add arfct/vapor
claude plugin install vapor@vapor
```

Just the skill, no plugin (source in [`plugin/skills/vapor/SKILL.md`](plugin/skills/vapor/SKILL.md), served at [vapor.fyi/skill.md](https://vapor.fyi/skill.md)):

```bash
curl -s https://vapor.fyi/skill.md --create-dirs -o ~/.claude/skills/vapor/SKILL.md
```

The skill is in the [Agent Skills](https://agentskills.io) format, so the same file works elsewhere. Codex CLI, Cursor, and GitHub Copilot all read `~/.agents/skills/`; Gemini CLI takes the whole thing, connection included, as an extension:

```bash
curl -s https://vapor.fyi/skill.md --create-dirs -o ~/.agents/skills/vapor/SKILL.md
gemini extensions install https://github.com/arfct/vapor
```

In a repository, `.agents/skills/vapor/SKILL.md` (a symlink here) gives every contributor's agent the workflow. `gemini-extension.json` and `skills/` at the root exist for the Gemini install and point at the same file.

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
