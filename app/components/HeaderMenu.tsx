import { useEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { useSession, notifyAuthChanged } from "~/lib/useSession";
import { useTheme, type Theme } from "~/lib/useTheme";
import { useDocument } from "~/lib/DocumentContext";
import { hasSuggestionMarkup, processAllRanges } from "~/lib/suggestion-actions";
import Icon from "~/components/Icon";
import Avatar from "~/components/Avatar";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

// In-app webviews block Google Identity Services (disallowed_useragent): the
// script never loads or renderButton leaves the host empty. Past this delay
// with nothing rendered, show a note instead of an empty slot.
const GSI_FALLBACK_DELAY_MS = 2500;

// Popover width, which the Google button also spans.
const MENU_WIDTH_PX = 252;

const themeOptions: { value: Theme; icon: string; label: string }[] = [
  { value: "light", icon: "light_mode", label: "Light" },
  { value: "dark", icon: "dark_mode", label: "Dark" },
  { value: "auto", icon: "computer", label: "Auto" },
];

const rowClass =
  "flex min-h-[36px] w-full cursor-pointer items-center gap-2 px-4 text-left text-sm text-ink transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50";

function Row({
  icon,
  label,
  onClick,
  checked = false,
  disabled = false,
  trailing,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  checked?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button className={rowClass} onClick={onClick} disabled={disabled} role="menuitem">
      <Icon name={icon} />
      <span>{label}</span>
      {checked && <span className="ml-auto pl-3 text-muted">{"✓"}</span>}
      {!checked && trailing !== undefined && <span className="ml-auto pl-3 text-muted">{trailing}</span>}
    </button>
  );
}

/**
 * The one menu at the top right. The wordmark (a link home) with the
 * theme switch; New document, Upload; the editing mode (Edit, Suggest, Markdown);
 * comments (start one, and on phones show or hide the sheet); Accept all /
 * Reject all; and the account row (Google sign-in or name + sign-out) at
 * the foot.
 *
 * The trigger is a comment bubble, except in Suggest or Markdown mode,
 * where it shows the mode so that state is never hidden behind a click.
 */
export default function HeaderMenu({
  comments,
  onNewDocument,
  onUpload,
}: {
  /** Phones only: the comment sheet's open state and toggle. */
  comments?: { open: boolean; onToggle: () => void };
  onNewDocument?: () => void;
  onUpload?: () => void;
} = {}) {
  const session = useSession();
  const { theme, setTheme } = useTheme();
  const { editorInstance: editor, mode, setMode, showPreview, togglePreview, threads, openCommentInput } =
    useDocument();
  const [open, setOpen] = useState(false);
  const [hasSuggestions, setHasSuggestions] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  // The Auto theme's glyph is the device it follows: a phone on touch screens.
  const [autoIcon, setAutoIcon] = useState("computer");

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => setAutoIcon(coarse.matches ? "mobile" : "computer");
    update();
    coarse.addEventListener("change", update);
    return () => coarse.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      setHasSuggestions(hasSuggestionMarkup(editor));
      setHasSelection(!editor.state.selection.empty);
    };
    update();
    editor.on("update", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("update", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  const openThreads = threads.filter((t) => !t.resolved).length;
  const modeIcon = showPreview ? "code" : mode === "suggest" ? "rate_review" : null;
  const title = showPreview ? "Markdown" : mode === "suggest" ? "Suggest" : "Menu";
  // Rows close the menu, then act.
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const [signInUnavailable, setSignInUnavailable] = useState(false);
  // State, not a ref: the popover portal mounts a render after `open`
  // flips, so the effect must re-run once the host element exists.
  const [buttonHost, setButtonHost] = useState<HTMLDivElement | null>(null);

  function handleOpenChange(next: boolean) {
    if (next) setSignInUnavailable(false);
    setOpen(next);
  }

  // Load Google Identity Services and render its button only while the menu
  // is open with no active session.
  useEffect(() => {
    if (!open || session?.signedIn || !buttonHost) return;
    let cancelled = false;
    const host = buttonHost;

    const markUnavailable = () => {
      if (!cancelled) setSignInUnavailable(true);
    };
    const fallbackTimer = window.setTimeout(() => {
      if (host.childElementCount === 0) markUnavailable();
    }, GSI_FALLBACK_DELAY_MS);

    async function mount() {
      let config: { googleClientId?: string };
      try {
        config = (await fetch("/auth/config").then((r) => r.json())) as typeof config;
      } catch {
        markUnavailable();
        return;
      }
      if (cancelled) return;
      if (!config.googleClientId) {
        // Not configured is a server-side gap, not a webview limitation.
        clearTimeout(fallbackTimer);
        return;
      }

      const render = () => {
        if (cancelled || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: config.googleClientId as string,
          callback: async (r) => {
            const res = await fetch("/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: r.credential }),
            });
            if (res.ok) notifyAuthChanged();
          },
        });
        const dark =
          theme === "dark" ||
          (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        window.google.accounts.id.renderButton(host, {
          theme: dark ? "filled_black" : "outline",
          shape: "rectangular",
          width: MENU_WIDTH_PX,
        });
      };

      if (window.google) {
        render();
      } else {
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.onload = render;
        s.onerror = markUnavailable;
        document.head.appendChild(s);
      }
    }
    mount();
    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
    };
  }, [open, session?.signedIn, theme, buttonHost]);

  async function signOut() {
    await fetch("/auth/logout", { method: "POST" });
    notifyAuthChanged();
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <button aria-label="Menu" title={title} className="system-trigger header-button shrink-0">
            <Icon name={modeIcon ?? "comment"} />
          </button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={0}
          className="z-50"
        >
          <Popover.Popup
            className="border border-border bg-paper shadow-md outline-none"
            style={{ width: MENU_WIDTH_PX }}
          >
            <div className="flex items-center px-4 py-3">
              <a href="/" className="text-sm font-medium tracking-wider text-ink transition-colors hover:text-muted">
                VAPOR
              </a>
              <div className="theme-switch ml-auto flex gap-1">
                {themeOptions.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTheme(t.value)}
                    title={t.label}
                    aria-label={t.label}
                    className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors ${
                      theme === t.value ? "bg-border text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    <Icon name={t.value === "auto" ? autoIcon : t.icon} />
                  </button>
                ))}
              </div>
            </div>
            {(onNewDocument || onUpload) && (
              <div className="border-t border-border py-1">
                {onNewDocument && <Row icon="note_add" label="New document" onClick={run(onNewDocument)} />}
                {onUpload && <Row icon="upload_file" label="Upload .md file" onClick={run(onUpload)} />}
              </div>
            )}
            <div className="border-t border-border py-1" role="group" aria-label="Editing mode">
              <Row
                icon="edit"
                label="Edit"
                checked={mode === "edit" && !showPreview}
                onClick={run(() => {
                  setMode("edit");
                  if (showPreview) togglePreview();
                })}
              />
              <Row
                icon="rate_review"
                label="Suggest"
                checked={mode === "suggest" && !showPreview}
                onClick={run(() => {
                  setMode("suggest");
                  if (showPreview) togglePreview();
                })}
              />
              <Row icon="code" label="Markdown" checked={showPreview} onClick={run(togglePreview)} />
            </div>
            <div className="border-t border-border py-1" role="group" aria-label="Comments">
              <Row
                icon="add_comment"
                label={hasSelection ? "Comment on selection" : "New comment"}
                onClick={run(openCommentInput)}
              />
              {comments && (
                <Row
                  icon="mode_comment"
                  label={comments.open ? "Hide comments" : "Show comments"}
                  trailing={openThreads > 0 ? openThreads : undefined}
                  onClick={run(comments.onToggle)}
                />
              )}
            </div>
            <div className="border-t border-border py-1" role="group" aria-label="Suggestions">
              <Row
                icon="done_all"
                label="Accept all"
                disabled={!hasSuggestions}
                onClick={run(() => editor && processAllRanges(editor, true))}
              />
              <Row
                icon="remove_done"
                label="Reject all"
                disabled={!hasSuggestions}
                onClick={run(() => editor && processAllRanges(editor, false))}
              />
            </div>
            {session?.signedIn ? (
              <div className="flex items-center gap-2 border-t border-border px-4 py-3">
                <Avatar
                  name={session.displayName ?? "?"}
                  avatar={session.avatar}
                  className="h-6 w-6"
                />
                <span className="min-w-0 truncate text-sm">{session.displayName}</span>
                <button
                  onClick={signOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="ml-auto cursor-pointer text-muted transition-colors hover:text-ink"
                >
                  <Icon name="logout" />
                </button>
              </div>
            ) : signInUnavailable ? (
              <p className="border-t border-border px-4 py-3 text-sm text-muted">
                Sign-in needs a full browser — open this page in Safari or Chrome.
              </p>
            ) : (
              // Google's button draws its own border. Pulled out by 1px, that
              // border lands on the popover's, so the button reads as the
              // popover's foot rather than a box inside it.
              <div ref={setButtonHost} className="-mx-px -mb-px flex h-[40px] justify-center" />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
