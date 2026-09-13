# Image sizing and placement

**Issue:** [#109](https://github.com/arfct/vapor/issues/109). **Branch:** `feat/109-image-sizing`.

**Goal:** A person selects an image in a document and picks its width and its alignment from a small set, including one width that fills the page past the text column. The choice survives `/:id.md`, the EPUB, the print page, and an agent's read over MCP, because it is written into the markdown rather than held beside it.

**Relationship to other plans:** extends the [attachments plan](2026-09-05-attachments-plan.md), which listed "image resizing or thumbnails" under Out of scope. Nothing here changes upload, storage, serving, or expiry. It adds two attributes to the `attachment` node and a rendering path for them.

## Decisions

### 1. Layout metadata rides in a Pandoc-style attribute block

The form is an image, alone in a paragraph, followed by a brace block:

```markdown
![cat.png](/abc/attachments/x1y2/cat.png){width=50% align=left}
![banner.png](/abc/attachments/x1y2/banner.png){width=full}
```

`width` is a percent from 1% to 100%, or the token `full`. `align` is `left`, `center`, or `right`. Both are optional and independent. `align` has no visible effect at `width=100%` or `width=full`, where the block already fills its container; it is stored and serialized anyway rather than being stripped, so that lowering the width restores the alignment the person last chose.

Three other conventions were considered. The **title slot** (`![cat.png](/… "w=50% left")`) and the **Obsidian alt pipe** (`![cat.png|320](/…)`) both render clean in a foreign renderer, which is their whole case: a document pasted into GitHub shows an image and no stray text. Each pays for it by hiding layout data in a field that already means something else, the tooltip and the accessibility string respectively. **Class tokens** (`{.half .left}`) map one to one onto CSS class names in all three stylesheets and cost almost no translation layer, and an unrecognized class is free to ignore. The assumption that fails for all three is that the metadata only has to survive vapor. Pandoc reads `width=50%` natively and honors it; it parses `.half` and does nothing with it, and never sees the other two at all. The brace block is the only form where the size survives a conversion.

The cost is real and is accepted: GitHub and any strict CommonMark renderer print `{width=50% align=left}` as literal text after the image.

### 2. Left and right alignment float the image and text wraps

`align=left` and `align=right` float the image and the following text wraps beside it. `align=center` and an absent `align` both keep the image on its own line, centered and in default flow respectively. This follows Dropbox Paper, which was the stated model.

The consequence to know before choosing a width: every block in the editor is capped at `max-width: 65ch` ([app/app.css:233](../../app/app.css)), so a floated image at 40% leaves about 39 characters per line beside it and at 50% about 32. Paper's column is wider, which is why the same layout reads better there. Widening vapor's column is a separate decision and is not made here.

`width=full` and `width=100%` ignore `align` and take their own line; there is no room to wrap beside them.

Sizing is a set of presets rather than a drag handle. Each choice is one `updateAttributes` call, so it is one Yjs write per click. A drag handle writes per frame, needs throttling, and turns two people sizing the same image into a stream of last-write-wins updates rather than one.

### 3. Full-bleed is in; galleries and editable captions are not

Paper also groups images dragged onto the same line into a side-by-side gallery, and gives each image an editable caption field. Both are out of scope here. A gallery needs a new container node in `richSchema`, a new markdown form, drag-to-group in the editor, and gallery rules in three stylesheets. Captions need a decision about where the caption text lives in markdown and whether `attachment` can stay `atom: true`.

One thing worth recording while it is visible: `alt` is set to the uploaded filename ([app/lib/useAttachments.ts:104](../../app/lib/useAttachments.ts)) and rendered both as the `<img alt>` and as the visible figcaption, so the field named `alt` is the caption and no vapor document currently carries alt text. That is a separate issue from this one and is not fixed here.

## Design

### The schema gains two nullable attributes

`richSchema.attachment` ([app/shared/rich-markdown.ts:87](../../app/shared/rich-markdown.ts)) and the TipTap `Attachment` node ([app/lib/attachment.ts](../../app/lib/attachment.ts)) each gain:

- `width: { default: null }` holding `"50%"` or `"full"`
- `align: { default: null }` holding `"left" | "center" | "right"`

Both default to `null` rather than to `"100%"` and `"left"`. The serializer emits a brace block only when at least one is non-null, so every document that exists today serializes byte-identical and no round-trip changes.

### The parser accepts one new shape and drops what it does not know

`attachmentRule` ([app/shared/rich-markdown.ts:332](../../app/shared/rich-markdown.ts)) currently requires exactly one meaningful child in the paragraph and that it be an image. It gains a second accepted shape: an image followed by a text child matching `/^\{[^}]*\}$/`. Keys are read out of that block, `width` and `align` are kept, and every other key is dropped.

Three behaviors are chosen deliberately:

- **Any percent parses.** A hand-typed `{width=37%}` renders at 37% and is not snapped to the nearest preset. The toolbar only ever writes the preset steps, but the raw markdown is editable by anyone with the link and rewriting someone's text silently is worse than honoring it.
- **Unknown keys are dropped, not preserved.** A future `{width=50% caption="x"}` loses the caption on the next save. Preserving unknown keys would mean carrying an opaque bag on the node; that is a cost to pay when there is a second consumer, not before.
- **A non-brace trailing text child changes nothing.** The paragraph fails the attachment test as it does today and falls through to the existing foreign-image path, which turns the image back into literal text.

`markdown-it` is 15.0.1 with no attrs plugin in the tree ([package.json:43](../../package.json)), so this is a custom core rule beside the existing one, which is how the rest of vapor's markdown extensions are written.

### Full-bleed breaks out of a centred column with container units

`.attachment` carries `data-width` and `data-align`. Alignment and full bleed are rules; the width is an inline style, because a percent can be any value and `attr()` is not portable enough to read one.

An earlier draft of this section said `.tiptap` is a left-aligned padded block rather than a centred column, and that full bleed therefore cost nothing but a dropped `max-width`. That was wrong, and running it is what showed it. The editor sits inside `mx-auto w-full max-w-3xl` ([app/components/Editor.tsx:436](../../app/components/Editor.tsx)), a centred 672px column; blocks only look left-aligned because 65ch exceeds that wrapper at every viewport. A full-bleed image measured 630px, identical to a heading.

Full bleed breaks out with container query units instead. The editor frame, the flex sibling of the 280px comment rail, is marked `container-type: inline-size` as `.doc-frame`, and the full-bleed rule takes `min(100cqw - 3rem, 1600px)` with a negative inline margin to re-centre it. The viewport would be the wrong unit: it includes the rail. Measured at a 1400px viewport, the frame is 1120px, the text column 630px, and a full-bleed image 1078px centred in the frame with symmetric 21px gaps, ending before the rail begins at 1120px. Reading systems without container units fall back to 100% through an `@supports` guard.

Floats clear at headings, rules, tables, code blocks, blockquotes, and non-floated attachments. Floated attachments are exempt from the clear, or each would push the one before it down instead of sitting where it was put. Below 640px alignment drops and every image takes its own line.

`StarterKit` supplies Gapcursor and only `CommentEditor` disables it ([app/components/CommentEditor.tsx:80](../../app/components/CommentEditor.tsx)), so the caret has a target beside a floated atom node.

### The EPUB needs the rule too, and full-bleed degrades there

`READING_CSS` ([app/shared/epub.ts:99](../../app/shared/epub.ts)) gains the same width and align rules, and the print page inherits them because it embeds `READING_CSS` and adds only a `@media print` block ([app/shared/epub.ts:226](../../app/shared/epub.ts)). One CSS addition covers both surfaces.

`full` means 100% of the text width in the EPUB and on the print page, not wider. `READING_CSS` sets `body { margin: 0 auto; max-width: 42em }`, a centered column with no canvas outside it. The documentation states this rather than implying the attribute round-trips to an identical result everywhere.

Float is emitted in `READING_CSS` as well. Reading systems vary in how they honor `float` on a block, and I have not tested any of them, so a floated image that a given reader lays out on its own line is an accepted outcome and not a bug to chase.

A bug is introduced if only the CSS changes: `epubChapterHtml` runs a separate plain `MarkdownIt` ([app/shared/epub.ts:62](../../app/shared/epub.ts)) that knows nothing about the brace block, so `{width=50% align=left}` would print as literal text in both the EPUB and the print page. That parser needs the same rule, or a pre-pass that converts the block into a class on the `<img>` before rendering.

`attachmentImages` ([app/shared/epub.ts:50](../../app/shared/epub.ts)) is unaffected. Its regex captures the URL inside the parens and stops at the closing paren, so a trailing brace block is outside what it matches.

### The toolbar is a fourth bubble context

`BubbleToolbar.tsx` already runs a TipTap `BubbleMenu` over a `BubbleContext` union of `selection | suggestion | annotation`. A fourth kind, `attachment`, is detected when the selection is a `NodeSelection` on an `attachment` node whose `kind` is `image`. Its buttons are four widths, plus Full, plus three alignments. The detection runs before the existing text gates: a node selection on an atom spans no text, so both the emptiness check and the `textBetween` check would reject it.

Two things that only running it revealed. `BubbleMenu` renders its children into a portal and does not re-render them per transaction, so the pressed state has to read the editor through `useEditorState` rather than `editor.state` at render time; without it every button reads unpressed on a node that plainly carries a width. And Material Symbols is loaded as a named subset in [app/root.tsx:53](../../app/root.tsx), so `format_image_left`, `format_image_right`, `format_align_center`, and `width_full` each had to be added to `icon_names` or the ligature renders as raw text. `Icon.tsx` says so in its own doc comment.

### Resizing is not a tracked change

`suggestModePlugin` ([app/lib/suggest-mode.ts:51](../../app/lib/suggest-mode.ts)) implements only `handleTextInput` and `handleKeyDown`. It has no `filterTransaction` and no `appendTransaction`, so a programmatic `updateAttributes` passes through untouched and a resize applies directly even while suggest mode is on. This is the right outcome as well as the current one: CriticMarkup has no syntax for an attribute change, so a tracked resize could not be written to markdown.

Agents get all of this through `replace`, since agents write markdown. No new MCP tool and no new parameters on `attach`.

## Verified and not verified

Verified by running it at a 1400px viewport against a local dev instance: the float, the wrap and where it ends, the clear at a heading, full bleed's width against the frame and the rail, the toolbar's buttons and pressed state, a click on Align right reaching `/:id.md` as `{width=50% align=right}`, and the print page carrying inline styles rather than literal braces. Verified by reading the source at `aeeaa3f`: the schema, parser, and serializer shapes; the `65ch` cap and the `.tiptap` container; the rail's width and that it is a flex sibling; `READING_CSS` and the print page sharing it; `attachmentImages`' regex; `epubChapterHtml`'s separate parser; `suggestModePlugin`'s two props; the `BubbleContext` union; `markdown-it` 15.0.1 with no attrs plugin.

Not verified: no EPUB has been opened in a reading system, so how any of them honours `float` on a block is unknown. The three test files CLAUDE.md names as environment failures (`safe-storage`, `anon-identity`, `use-theme`) still fail here; CLAUDE.md attributes that to Node 26 shipping a global `localStorage`, and this machine runs Node 25.8.1, so that note is one version out of date.

Dropbox Paper's behavior was taken from Google's synthesis of Dropbox's blog and community threads rather than from Dropbox's documentation, and one of its two claims was wrong. It reported that Paper does not wrap text around images; Nicholas, who uses Paper, corrected that on 2026-09-13 and the design above reflects the correction. Its other claim from the same source, that Paper has no drag-to-resize handles and uses a preset toolbar, is therefore also unconfirmed. Presets were chosen independently for the one-write-per-click reason given in Decision 2, which does not depend on what Paper does, so the toolbar design stands either way.

## Tasks

1. **Schema and markdown** (`app/shared/rich-markdown.ts`, `app/lib/attachment.ts`): the two attrs, the extended `attachmentRule`, the serializer's conditional brace block. Round-trip tests in `tests/unit/shared/rich-markdown.test.ts`.
2. **Editor rendering** (`app/components/AttachmentView.tsx`, `app/app.css`): `data-width` and `data-align` on the wrapper, the width, align, and full-bleed rules.
3. **EPUB and print** (`app/shared/epub.ts`): the brace-block rule in the export parser, the width and align rules in `READING_CSS`. Tests in `tests/unit/shared/epub.test.ts` asserting the block does not reach the chapter XHTML.
4. **Toolbar** (`app/components/BubbleToolbar.tsx`): the `attachment` context and its buttons. Component test for the context detection.
5. **Docs**: the attribute form in the attachment section of `docs/markdown-and-criticmarkup.md`, including that `full` means column width in the EPUB and print.

Tasks 1 and 3 are independent of 2 and 4 and testable without the editor.

## Reopens when

- The 65ch column is widened. Wrapped text beside a 50% image is about 32 characters at the current width, which is the weakest part of this design and is fixed by the column, not by the image.
- A second consumer needs a key this design drops. The rule that unknown keys are discarded is cheap to reverse only before documents contain them.
- Galleries are wanted. A container node changes the markdown form for images generally, so it is a redesign of this decision and not an addition to it.

## Out of scope

Drag-to-resize handles; side-by-side galleries; editable captions; alt text distinct from the filename; sizing or alignment for non-image attachments, which stay block chips; server-side resizing or thumbnails; `width` and `align` parameters on the MCP `attach` tool.
