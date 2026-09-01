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

   The response body is the document URL.
3. **Discuss.** The user comments and suggests in the browser. To respond in place, connect over MCP and use vapor's tools — `read_document`, `comment`, `reply`, `suggest`; `await_events` blocks until something happens, and an `@mention` in the doc wakes a waiting agent. One-time setup (already done if this skill came from the vapor plugin):

   ```bash
   claude mcp add --transport http vapor https://vapor.fyi/mcp
   ```

   `/mcp` is OAuth-gated: the first tool call opens a browser consent screen (Google sign-in, then a grant for read-only or write access). Comment and suggest work either way; only `insert`/`replace` need the write grant. For a zero-setup connection with no identity, use `/mcp/anonymous` instead — comment and suggest still work, but as an anonymous animal, not the signed-in name.

   After sharing, return to chat — the user comes back with feedback there. Block on `await_events` only when asked to stay in the doc.
4. **Save.** When the discussion settles, export back over the local file and commit it:

   ```bash
   curl https://vapor.fyi/<id>.md -o draft.md
   ```

   This step is not optional — the vapor URL dies within 99 hours. Pending suggestions export as CriticMarkup (`{++ ++}`, `{-- --}`); ask the user to accept or reject them in the browser first (anonymous agents cannot), and mention any still pending when saving.

## When not to use

- Anything containing secrets or private data — every vapor URL is readable and editable by whoever has it.
- Documents that need no human review round-trip; a file in the repo is enough.
