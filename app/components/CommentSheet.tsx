import { useEffect } from "react";
import { useDocument } from "~/lib/DocumentContext";
import ThreadPanel from "~/components/ThreadPanel";
import CommentInput from "~/components/CommentInput";
import Icon from "~/components/Icon";

const navButton =
  "flex h-[44px] w-[44px] cursor-pointer items-center justify-center text-ink transition-colors hover:bg-border disabled:cursor-default disabled:text-border";

/**
 * Comments on a narrow screen: a bottom sheet showing one thread at a
 * time, with arrows to step through the open threads in document order.
 * Selecting a thread here highlights it in the document, the same as
 * clicking it in the desktop rail.
 */
export default function CommentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    threads,
    activeThreadId,
    setActiveThreadId,
    addReply,
    resolveThread,
    deleteThread,
    commentActive,
    openCommentInput,
  } = useDocument();

  // Open threads, plus the active one even if it has been resolved so a
  // just-resolved thread doesn't vanish from under the reader.
  const visible = threads.filter((t) => !t.resolved || t.id === activeThreadId);
  const index = visible.findIndex((t) => t.id === activeThreadId);
  const current = index >= 0 ? visible[index] : visible[0];

  // Land on the first thread when the sheet opens with nothing selected.
  useEffect(() => {
    if (open && !activeThreadId && visible.length > 0) setActiveThreadId(visible[0].id);
  }, [open, activeThreadId, visible, setActiveThreadId]);

  if (!open) return null;

  const at = current ? visible.indexOf(current) : -1;
  const step = (delta: number) => {
    const next = visible[at + delta];
    if (next) setActiveThreadId(next.id);
  };

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex max-h-[60%] flex-col border-t border-border bg-paper pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(0,0,0,0.08)] lg:hidden"
      role="dialog"
      aria-label="Comments"
    >
      <div className="flex h-[44px] shrink-0 items-center border-b border-border">
        <button onClick={() => step(-1)} disabled={at <= 0} aria-label="Previous comment" className={navButton}>
          <Icon name="chevron_left" />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm text-muted">
          {commentActive
            ? "New comment"
            : visible.length === 0
              ? "No comments"
              : `${at + 1} of ${visible.length}`}
        </span>
        <button
          onClick={() => step(1)}
          disabled={at < 0 || at >= visible.length - 1}
          aria-label="Next comment"
          className={navButton}
        >
          <Icon name="chevron_right" />
        </button>
        <button
          onClick={openCommentInput}
          disabled={commentActive}
          aria-label="New comment"
          className={navButton}
        >
          <Icon name="add_comment" />
        </button>
        <button onClick={onClose} aria-label="Close comments" className={navButton}>
          <Icon name="close" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CommentInput />
        {current && !commentActive && (
          <ThreadPanel
            thread={current}
            active
            onSelect={() => {}}
            onReply={addReply}
            onResolve={resolveThread}
            onDelete={deleteThread}
          />
        )}
      </div>
    </div>
  );
}
