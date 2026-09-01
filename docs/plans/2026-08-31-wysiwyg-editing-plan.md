# WYSIWYG editing as the default

**Goal:** Documents render rich by default — headings, lists, quotes, code blocks as real nodes, no visible markdown syntax — while markdown remains the storage-interchange format for exports, raw endpoints, and agents.

**Part of the [notes-app import series](2026-08-31-notes-import-overview.md).** The largest plan; plans 1–2 should land first. Plan 4 (toolbar) builds directly on this.

## Where vapor is vs. where the notes app is

vapor today: the Yjs fragment is a flat list of `paragraph` elements, one per markdown *line*, whose text is the literal markdown (`**bold**`, `# Heading`, `{++added++}`). [markdown-decorations.ts](../../app/lib/markdown-decorations.ts) styles the syntax in place; [critic-parser/serializer](../../app/lib/critic-parser.ts) translate CriticMarkup text ↔ ProseMirror marks; [y-markdown.ts](../../app/lib/y-markdown.ts) reads blocks server-side by concatenating text runs and re-wrapping critic delimiters; `blockHash` anchors hash that literal text.

The notes app: TipTap StarterKit nodes edited rich; markdown only at the boundary (`getMarkdown()` / `setContent(md)`).

The import is therefore **a document-model change**, not a rendering toggle: the shared Yjs fragment starts holding real heading/list/quote/code nodes, and every consumer of "block text" moves to a serializer.

## The data model, evaluated

Two candidate live models were considered. *Markdown text per block in the CRDT* (closer to today) keeps stored bytes agent-native, but WYSIWYG over it requires mapping rich edits back to syntax edits — concurrent restyling of the same sentence produces interleaved `**` fragments, because the CRDT merges characters, not markdown grammar. It only works when one writer holds the document at a time, which is the opposite of vapor. *Rich ProseMirror nodes in the CRDT* merges concurrent edits at character level even inside formatting, and keeps suggestions/comments as CRDT-positioned marks that survive simultaneous human and agent edits. Rich-in-CRDT wins; markdown remains the interchange dialect at every boundary (agents, exports, raw endpoints, cold store).

## Decisions

- **The CRDT holds rich nodes.** Schema: StarterKit (heading 1–3, bullet/ordered lists, blockquote, codeBlock, horizontalRule, hardBreak) + vapor's critic marks + collaboration/caret. Tables and task lists are *enabled in the schema* from day one (so the doc format doesn't change again) but get UI only in plan 4 / roadmap.
- **The schema stays markdown-complete.** Every node and mark must have a canonical GFM + CriticMarkup form, so markdown round-trips losslessly and the derived layers below stay truthful. Consequence: **underline is dropped** from the import (no markdown syntax; the `<u>` inline-HTML passthrough alternative was considered and rejected as a leak into every agent read). Plan 4's toolbar ships B/I/S without U.
- **Blocks get persistent IDs; hashes demote to staleness checks.** Each top-level block carries an immutable short id as a node attribute, assigned at creation by a small ProseMirror plugin and synced through Yjs like any attribute. Agent addressing changes accordingly:
  - `read_document` returns `{id, hash, markdown}` per block; `insert`/`suggest`/`comment` target the **block id**, which survives edits and moves — today's content-hash anchors go stale on any edit and silently race concurrent typing.
  - Mutating tools also send the last-seen `hash`; on mismatch the DocumentAgent rejects with a `stale_block` error carrying the current block, so agents re-read instead of mis-anchoring. Better failure mode than drift.
  - `await_events` gains block-level change events ("block b7 changed"), enabling incremental agent loops instead of full re-reads.
- **One serialization module, shared client/server.** New `app/shared/rich-markdown.ts` built on `prosemirror-model` + `prosemirror-markdown` (pure JS — runs in Workers): a schema instance, a `MarkdownParser` and `MarkdownSerializer` extended with CriticMarkup delimiters for the four critic marks. Converts via `y-prosemirror` helpers (`yXmlFragmentToProseMirrorRootNode`, `prosemirrorToYXmlFragment`). This **replaces `y-markdown.ts`** and the import/export halves of critic-parser/serializer (the parser stays for `/new` ingestion of critic syntax). The serializer must be deterministic (normalized list markers, escaping, tightness) — hashes and future cold-store diffs depend on it; round-trip property tests are the gate.
- **`suggest.find` matches plain text** (`node.textContent`), because agents quote what they read and offsets must map to document positions; tool descriptions updated to say so.
- **No literal critic delimiters in the doc.** Suggestions and comments exist purely as marks; `{++…++}` appears only in exports and raw endpoints. Consequences: `markdown-decorations.ts` and the `cm-delimiter` widgets are deleted; **clean view is retired** (there is no markup to hide — `CleanViewToggle` goes away).
- **Preview becomes Source.** WYSIWYG makes the rendered preview redundant. The mode menu's Preview item becomes **Markdown** — a read-only view of the serialized markdown (the inverse of today). `P`-hold keeps working, showing source.
- **Typing performance engine goes block-structured.** Agent inserts parse markdown → nodes; the engine appends each block element, then types its text run-by-run *with formatting attributes* (`Y.XmlText.insert(idx, text, attrs)`), so styled text styles while typing. Multi-block inserts animate block-by-block — this also delivers the previously approved fix for multi-paragraph inserts skipping animation, and pace retunes to ~40–70 WPM in the same change.
- **Old documents are not migrated.** A pre-change doc opens as flat paragraphs of literal markdown text in the new schema (valid, just unstyled) and expires within 99 hours. The onboarding template is re-imported through the new parser at creation, so new docs are born rich.

