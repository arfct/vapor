# Notes-app import — overview and sequencing

vapor is adopting the editing experience of the dreamer notes app (source: `notes.zip`, a TipTap 3 WYSIWYG markdown editor on a Base UI component kit). This document indexes the plan series, fixes the order, and records what the source app actually contains so the individual plans can stay focused.

## The plan series

| # | Plan | Depends on | Size |
|---|---|---|---|
| 1 | [UI component kit](2026-08-31-ui-component-kit-plan.md) | — | S |
| 2 | [Editor styles and formatting defaults](2026-08-31-editor-styles-plan.md) | — | S |
| 3 | [WYSIWYG editing as the default](2026-08-31-wysiwyg-editing-plan.md) | — | XL |
| 4 | [Formatting toolbar](2026-08-31-formatting-toolbar-plan.md) | 1, 3 | M |
| 5 | [Feature roadmap](2026-08-31-notes-features-roadmap.md) | 3 (mostly) | — |

Recommended order: **1 → 2 → 3 → 4**, then roadmap items from 5 as separate efforts. Plans 1 and 2 are independent and can land in either order; both are worth doing before 3 so the WYSIWYG work styles against the final tokens and renders into the final kit.

## What the source app is

- **Editor**: TipTap 3 (`3.20.0`) with StarterKit + `@tiptap/markdown`. Content is *stored* as markdown (`editor.getMarkdown()` / `setContent(md, { contentType: 'markdown' })`) but *edited* as rich nodes — no visible syntax. Extensions: Underline, Link (autolink + linkOnPaste), TaskList/TaskItem (nested), CodeBlockLowlight with a React node view (language selector overlay), Table (resizable) + row/header/cell, Placeholder, Typography (smart quotes/dashes/arrows), plus a custom `EditorShortcuts` extension and a custom `AttachmentNode`.
- **Toolbar**: a single header row that fades to 30% opacity unless the editor is focused or the toolbar is hovered. Controls are grouped into dropdown menus: **Formatting** (B/I/U/S button row + Body/H1/H2/H3/Code items), **Lists** (bullet, numbered, checkbox, quote), **Insert** (link dialog, attach file, divider, sidekick block, code block, table), a contextual **Table** menu that appears only inside tables, and an overflow menu (sync status, copy as markdown, history, delete).
- **Component kit**: thin wrappers over `@base-ui-components/react` — `Button` (default/ghost/destructive, rounded-full), `Menu`/`MenuTrigger`/`MenuContent`/`MenuItem`/`MenuSeparator` (squircle popup, animate-in/out, destructive items), `Input`, `Icon` (Material Symbols ligatures), `Toolbar` primitives, and `cn()` (clsx + tailwind-merge). Semantic color tokens throughout: `background/foreground/card/popover/accent/muted/primary/destructive/border`.
- **Styles**: `.tiptap` typographic defaults (H1 1.875rem / H2 1.5rem / H3 1.25rem bold with top margins, paragraph and list spacing, styled blockquote/code/pre/tables/task lists), a one-dark-ish highlight.js palette, placeholder styling, and a `squircle-*` Tailwind utility.
- **Beyond the four asks** (catalogued in plan 5): version history with restore, a keyboard-shortcut suite (Tab heading ladder, block move/duplicate), smart URL paste, an inter-note link dialog, file attachments with inline previews, code-block language selection, a purple "Sidekick instructions" block that a background agent executes against the note, offline-aware background sync, and readable URL slugs.

## Ground rules for all plans in this series

- **vapor's collaboration model wins.** The source app is single-user with debounced saves; vapor is Yjs-CRDT multiplayer with agents as peers. Anything in the source built around save/sync (debounce, conflict states, background refetch) is *not* imported — Yjs already solves it.
- **Markdown stays the interchange format.** `/:id.md`, agent RPCs, and exports keep speaking markdown regardless of how the editor renders.
- **Existing documents may break.** Documents expire after 99 hours, so there is no migration burden worth engineering for; a schema change that renders pre-change docs oddly for their remaining lifetime is acceptable (same call as the `vpr_` token retirement).
- **Suggest mode and comments must survive every step.** CriticMarkup marks, thread anchoring, and the agent tool surface are vapor's differentiators; each plan lists them as explicit regression surfaces.
- Each plan below is written to be executed via `superpowers:writing-plans` → implementation when picked up; the documents here fix scope, decisions, and sequencing, not step-by-step TDD scripts.
