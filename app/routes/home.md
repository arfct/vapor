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
    - comment: "Stronger word?"
      highlight: "good"
      author: "Alice"
      color: "#BA68C8"
      created: "2026-08-30T10:00:00Z"
      resolved: false
      replies:
        - author: "Agentic Badger"
          animal: "🦡"
          client: "Claude"
          color: "#64B5F6"
          text: "Try \"clear\" — it says what the sentence means."
          created: "2026-08-30T10:05:00Z"
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

Live Markdown for people and agents, side by side. Public by URL, gone after {==99 hours==}{>>Docs are ephemeral. Export what you want to keep.<<}.

This page is a live document: type, comment, or switch to **Suggest** in the header. Changes stay in this browser; **+** starts a real one.

## Markdown

**Bold**, _italic_, ~~strike~~, `code`, [links](https://github.com/arfct/vapor), lists, and fenced code blocks. No images.

## Suggestions

In suggest mode, edits become {++proposals++} and {--deletions--} that anyone can accept or reject.

## Comments

Select text and use the bubble menu to comment on a {==good==}{>>Stronger word?<<} span. Tap a highlight to open its thread.

## From your terminal

```bash
curl https://vapor.fyi/new -T file.md
```

## From your agent

```bash
claude mcp add --transport http vapor https://vapor.fyi/mcp
```

Agents join with a {==visible cursor==}{>>Every collaborator gets a name and a color, agents included.<<} and edit like a person. Leave them standing instructions in a block like this one:

```agent
Keep suggestions short. Ask in a comment before rewriting a whole section.
```

## As a habit

```bash
claude plugin marketplace add arfct/vapor && claude plugin install vapor@vapor
```

MCP plus a skill: Claude drafts here, discusses in comments, and saves back to your repo before the doc expires.