## Cold store projection (designed now, built later)

A future database layer stores **two representations, both derived from the live DO**:

1. **Yjs snapshot blob** — opaque binary, the only representation that can rehydrate a live collaborative session with full mark/position fidelity.
2. **A `blocks` projection** — `(doc_id, block_id, position, markdown, hash, updated_at)` plus the existing threads data. Queryable, human-readable, durable against schema evolution (markdown doesn't rot the way ProseMirror JSON does when node specs change). Block IDs are what make this table possible — content-hash addressing gives a block no identity across time, so per-block history and diffs can't exist without them.

Hard rule: the DO + Yjs pair stays the live source of truth; the database is a projection (and, if documents ever outlive 99 hours, an archive) — never a write path the CRDT syncs *from*. Nothing in this plan builds the store; the block-ID and determinism decisions above are what keep it cheap to add.

## Phases

**A. Serialization core (server-safe, test-heavy).** `rich-markdown.ts` with round-trip property tests: markdown → nodes → markdown stable for the whole feature matrix (headings, nested lists, quotes, fenced code with language, hr, inline marks, links, critic syntax, mixed nesting). Schema includes the block-id attribute. Port `getBlocks`/`yDocToMarkdown`/`buildMarkdownBlocks`/insert helpers onto it. Delete `y-markdown.ts`.

**B. Client editor.** Enable StarterKit nodes in [useYjsEditor.ts](../../app/lib/useYjsEditor.ts) / Editor extensions; the block-id plugin (assign missing ids on creation; on block split, the block containing the original start keeps the id and the remainder gets a fresh one); remove markdown-decorations and delimiter CSS; wire markdown paste (clipboard markdown → parsed nodes) and `/new` body ingestion through the parser; input rules (`#`, `-`, `1.`, `` ``` ``, `>`) + Typography. Suggest-mode plugin re-verified over rich nodes (marks apply across node boundaries — the existing `inclusive: false` marks carry over).

**C. Agent pipeline and protocol.** [document.ts](../../agents/document.ts): blocks/read/insert/replace/suggest/comment addressed by block id with hash staleness checks (`stale_block` added to `AgentErrorCode`, response carries the current block); block-level change events in `await_events`; agent-side inserts assign ids server-side; performance engine rework as decided above; `exportMarkdown` and `/:id.md` through the serializer; `validateNewDocumentMarkdown` updated for what the schema accepts. Tool schemas and descriptions in [mcp-tools.ts](../../agents/mcp-tools.ts) updated (block ids, `expected_hash`, plain-text `find`, markdown block content).

**D. UI reconciliation.** Mode menu: Preview → Markdown (source view component reusing `.preview`-era styling for `<pre>`); CleanViewToggle removed; thread/comment click-targets and the scroll-to-highlight behavior re-verified over rich nodes; onboarding template re-authored rich.

Each phase merges independently behind a green suite; the doc format flips when B lands, so A+B ship in one PR, C immediately after (agents mis-anchor against rich docs until C — acceptable only within one deploy window; prefer shipping A+B+C together to production).

## Regression surfaces (the reason this plan is XL)

- **Comment threads**: `threadIdForComment` hashes comment text — unaffected — but mark scanning (`scanDocumentComments`) walks the doc; re-verify over nested nodes and the Start-Editing timer fix.
- **Suggest mode**: intercepting edits inside lists/headings; accept/reject across block boundaries (`processAllRanges` walks the whole doc — retest).
- **Awareness cursors** inside nested nodes (collaboration-caret handles this; verify labels).
- **Serializer determinism**: any nondeterminism (list tightness, escaping) makes staleness hashes disagree between clients — the round-trip property tests are the gate.
- **Block-id integrity**: ids must survive splits/joins per the plugin policy and never duplicate (paste of copied blocks must re-mint ids); duplicated ids silently misroute agent edits.
- **Rate limits** count mutated chars — unchanged semantics, but recount against serialized length.

## Out of scope

Toolbar buttons (plan 4), tables/task-list UI, attachments, version history (roadmap).
