# Notes-app features roadmap

**Part of the [notes-app import series](2026-08-31-notes-import-overview.md).** Everything notable in the source app beyond the four core asks, assessed for vapor and scheduled. Each shipped item gets its own plan when picked up.

## Tier 1 — schedule next (high fit, bounded scope)

**Keyboard shortcut suite** (`notes/src/lib/editor-shortcuts.ts`, portable nearly verbatim after WYSIWYG):
- Tab / Shift-Tab ladder: H1→H2→H3→Body→Bullet and back; in lists, sink/lift the item.
- ⌘⌃↑ / ⌘⌃↓ move block; ⌘D duplicate block; ⌘Enter / ⌘⇧Enter insert paragraph below/above.
- ⌘\ clear formatting; ⌘⌥0 to paragraph; ⌘⌥C code block; arrow input rules (`—>` → `→`).
- vapor addition: every shortcut must respect suggest mode (block moves become tracked operations or are disabled in suggest — decide in the plan).

**Smart link paste** (`handlePaste` in the source editor): pasting a URL over selected text links the selection; pasting bare URLs with HTML clipboard data extracts the page title into linked text. Small, self-contained, high daily value.

**Code block language selector** (`code-block-view.tsx`): React node view overlaying a quiet `<select>` in the block's corner; lowlight/highlight.js palette landed in plan 2. Depends on plan 3's codeBlock node.

**Task lists and tables UI**: schema arrives in plan 3, CSS in plan 2; this item is the toolbar/menu enablement plus checkbox interaction (multiplayer-safe toggling) and the contextual table menu already specced in plan 4.

## Tier 2 — schedule after tier 1

**Agent instructions block** (the source's "Sidekick instructions"): a visually distinct block (purple border, uppercase label, markdown-ish inline highlighting) whose content is *addressed to agents, not readers*. vapor mapping is strong: `read_document` returns it as a distinguished section, agents treat it as standing instructions for the doc, and the Insert menu gains the item. This is the source app's most original idea and slots directly into vapor's agent-native story.

**Version history**: the source snapshots on a timer and on >20% content change, with a restore dialog attributing versions to "You" vs "Sidekick". vapor variant: DocumentAgent already owns every update — snapshot markdown into a `versions` table on the same triggers (plus before agent `replace`/`Accept all`), attribute via identity (Ada vs. Ada's Agent), restore as a regular edit. Ninety-nine-hour lifetime keeps storage trivial.

**Attachments**: upload via a worker route to R2, an inline attachment node (image preview / file chip, from `attachment-extension.tsx`), URLs resolved per request. Needs an R2 binding and size/type limits, and a decision on anonymous upload abuse before shipping.

## Tier 3 — adopt the idea, not the implementation

- **Readable slugs** (`Title--base64url(uuid)`): charming, but vapor's short ids are the product's identity and its URLs are share-first. Revisit only if titles become first-class.
- **Offline/background sync, sync-status states**: solved differently and better by Yjs; the one import-worthy piece is a compact sync-state indicator (the source's menu row) if users ask for more than the current status dot.
- **⌘S save toast**: meaningless under CRDT autosave; skip.
- **View Transitions on navigation** (`viewTransition.ts`): cheap polish for home↔doc navigation; take opportunistically during some UI pass.
- **Inter-document link dialog** (search your other notes): vapor has no per-user document index by design (anonymous-first). Becomes interesting only alongside a "my documents" surface — park until identity grows one.
- **Process-with-Sidekick queue** (`processNotesQueue` background function): vapor's equivalent is already stronger — agents are live collaborators via MCP and `await_events`. No import; the agent-instructions block (tier 2) captures the useful residue.

## Suggested sequence after the core four plans

1. Keyboard shortcuts + smart link paste (one small plan, pure client).
2. Code block language selector + task/table UI (one plan, finishes the rich-node surface).
3. Agent instructions block (agent-facing differentiator).
4. Version history.
5. Attachments (needs the R2/abuse decisions first).
