# WYSIWYG editing as the default

**Goal:** Documents render rich by default — headings, lists, quotes, code blocks as real nodes, no visible markdown syntax — while markdown remains the storage-interchange format for exports, raw endpoints, and agents.

**Part of the [notes-app import series](2026-08-31-notes-import-overview.md).** The largest plan; plans 1–2 should land first. Plan 4 (toolbar) builds directly on this.

## Where vapor is vs. where the notes app is

vapor today: the Yjs fragment is a flat list of `paragraph` elements, one per markdown *line*, whose text is the literal markdown (`**bold**`, `# Heading`, `{++added++}`). [markdown-decorations.ts](../../app/lib/markdown-decorations.ts) styles the syntax in place; [critic-parser/serializer](../../app/lib/critic-parser.ts) translate CriticMarkup text ↔ ProseMirror marks; [y-markdown.ts](../../app/lib/y-markdown.ts) reads blocks server-side by concatenating text runs and re-wrapping critic delimiters; `blockHash` anchors hash that literal text.

The notes app: TipTap StarterKit nodes edited rich; markdown only at the boundary (`getMarkdown()` / `setContent(md)`).

The import is therefore **a document-model change**, not a rendering toggle: the shared Yjs fragment starts holding real heading/list/quote/code nodes, and every consumer of "block text" moves to a serializer.

## Decisions

- **The CRDT holds rich nodes.** Schema: StarterKit (heading 1–3, bullet/ordered lists, blockquote, codeBlock, horizontalRule, hardBreak) + vapor's critic marks + collaboration/caret. Tables, task lists, underline are *enabled in the schema* from day one (so the doc format doesn't change again) but get UI only in plan 4 / roadmap.
- **One serialization module, shared client/server.** New `app/shared/rich-markdown.ts` built on `prosemirror-model` + `prosemirror-markdown` (pure JS — runs in Workers): a schema instance, a `MarkdownParser` and `MarkdownSerializer` extended with CriticMarkup delimiters for the four critic marks. Converts via `y-prosemirror` helpers (`yXmlFragmentToProseMirrorRootNode`, `prosemirrorToYXmlFragment`). This **replaces `y-markdown.ts`** and the import/export halves of critic-parser/serializer (the parser stays for `/new` ingestion of critic syntax).
- **Anchors hash the block's markdown.** `blockHash` is computed over each top-level node's markdown serialization — content-derived, identical on every client, and stable for unchanged blocks. `read_document` returns markdown per block. **`suggest.find` matches plain text** (`node.textContent`), because agents quote what they read and offsets must map to document positions; tool descriptions updated to say so.
- **No literal critic delimiters in the doc.** Suggestions and comments exist purely as marks; `{++…++}` appears only in exports and raw endpoints. Consequences: `markdown-decorations.ts` and the `cm-delimiter` widgets are deleted; **clean view is retired** (there is no markup to hide — `CleanViewToggle` goes away).
- **Preview becomes Source.** WYSIWYG makes the rendered preview redundant. The mode menu's Preview item becomes **Markdown** — a read-only view of the serialized markdown (the inverse of today). `P`-hold keeps working, showing source.
- **Typing performance engine goes block-structured.** Agent inserts parse markdown → nodes; the engine appends each block element, then types its text run-by-run *with formatting attributes* (`Y.XmlText.insert(idx, text, attrs)`), so styled text styles while typing. Multi-block inserts animate block-by-block — this also delivers the previously approved fix for multi-paragraph inserts skipping animation, and pace retunes to ~40–70 WPM in the same change.
- **Old documents are not migrated.** A pre-change doc opens as flat paragraphs of literal markdown text in the new schema (valid, just unstyled) and expires within 99 hours. The onboarding template is re-imported through the new parser at creation, so new docs are born rich.

## Phases

**A. Serialization core (server-safe, test-heavy).** `rich-markdown.ts` with round-trip property tests: markdown → nodes → markdown stable for the whole feature matrix (headings, nested lists, quotes, fenced code with language, hr, inline marks, links, critic syntax, mixed nesting). Port `getBlocks`/`yDocToMarkdown`/`buildMarkdownBlocks`/insert helpers onto it. Delete `y-markdown.ts`.

**B. Client editor.** Enable StarterKit nodes in [useYjsEditor.ts](../../app/lib/useYjsEditor.ts) / Editor extensions; remove markdown-decorations and delimiter CSS; wire markdown paste (clipboard markdown → parsed nodes) and `/new` body ingestion through the parser; input rules (`#`, `-`, `1.`, `` ``` ``, `>`) + Typography. Suggest-mode plugin re-verified over rich nodes (marks apply across node boundaries — the existing `inclusive: false` marks carry over).

**C. Agent pipeline.** [document.ts](../../agents/document.ts): blocks/anchors/read/insert/replace/suggest/comment on the new serializer; performance engine rework as decided above; `exportMarkdown` and `/:id.md` through the serializer; `validateNewDocumentMarkdown` updated for what the schema accepts. Tool descriptions in [mcp-tools.ts](../../agents/mcp-tools.ts) updated (plain-text `find`, markdown block content).

**D. UI reconciliation.** Mode menu: Preview → Markdown (source view component reusing `.preview`-era styling for `<pre>`); CleanViewToggle removed; thread/comment click-targets and the scroll-to-highlight behavior re-verified over rich nodes; onboarding template re-authored rich.

Each phase merges independently behind a green suite; the doc format flips when B lands, so A+B ship in one PR, C immediately after (agents mis-anchor against rich docs until C — acceptable only within one deploy window; prefer shipping A+B+C together to production).

## Regression surfaces (the reason this plan is XL)

- **Comment threads**: `threadIdForComment` hashes comment text — unaffected — but mark scanning (`scanDocumentComments`) walks the doc; re-verify over nested nodes and the Start-Editing timer fix.
- **Suggest mode**: intercepting edits inside lists/headings; accept/reject across block boundaries (`processAllRanges` walks the whole doc — retest).
- **Awareness cursors** inside nested nodes (collaboration-caret handles this; verify labels).
- **blockHash drift**: any serializer nondeterminism (list tightness, escaping) breaks agent anchors between clients — the round-trip property tests are the gate.
- **Rate limits** count mutated chars — unchanged semantics, but recount against serialized length.

## Out of scope

Toolbar buttons (plan 4), tables/task-list UI, attachments, version history (roadmap).
