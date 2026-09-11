import { useEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { useSession, notifyAuthChanged } from "~/lib/useSession";
import { useTheme, type Theme } from "~/lib/useTheme";
import { useDocument } from "~/lib/DocumentContext";
import { hasSuggestionMarkup, processAllRanges } from "~/lib/suggestion-actions";
import Icon from "~/components/Icon";

// Popover width.
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
 * theme switch; New document and History; the editing mode (Edit, Suggest, Markdown);
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
  onHistory,
  onSendTo,
  onSignIn,
}: {
  /** Phones only: the comment sheet's open state and toggle. */
  comments?: { open: boolean; onToggle: () => void };
  onNewDocument?: () => void;
  /** Documents only: open the version history. */
  onHistory?: () => void;
  /** Documents only: send to a Kindle or reMarkable, or download the EPUB. */
  onSendTo?: () => void;
  /** Opens the sign-in dialog; the row shows only while signed out. */
  onSignIn?: () => void;
} = {}) {
  const session = useSession();
  const { theme, setTheme } = useTheme();
  const {
    editorInstance: editor,
    mode,
    setMode,
    showPreview,
    togglePreview,
    threads,
    openCommentInput,
    requestSnapshot,
  } = useDocument();
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
  function handleOpenChange(next: boolean) {
    setOpen(next);
  }

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
            {(onNewDocument || onHistory || onSendTo) && (
              <div className="border-t border-border py-1">
                {onNewDocument && <Row icon="note_add" label="New document" onClick={run(onNewDocument)} />}
                {onHistory && <Row icon="history" label="History" onClick={run(onHistory)} />}
                {onSendTo && <Row icon="send" label="Send to device" onClick={run(onSendTo)} />}
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
                onClick={run(() => {
                  if (!editor) return;
                  requestSnapshot("pre_accept_all");
                  processAllRanges(editor, true);
                })}
              />
              <Row
                icon="remove_done"
                label="Reject all"
                disabled={!hasSuggestions}
                onClick={run(() => {
                  if (!editor) return;
                  requestSnapshot("pre_accept_all");
                  processAllRanges(editor, false);
                })}
              />
            </div>
            {session?.signedIn ? (
              <div className="border-t border-border py-1">
                <div className="flex min-h-[36px] items-center px-4 text-sm">
                  <span className="min-w-0 truncate text-muted">{session.email ?? session.displayName}</span>
                </div>
                <Row icon="logout" label="Sign out" onClick={run(signOut)} />
              </div>
            ) : onSignIn ? (
              <div className="border-t border-border py-1">
                <Row icon="login" label="Sign in" onClick={run(onSignIn)} />
              </div>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
