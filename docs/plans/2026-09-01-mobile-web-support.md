
# Mobile web support

vapor's URLs get opened on phones — and often inside in-app browsers (Claude, Slack, iMessage previews), where the page is nested in host UI: short viewports, dynamic toolbars, no address bar control, aggressive tab suspension, and webviews that block Google OAuth. This plan treats the embedded webview as the primary mobile case, not the exception.

An audit of the current code found the connectivity layer already solid (idle-sleep + full resync on reconnect survives webview suspension) and `16px` input font already prevents iOS zoom-on-focus. The gaps are layout and touch.

> **Status (2026-09-02):** implemented on `feat/mobile-web` — one layout at every width (six-cell header, comments as a rail at `lg`+ and a bottom sheet stepping one thread at a time below), `viewport-fit=cover` + `dvh` + safe-area insets, bubble menu without the focus gate, 44px targets, `enterkeyhint`, storage/clipboard/GSI hardening. Not done: moving the doc id into the Share menu (the id and connection dot stay in the header by choice, truncating first on narrow screens) and the `visualViewport` fallback, held until `dvh` proves insufficient on a device.

## Review notes

Conclusions from the comment threads on the vapor draft, which don't export with the document:

- **Safe-area insets in in-app browsers** — a no-op there: the host app owns the notch and home-indicator regions, so `env(safe-area-inset-*)` resolves to 0. They only bite in direct Safari visits and landscape, where some webviews pass through left/right insets.
- **Sign-in inside webviews** — three options in increasing effort: hosts built on SFSafariViewController / Custom Tabs already pass Google OAuth, so attempt-and-degrade covers part of the fleet for free; a device-pairing handoff (sign in from the system browser, confirm a short code) is the real fix for blocked webviews; letting anonymous users claim a display name is the cheap, unverified path. The first is implemented (the fallback note); the second is the stretch item in Phase 4; the third is a product call.
- **BubbleToolbar fallback** — decided in favour of fixing the floating menu (focus gate removed, update delay, flip/shift); no fixed selection-actions row was needed.

## One layout, every width

The plan below fixes mobile as a separate surface. Better: one responsive app, where width changes how much is visible, not what exists. Same components, same controls, touch-sized everywhere — so `pointer: coarse` forks become rare instead of the design.

**Header — six cells, never scrolls.** vapor · **Edit** (mode menu; Markdown view already lives here) · **Share** (copy, download, invite an agent; the doc id and expiry move in here as the menu's header, freeing the bar) · **Insert** (FormatToolbar's three icons fold into one menu — text size, lists, blocks; inline formatting already lives in the bubble menu) · spacer · **Comments** toggle (at every width, not `lg`-only, with an open-thread count) · **Account**. Connection state collapses to the dot; the word appears only when not connected. Six 44px cells fit 375px, so `overflow-x-auto` and the scroll-affordance work go away.

**Comments — one list, two presentations.** The same `ThreadList` renders as the rail beside the document at `lg`+, and as a full-height sheet over the document below that. Both open from the same header toggle; reply and comment input are the same components in both. `MobilePanel` and its Editing / Comments / Preview tabs are deleted: Preview is in the Edit menu, Comments is the toggle, and the Editing tab was an onboarding remnant.

**Touch-sized by default.** 44px header cells and bubble-menu buttons at every width — desktop absorbs the extra few pixels without looking touch-first. Hover reveals (thread icons, code-copy button, toolbar dimming) are the only remaining pointer forks, and even those also show on active/selected so the fork is a nicety, not a dependency.

**Bubble menu — one behavior.** Drop the `view.hasFocus()` gate and add the update delay for all pointers; both are harmless on desktop and remove the need to test two variants.

This supersedes items 3 (the hook shrinks to hover-reveal only), 4 (nothing scrolls), and 8 (`MobilePanel` is gone; the sheet is what meets the keyboard), and the tablet line under Out of scope (the only remaining `lg` fork is rail-vs-sheet). Sizing: header consolidation plus the sheet is about two days and replaces the Phase 2/3 items it retires, so the plan gets shorter, not longer.

## Phase 1 — Foundations (small, unblocking)

