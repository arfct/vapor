# UI component kit

**Goal:** Port the notes app's Base UI component kit into vapor and migrate existing controls onto it, so every menu, button, and input shares one implementation and one visual language.

**Part of the [notes-app import series](2026-08-31-notes-import-overview.md).** No dependencies; do this first.

## What we're importing

From `notes/src/components/ui/` and `notes/src/lib/utils.ts`:

| Component | Source behavior to keep |
|---|---|
| `Button` | Variants `default` / `ghost` / `destructive`; sizes `default` / `sm` / `icon`; `rounded-full`; focus ring; disabled opacity |
| `Menu` family | Base UI Menu with portal + positioner; squircle popup (`squircle-2xl border border-border bg-popover p-1.5 shadow-md`); animate-in/out on open state; `MenuItem` with `destructive` and `disabled`; `MenuSeparator` |
| `Input` | Rounded, bordered, focus ring, placeholder color |
| `Icon` | Already exists in vapor ([Icon.tsx](../../app/components/Icon.tsx)); reconcile the two (source adds a `size` px prop; keep vapor's subset discipline) |
| `Toolbar` / `ToolbarGroup` / `ToolbarSeparator` | Simple flex primitives for plan 4 |
| `cn()` | clsx + tailwind-merge; replaces ad-hoc template-string class merging |

## Decisions

- **Base UI replaces Radix.** vapor currently uses `@radix-ui/react-dropdown-menu` (ShareButton, ModeMenu) and `@radix-ui/react-switch` (now unused after the ModeToggle removal). The notes kit is built on `@base-ui-components/react`. Running both is a bundle and idiom tax: migrate the two Radix menus to the ported `Menu`, then drop the Radix dependencies. (Base UI is the Radix successors' project; API shape is near-identical at our usage level.)
- **Semantic tokens now, full palette later.** The kit's classes reference `popover`, `accent`, `primary`, `card`, `destructive`, `muted-foreground` — tokens vapor doesn't define. Add them to `@theme` in [app.css](../../app/app.css) mapped onto vapor's existing palette (e.g. `popover` → paper, `accent` → border-tinted, `primary` → ink, `destructive` → the existing red) with dark values in the existing `[data-theme="dark"]` / auto blocks. Plan 2 owns tuning the values; this plan just makes the names resolve in all three theme states.
- **Squircle utility comes along** (`@utility squircle-*` from the source `globals.css`) — cheap, and the menus use it.
- **HeaderMenu stays a hand-rolled popover.** It contains non-menu content (GSI button, theme row); forcing it into Menu semantics is a regression. It adopts the kit's Button/Icon/tokens only.

## Tasks

1. Add `@base-ui-components/react`, `tailwind-merge`; add semantic color tokens (light + dark + auto) to `app.css`; add the squircle utility.
2. Create `app/components/ui/`: `button.tsx`, `menu.tsx`, `input.tsx`, `toolbar.tsx`, port `cn()` to `app/lib/cn.ts`. Copy source implementations, adjusting imports and vapor lint rules (no `React.forwardRef` changes needed; source is React 19, vapor is React 19 via RR7 — verify).
3. Migrate `ModeMenu` and `ShareButton` from Radix DropdownMenu to `Menu`; keep aria-labels and test hooks stable (`getByLabelText("Editing mode")`, `getByLabelText("Share options")`).
4. Migrate raw `<button>`/`<input>` in `ThreadPanel`, `CommentInput`, `AgentsPanel`, `HeaderMenu`, `SignIn`-popover rows to `Button`/`Input` where it doesn't change layout semantics (flush toolbar buttons keep custom classes via `className`).
5. Remove `@radix-ui/react-dropdown-menu` and `@radix-ui/react-switch` from package.json once no imports remain.
6. Tests: unit tests for Button variant/size classes and Menu open/close + destructive item; existing component tests keep passing unchanged (they assert labels, not implementation).

## Regression surfaces

- Menu open/close in jsdom (Base UI trigger events differ from Radix — verify `fireEvent.click` opens it; if not, tests target the trigger render only, as today).
- SSR hydration: Base UI portals on the doc route (ThemeSelector's mounted-gate pattern is the fallback if Base UI menus mismatch).
- The header's horizontal scroll: menu triggers must stay flush (`h-full` buttons, no wrapping).

## Out of scope

Editor styling (plan 2), toolbar composition (plan 4), any new controls.
