# Markdown and CriticMarkup

How mist stores, imports, and exports document content.

## Goal

All content lives in a single Markdown file: the document text, formatting, suggested edits, comments, and thread metadata. The file is the canonical format. Success means **round-tripping with no loss**: download a document, upload it again, download it again — the two downloads are identical.

## Markdown

mist documents are plain Markdown. The underlying text retains the Markdown characters (`**bold**`, `# heading`, etc.) rather than converting to rich-text nodes. The Markdown you type is the Markdown you get back on download.

### Limitations

These are editor limitations that prevent perfect round-tripping in some cases:

- The editor is paragraph-based. Each line is an independent paragraph. There is no concept of nested block structures (e.g. a list item containing a blockquote) — these render correctly in preview but are flat paragraphs in the editor.
- No support for tables, footnotes, or extended Markdown syntax.

## CriticMarkup

Suggested edits use [CriticMarkup](https://criticmarkup.com/), a plain-text convention for tracking changes in Markdown files. mist supports four of the five CriticMarkup types.

### Supported syntax

| Type | Syntax | Example |
|------|--------|---------|
| Addition | `{++ ++}` | `{++new text++}` |
| Deletion | `{-- --}` | `{--removed text--}` |
| Comment | `{>> <<}` | `{>>This needs a citation<<}` |
| Highlight | `{== ==}` | `{==highlighted passage==}` |

### Not supported

| Type | Syntax | Alternative |
|------|--------|-------------|
| Substitution | `{~~old~>new~~}` | Use `{--old--}{++new++}` |

Importing a file with substitution syntax returns a 400 error with a message explaining the alternative.

### Suggest mode

When suggest mode is active, typing and deleting produce CriticMarkup instead of direct edits:

- **Typing new text** inserts it as an addition (`{++new text++}`).
- **Deleting text** marks it as a deletion (`{--deleted text--}`) — the text remains visible but struck through.
- **Deleting inside an existing addition** removes the added text normally (shrinks the addition).
- **Deleting already-deleted text** is a no-op.

Mode syncs across all connected clients.

### Highlight + comment pairing

A highlight can be paired with a comment to annotate a specific passage:

```
{==highlighted text==}{>>This is the comment about the highlighted text<<}
```

On import, this is split into two adjacent ranges: a highlight and a comment. The comment links to a thread (see below) while the highlight marks the passage being discussed.

### Accept and reject

Each suggestion (addition or deletion) can be accepted or rejected:

- **Accept addition**: the addition markers are removed, text stays.
- **Reject addition**: the text is removed.
- **Accept deletion**: the text is removed.
- **Reject deletion**: the deletion markers are removed, text stays.

### Limitations

- **Multi-paragraph CriticMarkup** is not supported. Each line is parsed independently, so a deletion that spans two paragraphs should be two separate deletions.
- **Precedence on export**: if text has multiple CriticMarkup types (which shouldn't normally happen), the serializer uses the first match in order: addition > deletion > comment > highlight.

## Comments and threads

Comment threads are stored in **YAML frontmatter** under the `vapor` key. The frontmatter is prepended on download and stripped on upload.

### Format

```yaml
---
vapor:
  threads:
    - comment: "This needs a citation"
      highlight: "highlighted passage"
      author: "Alice"
      color: "#e06c75"
      created: "2026-04-09T12:00:00.000Z"
      resolved: false
      replies:
        - author: "Bob"
          color: "#61afef"
          text: "Added a citation to Smith 2024"
          created: "2026-04-09T12:30:00.000Z"
---

Document content with {==highlighted passage==}{>>This needs a citation<<} goes here.
```

### How threads connect to the document

Threads are matched to comment marks in the document by comparing the `comment` field in the frontmatter with the comment text in the body. When a highlight is present, the `highlight` field records which passage the comment refers to.

### Thread fields

| Field | Required | Description |
|-------|----------|-------------|
| `comment` | yes | The comment text (matches `{>>text<<}` in the body) |
| `highlight` | no | The highlighted passage (matches `{==text==}` in the body) |
| `author` | yes | Display name |
| `color` | yes | Author's cursor/avatar colour |
| `created` | yes | ISO 8601 timestamp |
| `resolved` | yes | Whether the thread is resolved |
| `replies` | no | Array of reply objects (author, color, text, created) |

### Standalone comments

A comment without a highlight appears as a point marker in the document:

```
Some text{>>A note about this point in the document<<} continues here.
```

### Preserving other frontmatter

Any existing YAML frontmatter keys outside `mist` are preserved through the round-trip. mist only reads and writes the `mist` key.

## Round-trip contract

The export/import cycle should produce identical output:

1. **Download** serializes: CriticMarkup marks to delimiters, threads to YAML frontmatter.
2. **Upload** parses: CriticMarkup delimiters to marks, YAML frontmatter to threads.
3. **Download again** serializes the same state.

The two downloaded files should be byte-identical. If they are not, it is a bug.

### Known edge cases

- **Substitution syntax** is rejected on import — it must be manually converted to `{--old--}{++new++}` before uploading.

## References

- [CriticMarkup spec](https://criticmarkup.com/)
- [`critic-markup` npm package](https://www.npmjs.com/package/critic-markup)

## Mentions

A mention is a token, `@slug[+tag]~sid`, that the editor shows as a name (design: `docs/plans/2026-09-06-agent-identity-plan.md`):

- `@nicholas-jitkoff~k3f0a9x2` names a person. The slug is their display name for readers of the raw text; the eight-character short id is their public `uid` (or, for an anonymous person, their browser id) and is what resolves. Renames never break a mention.
- `@nicholas-jitkoff+agent~k3f0a9x2` names that person's counterpart agent: the same id with the `agent` tag. The server records a `mention` event for it and wakes the owner's agent if they set a wake target.
- `@claude-code~c41d7e90` names an anonymous agent: its client slug and a session id.

In the editor a token is a `mention` node (`app/lib/mention.ts`, mirrored in `richSchema`) rendered as `@Nicholas Jitkoff` in the owner's colour, with the id hidden; it deletes as one unit. In markdown, over MCP, in `/:id.md`, and in comment text the full token is what travels, so the document itself carries the exact identity. Comment bodies shown as plain text have their ids stripped for display (`stripMentionIds`).

Two rules keep the forms apart: a bare `@slug` still matches an agent by its internal name, so documents written before tokens keep working until they expire, and the `+` segment is reserved for agents, so a person is never mentioned by a tagged handle. Email addresses never enter a document: typing one after `@` offers a row that resolves it to a person (`GET /auth/resolve`, signed-in callers only) before the token is inserted, and bare addresses stay plain text, never auto-linked, in the editor or on import.

Mentions inside a comment reach agents through the body scan (comments are marked text in the body); mentions inside a thread reply are scanned when the reply lands.

## Version history

Every document keeps a short trail of markdown snapshots for its 99-hour life, in a `versions` table inside its Durable Object. A version is the whole document's markdown, CriticMarkup delimiters included, so it carries the same round-trip guarantee as `/:id.md` and an upload: restoring one feeds the markdown back through the same block builders an import uses.

Versions are taken when typing settles (60s idle), when the size swings by more than a fifth or ten minutes pass mid-edit, before an agent `replace`, before Accept all or Reject all, and before and after a restore. Each is attributed to whoever edited since the last one, humans through their Yjs client ids and awareness, agents through their roster label. Restore replaces every block in one transaction that connected browsers receive immediately; threads are untouched, so anchors present in the restored markdown come back with it. The trail is capped at 200 versions, oldest automatic ones pruned first, and dropped at expiry. The policy lives in `app/shared/version-policy.ts`; the HTTP surface is `GET|POST /agents/document-agent/:id/versions[/:vid[/restore]]`.
## Attachments

A file dropped, pasted, or picked into a document is stored in R2 under `<docId>/<attachmentId>` and lands in the text as an `attachment` block: images render inline, other files as a chip. Its canonical markdown is an image or a link standing alone in a paragraph at the attachment path, `![cat.png](/abcd1234/attachments/<id>/cat.png)` or `[report.pdf](/abcd1234/attachments/<id>/report.pdf)`. Only that path shape becomes an attachment; any other image stays literal text (a public document embeds no foreign images) and any other link stays a link. `/:id.md` and Download rewrite the paths to absolute URLs on the request's origin; an upload accepts either form.

Uploading needs a principal: a Google sign-in for people, the OAuth `/mcp` endpoint with `write` for agents. Viewing needs nothing. Limits and allowed types live in `app/shared/attachment-policy.ts` (20 MB a file, 100 MB and 100 files a document, 500 MB and 200 uploads per account a day; images, PDF, text, CSV, JSON, zip, and office formats, sniffed server-side). Attachments expire with the document.

