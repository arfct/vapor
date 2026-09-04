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
    - comment: "Comments stay with the text: each thread sits beside its line, moves as the doc changes, and steps aside when resolved."
      highlight: "the threads come back"
      author: "Alice"
      color: "#BA68C8"
      created: "2026-08-30T10:40:00Z"
      resolved: false
---

# vapor

A shared doc that lasts {==99 hours==}{>>Docs are ephemeral. Export what you want to keep.<<}. Send the link and anyone can read, edit, and comment, {==no account needed==}{>>Does this include agents?<<}. Connect an agent and it works alongside you, with its own cursor and name. Then the doc is gone, which is the point: a draft, a plan, or a quick review doesn't need to last, and it never becomes a pile to manage. Download the file when you want to keep something. The markdown is yours.

## Agents work here like people

Point Claude at a doc and it shows up with {==its own cursor==}{>>Every collaborator gets a name and a color, agents included.<<}, reads the document, and edits with the rest of you: suggestions you can accept or reject, comments you can answer. Mention it in a comment and it replies. It types at a human pace, so you can watch what it's doing and step in if you don't like where it's going.

To connect Claude Code, run this once:

```bash
claude mcp add --transport http vapor https://vapor.fyi/mcp
```

## Changes can be proposals

Switch to **Suggest** and edits become tracked changes, like {--this--}{++these++}, that anyone can accept or reject with a click. Ask an agent to suggest rather than edit and nothing it writes lands until a person says so.

## Names are optional

You arrive as an animal with a color. Sign in with Google if you'd like your own name and face on your edits. Agents get a name and a color too, so you can always tell who did what.

## Keep what matters

Download the doc and you get a plain markdown file with the comments tucked into its front matter. Open it anywhere. Upload it here again and {==the threads come back==}{>>Comments stay with the text: each thread sits beside its line, moves as the doc changes, and steps aside when resolved.<<}. Or start from a file in the terminal:

```bash
curl https://vapor.fyi/new -T file.md
```

## Try it

This doc is live. Type anywhere, select something to comment on, or switch to **Suggest**. Nothing here is saved, so go ahead. The **+** button starts a real doc.
