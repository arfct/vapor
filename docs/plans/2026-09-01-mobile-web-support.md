# Mobile web support

vapor's URLs get opened on phones — and often inside in-app browsers (Claude, Slack, iMessage previews), where the page is nested in host UI: short viewports, dynamic toolbars, no address bar control, aggressive tab suspension, and webviews that block Google OAuth. This plan treats the embedded webview as the primary mobile case, not the exception.

An audit of the current code found the connectivity layer already solid (idle-sleep + full resync on reconnect survives webview suspension) and `16px` input font already prevents iOS zoom-on-focus. The gaps are layout and touch.

## Phase 1 — Foundations (small, unblocking)

1. **`viewport-fit=cover` + safe-area insets.** Add `viewport-fit=cover` to the viewport meta in `app/root.tsx`, then pad the doc header top and MobilePanel bottom with `env(safe-area-inset-*)`. Without the meta change, none of the inset CSS does anything.
2. **Replace `vh` with `dvh`.** `body`'s `100vh` and MobilePanel's `33vh` compute against the largest viewport on mobile Safari and ignore the keyboard. Switch to `dvh` (with `vh` fallback line for old browsers).
3. **A `usePointerCoarse()` hook** (one `matchMedia("(pointer: coarse)")`), so components can adapt behavior — not just layout — for touch. Phases 2–3 depend on it.

## Phase 2 — Touch-hostile UI (the real breakage)

4. **Header scroll affordance.** The doc and home headers scroll horizontally with `scrollbar-none` and zero visual hint — hidden functionality on a phone. Add an edge fade mask when content overflows, and audit what actually needs to be in the header at phone width (the doc id + expiry text could collapse to just the id).
5. **Hover-only controls need a touch path.**
   - ThreadPanel's resolve/menu icons are `opacity-0` until `group-hover` — invisible on touch. On coarse pointers, show them when the thread is active/selected instead.
   - FormatToolbar's hover-driven undimming never fires on touch; keep it full-opacity on coarse pointers.
6. **BubbleToolbar on touch.** The `view.hasFocus()` gate and `updateDelay: 0` fight iOS's native selection handles (menu flickers or never appears). On coarse pointers: add an update delay, allow flip/shift placement so the keyboard doesn't cover it, and test against native selection-handle dragging specifically. This is the highest-effort item; time-box it and fall back to a fixed selection-actions row in the MobilePanel if the floating menu can't be made reliable.
7. **Tap targets.** Sweep the sub-44px buttons: MobilePanel tabs, bubble-menu buttons (Accept/Reject sit adjacent — a mis-tap on track changes is destructive), CommentInput's Add/Cancel, ThreadPanel icons. Padding changes only, no redesign.

## Phase 3 — Keyboard and panel behavior

8. **MobilePanel vs the keyboard.** With `dvh` from Phase 1, verify the comment-entry flow with the keyboard open. If the panel still misbehaves, track `window.visualViewport` height and size the panel from it. When a text input inside the panel focuses, let the panel grow to fill the visible space above the keyboard.
9. **Keyboard hints.** `enterkeyhint="send"` on comment/reply inputs so mobile keyboards show Send instead of Return.

## Phase 4 — Embedded-webview specifics

10. **Google sign-in degrades gracefully.** GSI is blocked in many webviews (`disallowed_useragent`). Detect the failure (GSI's button simply not rendering is the common symptom) and show a one-line "Sign-in needs a real browser — open this page in Safari/Chrome" note instead of a dead button. Anonymous use is already first-class; keep it the default path.
11. **Tolerate ephemeral storage.** Webview `localStorage` can be partitioned or wiped, so the anonymous identity and theme may reset between visits. Verify nothing breaks when storage is empty or throws (private mode); wrap reads/writes defensively.
12. **Copy-link works everywhere.** `navigator.clipboard` requires a secure context and can be denied in webviews; add a fallback (legacy execCommand or a select-all text field) so Share → Copy link never silently no-ops.

## Verification

- Each phase lands as its own PR with before/after screenshots at 375×667 (small phone) and ~375×550 (webview with host chrome), taken via browser-pane mobile emulation.
- Real-device pass at the end of Phases 2 and 3: iOS Safari and the Claude iOS in-app browser, exercising select → bubble menu → suggest, comment entry with keyboard, header navigation, and copy link.
- No new test framework: extend existing component tests where behavior forked on `pointer: coarse` (mock `matchMedia`).

## Out of scope

- Native apps, PWA install/offline support.
- Gesture systems (swipe between tabs, pull-to-refresh).
- Tablet-specific layouts — the `lg:` breakpoint split already handles them acceptably.

## Sequencing

Phases 1→2→3 are ordered by dependency (`dvh` and the coarse-pointer hook unblock the rest). Phase 4 is independent and can interleave. Rough sizing: Phase 1 is a day; Phase 2 is the bulk (BubbleToolbar is the risky item); Phases 3–4 are a day or two each.
