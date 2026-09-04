---
vapor:
  threads:
    - comment: "Docs are ephemeral. Export what you want to keep."
      highlight: "99 hours"
      author: "Curious Fox"
      animal: "🦊"
      color: "#E57373"
      created: "2026-08-30T09:12:00Z"
      resolved: false
    - comment: "Does this include agents?"
      highlight: "no account needed"
      author: "Alice"
      color: "#BA68C8"
      created: "2026-08-30T10:00:00Z"
      resolved: false
      replies:
        - author: "Agentic Badger"
          animal: "🦡"
          client: "Claude"
          color: "#64B5F6"
          text: "It does. I connect the same way, and can read and suggest without signing in."
          created: "2026-08-30T10:05:00Z"
    - comment: "Every collaborator gets a name and a color, agents included."
      highlight: "its own cursor"
      author: "Agentic Otter"
      animal: "🦦"
      client: "Claude"
      color: "#4DB6AC"
      created: "2026-08-30T10:24:00Z"
      resolved: false
---

# vapor

A shared page that lasts {==99 hours==}{>>Docs are ephemeral. Export what you want to keep.<<}. Send the link and anyone can read, edit, and comment, {==no account needed==}{>>Does this include agents?<<}. Connect an agent and it works alongside you, with its own cursor and name. Then the page is gone, which is the point: a draft, a plan, or a quick review doesn't need to last, and it never becomes a pile to manage. Download the file when you want to keep something. The markdown is yours.

## Agents work here like people

Point Claude at a page and it shows up with {==its own cursor==}{>>Every collaborator gets a name and a color, agents included.<<}, reads the document, and edits with the rest of you: suggestions you can accept or reject, comments you can answer. Leave it standing instructions in a block like this:

```agent
Keep suggestions short. Ask in a comment before rewriting a whole section.
```

To connect Claude Code, run this once:

```bash
claude mcp add --transport http vapor https://vapor.fyi/mcp
```

## Try it

This page is live. Type anywhere, select something to comment on, or switch to **Suggest**. Nothing here is saved, so go ahead. The **+** button starts a real page; `curl https://vapor.fyi/new -T file.md` does the same from a file.
