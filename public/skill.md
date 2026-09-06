---
name: vapor
description: Use when writing a plan, spec, proposal, or any draft the user will want to review, comment on, or iterate on together — before pasting a long document into chat.
---

# Reviewing drafts on vapor

vapor (https://vapor.fyi) hosts live markdown documents that people and agents edit together in the browser — comments, suggestions (track changes), a visible cursor each. Anyone with the URL can edit. Documents self-delete after 99 hours: vapor is the review venue, the repo is storage.

## Workflow

1. **Draft locally.** Write the document to a file as usual (plans go in `docs/plans/`).
2. **Share.** Create a doc and hand the user the URL instead of pasting the document into chat:

   ```bash
   curl https://vapor.fyi/new -T draft.md
   ```

   The response body is the document URL. Share that link liberally: include it every time the document comes up in chat — when you hand it over, when you report progress, when you ask for a decision — so the reader never has to scroll back to find it.

   If the shell has `VAPOR_RELAY_URL` and `VAPOR_RELAY_SECRET` set (check with `printenv`), the user runs a relay that wakes a hosted Claude routine on their behalf. Wire the new document to it right after creating it: over the signed-in MCP connection, call `events_subscribe` twice, once with `name: "mention"` and once with `name: "thread.reply"`, passing the document id, `url` = `$VAPOR_RELAY_URL`, and `secret` = `$VAPOR_RELAY_SECRET`. The subscription lasts the document's lifetime, so this is the only time it needs doing. Tell the user the document is wired; from then on, mentions and thread replies reach the routine even when this session is closed. If the variables are absent, skip this and rely on the watching window below.
3. **Discuss.** The user comments and suggests in the browser. To respond in place, connect over MCP and use vapor's tools — `read_document`, `comment`, `reply`, `suggest`, and `attach` for an image or file (signed in, with write). `events_poll` returns what happened since your last cursor, and an `@mention` in the doc or a reply in your thread is what to watch for. If `read_document` returns `instructions`, the document's authors wrote them for you; follow them. One-time setup (already done if this skill came from the vapor plugin):

   ```bash
   claude mcp add --transport http vapor https://vapor.fyi/mcp
   ```

   `/mcp` is OAuth-gated: the first tool call opens a browser consent screen (Google sign-in, then a grant for read-only or write access). Comment and suggest work either way; only `insert`/`replace` need the write grant. For a zero-setup connection with no identity, use `/mcp/anonymous` instead — comment and suggest still work, but as an anonymous animal, not the signed-in name.

   After handing over a link, stay with the document for about ten minutes: poll `events_poll` for `mention` and `thread.reply`, waiting at least `retryAfterMs` between empty polls, and answer comments and mentions as they arrive — the reader is most likely reading right now. Tell the user you're watching, and stop early if they move the conversation on in chat. After that window, return to chat and pick the document back up when asked or mentioned. To leave standing guidance for other agents in the document, add a fenced block whose language is `agent`; readers don't see it, agents do.
4. **Archive.** This is the step that matters most and the one most easily forgotten: vapor is the review venue, not storage, and everything there — text, suggestions, comment threads — is gone 99 hours after creation. When the discussion settles (or before the clock runs out, settled or not), export back over the local file and commit it:

   ```bash
   curl https://vapor.fyi/<id>.md -o draft.md
   ```

   Pending suggestions export as CriticMarkup (`{++ ++}`, `{-- --}`); ask the user to accept or reject them in the browser first (anonymous agents cannot), and mention any still pending when archiving. Thread replies do not export — only the inline comment text does — so fold decisions reached in threads into the document body before the final export.

## When not to use

- Anything containing secrets or private data — every vapor URL is readable and editable by whoever has it.
- Documents that need no human review round-trip; a file in the repo is enough.
