# Editor styles and formatting defaults

**Goal:** Adopt the notes app's typographic defaults and semantic palette so vapor documents read like finished pages, in both the current markdown view and the coming WYSIWYG view.

**Part of the [notes-app import series](2026-08-31-notes-import-overview.md).** Independent; pairs with plan 1 (which introduces the token *names* — this plan owns their *values* and the content styles).

## What we're importing

The `.tiptap` stylesheet from `notes/src/globals.css`, adapted to vapor's class hooks:

- **Heading scale**: H1 1.875rem, H2 1.5rem, H3 1.25rem, bold, with top margins (1.5/1.25/1rem) and `margin-top: 0` on first child. vapor's current `md-heading-*` classes (1.75/1.4/1.15em, weight 600) are replaced by these values so the two eras match.
- **Block rhythm**: paragraphs `margin-bottom: 0.5rem` (vapor currently has `margin: 0` — the single biggest visual change), list `margin-left: 1.5rem` + item spacing, blockquote with 4px border-left + italic + muted color.
- **Code**: inline code on `--muted` background with 0.25rem radius; `pre` blocks padded 1rem with horizontal scroll; the one-dark-ish hljs palette (keyword `#c678dd`, string `#98c379`, number `#d19a66`, function `#61afef`, built-in `#e6c07b`) replacing vapor's current sugar-high colors — map the palette onto vapor's `sh-*` classes now, `hljs-*` after plan 3 swaps highlighters.
- **Tables and task lists**: full cell/border/header treatment and checkbox list layout — land the CSS now (inert), used when plan 3 introduces the nodes.
- **Placeholder**: `is-editor-empty::before` pattern for the empty-document hint.

## Decisions

- **Semantic token values.** Define the palette introduced in plan 1 concretely, staying vapor: `--color-paper`/`--color-ink` remain the ground truth; `card` = paper, `popover` = paper, `muted` = current border gray as a *background* role plus `muted-foreground` = current `--color-muted`, `accent` = 8% ink over paper, `primary` = ink, `destructive` = the red already used for deletions. Canary/coral/chartreuse stay as vapor's accent identity — the notes app's palette is neutral and doesn't override brand color.
- **Keep vapor's fonts.** The notes app inherits system fonts too; no font change. Body size stays 1.15rem/1.6 in the editor.
- **Dark mode by token only.** All new styles reference tokens; the existing `[data-theme="dark"]` and `@media (prefers-color-scheme: dark) [data-theme="auto"]` blocks gain the new token overrides and *no* per-component rules. The sidekick-block purple treatment (roadmap item) is the only styled-both-ways special case and ships with that feature, not here.
- **Preview and editor converge.** The `.preview` stylesheet adopts the same scale/spacing so toggling Preview stops changing the type ramp. After plan 3, most of `.preview` collapses into `.tiptap` rules.

## Tasks

1. Set the semantic token values (light + dark + auto) in `app.css`; verify every token resolves in all three theme states (the un-stamped default is `data-theme="auto"` here, which vapor stamps explicitly — both dark paths covered).
2. Replace the `md-heading-*`, paragraph, and list styles in the `.tiptap` block with the imported scale and rhythm; port blockquote, inline-code, and pre styles onto vapor's `md-code` / `md-code-block` hooks.
3. Land table/task-list CSS (dormant until plan 3) and the placeholder rule.
4. Align `.preview` to the same scale; delete rules that become duplicates.
5. Update the highlight palette on `sh-*` classes; keep the dark variants.
6. Visual pass in the pane: onboarding doc + the formatting showcase doc pattern (`/mcws2erh` content) in light, dark, and auto; comment underlines, suggestions, and cursors unchanged.

## Regression surfaces

- Paragraph `margin-bottom` changes every doc's vertical rhythm — check comment-anchor click targets and the point-comment marker alignment (`.cm-point-marker` uses em-based offsets).
- `max-width: 65ch` on `.tiptap p` must survive (reading measure).
- Tests that assert class names (`md-heading` etc.) — none assert values, so CSS-only changes should pass untouched; `git grep` before assuming.

## Out of scope

Component chrome (plan 1), any schema/node changes (plan 3), sidekick-block styling (roadmap).