1. **`viewport-fit=cover` + safe-area insets.** Add `viewport-fit=cover` to the viewport meta in `app/root.tsx`, then pad the doc header top and MobilePanel bottom with `env(safe-area-inset-*)`. Without the meta change, none of the inset CSS does anything.
2. **Replace `vh` with `dvh`.** `body`'s `100vh` and MobilePanel's `33vh` compute against the largest viewport on mobile Safari and ignore the keyboard. ````Switch to dvh (with vh fallback line for old browsers). While here, replace the editor's pb-[33vh] scroll padding with the panel's actual collapsed height — a fixed third of the viewport over-reserves space whenever the panel is collapsed.
3. **A `usePointerCoarse()` hook** (one `matchMedia("(pointer: coarse)")`), so hover-reveal controls can also show on active/selected for touch. Nothing else forks on it — see One layout, every width.

## Phase 2 — Touch-hostile UI (the real breakage)

4. **Header scroll affordance.** The doc and home headers scroll horizontally with `scrollbar-none` and zero visual hint — hidden functionality on a phone. Superseded by One layout, every width: the header shrinks to six cells that fit 375px, so it stops scrolling at all.
5. **Hover-only controls need a touch path.**
   - ThreadPanel's resolve/menu icons are `opacity-0` until `group-hover` — invisible on touch. On coarse pointers, show them when the thread is active/selected instead.
   - FormatToolbar's hover-driven undimming never fires on touch; keep it full-opacity on coarse pointers.
6. **BubbleToolbar on touch.** The `view.hasFocus()` gate and `updateDelay: 0` fight iOS's native selection handles (menu flickers or never appears). On coarse pointers: add an update delay, allow flip/shift placement so the keyboard doesn't cover it, and test against native selection-handle dragging specifically. This is the highest-effort item; time-box it and fall back to a fixed selection-actions row in the MobilePanel if the floating menu can't be made reliable.
7. **Tap targets.** Sweep the sub-44px buttons: MobilePanel tabs, bubble-menu buttons (Accept/Reject sit adjacent — a mis-tap on track changes is destructive), CommentInput's Add/Cancel, ThreadPanel icons. Padding changes only, no redesign.

## Phase 3 — Keyboard and panel behavior

8. **MobilePanel vs the keyboard.** ````MobilePanel is gone; the comments sheet is what meets the keyboard. With dvh from Phase 1, verify the reply flow with the keyboard open; if the sheet misbehaves, size it from window.visualViewport.
9. **Keyboard hints.** `enterkeyhint="send"` on comment/reply inputs so mobile keyboards show Send instead of Return.

## Phase 4 — Embedded-webview specifics

10. **Google sign-in degrades gracefully.** GSI is blocked in many webviews (`disallowed_useragent`). Detect the failure (GSI's button simply not rendering is the common symptom) and show a one-line "Sign-in needs a real browser — open this page in Safari/Chrome" note instead of a dead button. Anonymous use is already first-class; keep it the default path. Stretch: a device-pairing handoff — sign in from the system browser, confirm a short code, and the webview session is blessed — so blocked webviews can still get real identity.
11. **Tolerate ephemeral storage.** Webview `localStorage` can be partitioned or wiped, so the anonymous identity and theme may reset between visits. Verify nothing breaks when storage is empty or throws (private mode); wrap reads/writes defensively.
12. **Copy-link works everywhere.** `navigator.clipboard` requires a secure context and can be denied in webviews; add a fallback (legacy execCommand or a select-all text field) so Share → Copy link never silently no-ops.

## Verification

- Each phase lands as its own PR with before/after screenshots at 375×667 (small phone) and \~375×550 (webview with host chrome), taken via browser-pane mobile emulation.
- Real-device pass at the end of Phases 2 and 3: iOS Safari and the Claude iOS in-app browser, exercising select → bubble menu → suggest, comment entry with keyboard, header navigation, and copy link.
- No new test framework: extend existing component tests where behavior forked on `pointer: coarse` (mock `matchMedia`).

## Out of scope

- Native apps, PWA install/offline support.
- Gesture systems (swipe between tabs, pull-to-refresh).
- Tablet-specific layouts — the `lg:` breakpoint split already handles them acceptably.

## Sequencing

Phases 1→2→3 are ordered by dependency (`dvh` and the coarse-pointer hook unblock the rest). Phase 4 is independent and can interleave. Rough sizing: Phase 1 is a day; Phase 2 is the bulk (BubbleToolbar is the risky item); Phases 3–4 are a day or two each.