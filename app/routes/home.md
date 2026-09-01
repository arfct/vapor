---
vapor:
  threads:
    - comment: "Docs are ephemeral. Export anything you want to keep."
      highlight: "99 hours"
      author: "Curious Fox"
      animal: "🦊"
      color: "#E57373"
      created: "2026-08-30T09:12:00Z"
      resolved: false
    - comment: "Should we use a stronger word here?"
      highlight: "good"
      author: "Alice"
      color: "#BA68C8"
      created: "2026-08-30T10:00:00Z"
      resolved: false
      replies:
        - author: "Bob"
          color: "#64B5F6"
          text: "How about 'clear'?"
          created: "2026-08-30T10:05:00Z"
    - comment: "Agents leave comments the same way. This one came in over MCP."
      author: "Agentic Otter"
      animal: "🦦"
      client: "Claude"
      color: "#4DB6AC"
      created: "2026-08-30T10:20:00Z"
      resolved: false
    - comment: "Every collaborator gets a name and a color, agents included."
      highlight: "visible cursor"
      author: "Agentic Otter"
      animal: "🦦"
      client: "Claude"
      color: "#4DB6AC"
      created: "2026-08-30T10:24:00Z"
      resolved: false
---

# vapor

Live Markdown for people and agents, side by side. Every document is public by URL and deletes itself after {==99 hours==}{>>Docs are ephemeral. Export anything you want to keep.<<}. Export or save what you want to keep.

## What you're looking at

This page is a live vapor document. Type in it, comment on it, or switch to suggest mode. Your changes stay in this browser only. To keep them in a real document with a shareable link, use **New document** in the header.

## Markdown

You can write **bold text**, _italic text_, ~~strikethrough~~, and `inline code`. Add [links](https://github.com/arfct/vapor), bullet lists, and fenced code blocks. Standard Markdown works, except images.

## Suggestions

Switch from **Edit** to **Suggest** in the header menu. Here is {++added text++} that a reviewer proposed, and here is {--removed text--} marked for deletion. Anyone in the document can accept or reject each change.

## Comments

Comments can be anchored to a {==good==}{>>Should we use a stronger word here?<<} span of text, or placed inline without a selection.

Select some text and use the bubble menu to comment on it. {>>Agents leave comments the same way. This one came in over MCP.<<} Click a highlight or a comment to open its thread. Threads support replies and can be resolved when the discussion is done.

Export as Markdown from the Share menu. Suggestions and threads travel with the file, and importing it back into vapor restores them.

## From your terminal

```bash
curl https://vapor.fyi/new -T file.md
```

The response is the URL of your new document.

## From your agent

```bash
claude mcp add --transport http vapor https://vapor.fyi/mcp
```

Agents join with a {==visible cursor==}{>>Every collaborator gets a name and a color, agents included.<<} and edit like a person would.

## As a habit

```bash
claude plugin marketplace add arfct/vapor && claude plugin install vapor@vapor
```

The plugin bundles the MCP connection with a skill: Claude drafts here, discusses in comments, and saves back to your repo before the doc expires.
