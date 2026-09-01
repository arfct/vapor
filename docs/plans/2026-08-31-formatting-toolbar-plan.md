# Formatting toolbar

**Goal:** A formatting toolbar in the document header, imported from the notes app's grouped-menu design: Format, Lists, and Insert menus plus a contextual Table menu, wired to the rich editor.

**Part of the [notes-app import series](2026-08-31-notes-import-overview.md).** Depends on plan 1 (Menu/Button/Icon kit) and plan 3 (rich commands exist). The existing bubble toolbar stays for selection-scoped actions (comment, suggest accept/reject).

## Source design being imported

From `notes/src/components/NoteEditor.tsx` `MenuBar`:

- **Format menu** (trigger icon `format_size`): a horizontal B / I / S icon-button row at the top of the menu (active state = `bg-accent`), then items Body Text, Heading 1–3, Code — each with icon + active indication. (The source also has Underline; vapor drops it — plan 3's markdown-completeness rule.)
- **Lists menu** (`format_list_bulleted`): Bullet List, Numbered List, Checkbox List, Quote.
- **Insert menu** (`add_box`): Link to… (dialog), Divider, Code Block (toggles selection or inserts empty fence), Table (3×3 with header, disabled inside a table). Attach File and Sidekick block are roadmap features — the menu ships without them and gains items as those land.
- **Table menu**: rendered only when `editor.isActive("table")` — add/delete column, add/delete row, delete table.
- **Fade behavior**: the source toolbar sits at 30% opacity unless the editor is focused, the toolbar is hovered, or a menu is open.

## Decisions

- **Placement: a group in the existing header**, between the document id and the ModeMenu — vapor's header is already the command surface and horizontally scrolls on mobile. No second toolbar row; `min-h` stays as-is.
- **Fade imports as muting, not vanishing.** The header carries navigation (vapor link, id, expiry) that must never fade. The *formatting group only* dims to `opacity-40` when the editor is unfocused, restoring on hover/focus/open-menu — the source's `openMenus` counter pattern comes along (menus outlive toolbar hover).
- **Link dialog, vapor-flavored.** The source dialog searches the user's other notes; vapor has no cross-document index, so v1 is URL + optional title over the current selection (insert-or-wrap logic imported as-is). An inter-document search belongs to the roadmap's document-linking item.
- **Edit vs. suggest aware.** Formatting commands run through the same suggest-mode interception as typing: in suggest mode, toggling bold over a range produces a tracked change, not a silent mutation. This falls out of plan 3's suggest plugin if command transactions route through it — verify explicitly; it is the one behavior with no source-app precedent.
- **Task/checkbox item ships disabled** until the task-list UI (roadmap) lands, or is omitted from v1 — decide at implementation by whether plan 3 enabled the nodes with usable defaults.
- **Icons**: extend the Material Symbols subset in [root.tsx](../../app/root.tsx) with `format_size, format_bold, format_italic, strikethrough_s, format_paragraph, format_h1, format_h2, format_h3, format_list_bulleted, format_list_numbered, check_box, format_quote, add_box, link, horizontal_rule, code, table, table_rows, view_column, add` (keep sorted).

## Tasks

1. `app/components/FormatToolbar.tsx`: the three menus + table menu as a single component using the plan-1 kit; active-state styling from `editor.isActive(...)`; editor from `useDocument()`.
2. Focus/hover fade state (lift `isFocused` tracking from Editor into context or use `editor.isFocused`).
3. Link dialog component (kit `Input` + `Button`; imported insert-or-wrap selection logic).
4. Header wiring in [doc.$id.tsx](../../app/routes/doc.$id.tsx); mobile check that the scrolling header stays usable with the added group.
5. Keyboard shortcuts that pair with the toolbar (⌘B/⌘I already via StarterKit; add ⌘⇧X strike if missing; no ⌘U — underline is out per plan 3).
6. Suggest-mode formatting verification (tracked-change toggling) with tests.
7. Tests: menu contents render; commands dispatch (mock editor per existing patterns); active states reflect `isActive`.

## Regression surfaces

Header overflow scrolling; menu portals over the editor (z-order with bubble toolbar and thread rail); no focus steal from the editor when opening menus (`editor.chain().focus()` on every command, as the source does).

## Out of scope

Attachments, sidekick block, note-search linking, version history (all roadmap); bubble-toolbar changes.
