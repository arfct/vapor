/**
 * Suggest-mode affordance shared by the editor's shortcuts: structural
 * edits (block moves, ladder, duplicate, clear formatting) are blocked in
 * suggest mode, and this toast says why. Dependency-free: one element on
 * `document.body`, styled by `.suggest-notice` in app.css.
 */

export interface ModeSource {
  get: (key: string) => string | undefined;
}

export const SUGGEST_NOTICE_DEFAULT = "Switch to Edit to change structure";
export const SUGGEST_NOTICE_MS = 2000;

let notice: HTMLElement | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

export function isSuggestMode(docState: ModeSource): boolean {
  return docState.get("mode") === "suggest";
}

/**
 * Shows the notice bottom-center for ~2s. Calling again while visible
 * replaces the text and restarts the timer — never stacks.
 */
export function showSuggestNotice(message = SUGGEST_NOTICE_DEFAULT): void {
  if (typeof document === "undefined") return;

  if (!notice) {
    notice = document.createElement("div");
    notice.className = "suggest-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
  }
  if (!notice.isConnected) document.body.appendChild(notice);
  notice.textContent = message;

  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    notice?.remove();
    notice = null;
    dismissTimer = null;
  }, SUGGEST_NOTICE_MS);
}
