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
