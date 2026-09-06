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

   Right after creating the document, call `join` on it over the signed-in MCP connection so your agent is on its roster. Mentions only reach agents on the roster, and if the user has set a wake target (Share → Invite an agent, under Claude or Other), a mention of your agent or a reply in your thread wakes their hosted agent even when this session is closed.
3. **Discuss.** The user comments and suggests in the browser. To respond in place, connect over MCP and use vapor's tools — `read_document`, `comment`, `reply`, `suggest`, and `attach` for an image or file (signed in, with write). `events_poll` returns what happened since your last cursor, and an `@mention` in the doc or a reply in your thread is what to watch for. If `read_document` returns `instructions`, the document's authors wrote them for you; follow them. One-time setup (already done if this skill came from the vapor plugin):

   ```bash
   claude mcp add --transport http vapor https://vapor.fyi/mcp
   ```

   `/mcp` is OAuth-gated: the first tool call opens a browser consent screen (Google sign-in, then a grant for read-only or write access). Comment and suggest work either way; only `insert`/`replace` need the write grant. For a zero-setup connection with no identity, use `/mcp/anonymous` instead — comment and suggest still work, but as an anonymous animal, not the signed-in name.

   After handing over a link, stay with the document for about ten minutes: poll `events_poll` for `mention` and `thread.reply`, waiting at least `retryAfterMs` between empty polls, and answer comments and mentions as they arrive — the reader is most likely reading right now. Tell the user you're watching, and stop early if they move the conversation on in chat. After that window, return to chat and pick the document back up when asked or mentioned. To leave standing guidance for other agents in the document, add a fenced block whose language is `agent`; readers don't see it, agents do.
4. **Revise in place.** A draft has one document for its whole life. When the discussion or a new decision calls for a rewrite, edit the existing document instead of creating another one: `read_document` for the current anchors, then `replace` from the first block to the last with the new markdown (one call rewrites the whole document), or `replace`/`insert` on the blocks that changed. The URL the user has stays valid, and comment threads stay attached to the text they were about. Creating a second document for a revision splits the review across links; do it only for a genuinely new draft.
5. **Archive.** This is the step that matters most and the one most easily forgotten: vapor is the review venue, not storage, and everything there — text, suggestions, comment threads — is gone 99 hours after creation. When the discussion settles (or before the clock runs out, settled or not), export back over the local file and commit it:

   ```bash
   curl https://vapor.fyi/<id>.md -o draft.md
   ```

   Pending suggestions export as CriticMarkup (`{++ ++}`, `{-- --}`); ask the user to accept or reject them in the browser first (anonymous agents cannot), and mention any still pending when archiving. Thread replies do not export — only the inline comment text does — so fold decisions reached in threads into the document body before the final export.

## When not to use

- Anything containing secrets or private data — every vapor URL is readable and editable by whoever has it.
- Documents that need no human review round-trip; a file in the repo is enough.
