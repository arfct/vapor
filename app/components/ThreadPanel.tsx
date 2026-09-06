import { useState, useCallback, useRef, useEffect } from "react";
import { stripMentionIds } from "~/shared/agent-protocol";
import type { ThreadData } from "~/shared/types";
import CommentEditor from "~/components/CommentEditor";
import type { MentionSourceRef } from "~/lib/mention-suggestion";
import Icon from "~/components/Icon";
import Avatar from "~/components/Avatar";
import { timeAgo } from "~/lib/time-ago";

/**
 * One comment in a thread: avatar in a narrow left column, name, time,
 * and text beside it. `connected` draws a line from this avatar down to
 * the next comment's, tying a thread's replies together.
 */
function CommentRow({
  author,
  timestamp,
  text,
  connectTo,
  showMeta,
  reserveActions = false,
}: {
  author: ThreadData["author"];
  timestamp: number;
  text: string;
  /** Colour of the next comment's author; when set, a dotted line runs down to it. */
  connectTo?: string;
  /** Show the author name and age; an unselected thread shows avatars and text only. */
  showMeta: boolean;
  /** Leave room for the card's floating actions (shown only while selected). */
  reserveActions?: boolean;
}) {
  const reserve = reserveActions ? "pr-14" : "";
  return (
    <div className="flex gap-2">
      <div className="flex w-[25px] shrink-0 flex-col items-center">
        <Avatar
          name={author.name}
          avatar={author.avatar}
          animal={author.animal}
          color={author.color}
          shape={author.agentClient ? "hexagon" : "circle"}
          client={author.agentClient}
          className="h-[25px] w-[25px]"
        />
        {connectTo && (
          <div
            className="thread-connector mt-1 w-[2px] flex-1"
            style={{ backgroundImage: `linear-gradient(to bottom, ${author.color}, ${connectTo})` }}
          />
        )}
      </div>
      <div className={`min-w-0 flex-1 ${connectTo ? "pb-4" : ""}`}>
        {/* Exactly the avatar's height, so the name centres on it and the
            text follows right underneath. The name keeps its width; the
            client/time meta gives way first. Room for the floating actions
            is only taken while they show. */}
        {showMeta && (
          <div className={`flex h-[25px] min-w-0 items-center gap-2 ${reserve}`}>
            <span
              className="max-w-full shrink-0 truncate text-base font-bold"
              style={{
                color: `color-mix(in oklab, ${author.color} 50%, var(--author-shade-base, #000))`,
              }}
            >
              {author.name}
            </span>
            <span className="min-w-0 truncate text-sm text-muted">
              {author.agentClient ? `${author.agentClient} • ` : ""}
              {timeAgo(timestamp)}
            </span>
          </div>
        )}
        {/* Without the meta row the first line centres on the avatar instead. */}
        <p className={showMeta ? "mt-0.5 text-base" : `pt-[2px] text-base ${reserve}`}>{text}</p>
      </div>
    </div>
  );
}

interface ThreadPanelProps {
  thread: ThreadData & { position?: number };
  active: boolean;
  onSelect: (id: string | null) => void;
  onReply: (threadId: string, text: string) => void;
  onResolve: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  /** Who `@` completes to in a reply. */
  mentions?: MentionSourceRef | null;
}

export default function ThreadPanel({
  thread,
  active,
  onSelect,
  onReply,
  onResolve,
  onDelete,
  mentions = null,
}: ThreadPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReplyInput, setShowReplyInput] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!active) setShowReplyInput(false);
  }, [active]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const handleReplySubmit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      onReply(thread.id, text.trim());
      setShowReplyInput(false);
    },
    [thread.id, onReply],
  );

  const handleReplyCancel = useCallback(() => setShowReplyInput(false), []);

  // Leaving an empty box closes it; typed text keeps it open.
  const handleReplyBlur = useCallback((text: string) => {
    if (!text) setShowReplyInput(false);
  }, []);

  return (
    <div
      className={`thread-card group relative cursor-pointer bg-paper px-3 py-4 ${active ? "is-active" : ""}`}
      style={{ "--author-color": thread.author.color } as React.CSSProperties}
      onClick={() => onSelect(active ? null : thread.id)}
    >
      {/* Actions float in the corner so they never stretch the author row. */}
      <div
        className={`absolute right-2 top-4 flex h-[25px] items-center gap-1 transition-opacity ${
          menuOpen || active ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => onResolve(thread.id)}
          title={thread.resolved ? "Reopen" : "Resolve"}
          aria-label={thread.resolved ? "Reopen" : "Resolve"}
          className="flex h-[25px] w-[25px] cursor-pointer items-center justify-center text-muted transition-colors hover:text-ink"
        >
          <Icon name={thread.resolved ? "undo" : "check"} />
        </button>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="More actions"
            aria-label="More actions"
            className="flex h-[25px] w-[25px] cursor-pointer items-center justify-center text-muted transition-colors hover:text-ink"
          >
            <Icon name="more_vert" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-10 min-w-28 border border-border bg-paper py-1 shadow-lg">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(thread.id);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-red-500 transition-colors hover:bg-border"
              >
                <Icon name="delete" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <CommentRow
        author={thread.author}
        timestamp={thread.createdAt}
        text={stripMentionIds(thread.commentText)}
        connectTo={thread.replies[0]?.author.color}
        showMeta={active}
        reserveActions={active || menuOpen}
      />

      {thread.replies.map((reply, i) => (
        <CommentRow
          key={reply.id}
          author={reply.author}
          timestamp={reply.createdAt}
          text={stripMentionIds(reply.text)}
          connectTo={thread.replies[i + 1]?.author.color}
          showMeta={active}
        />
      ))}

      {/* Reply link, shown only while the thread is selected; input appears on click */}
      {active && (
      <div className="mt-3 pl-[33px]" onClick={(e) => e.stopPropagation()}>
        {showReplyInput ? (
          <CommentEditor
            placeholder="Reply..."
            onSubmit={handleReplySubmit}
            onCancel={handleReplyCancel}
            onBlur={handleReplyBlur}
            autoFocus
            mentions={mentions}
            className="comment-editor-box w-full rounded-full border border-border bg-paper px-3 py-1.5 text-base focus-within:border-coral"
          />
        ) : (
          <button
            onClick={() => setShowReplyInput(true)}
            className="cursor-pointer py-2.5 text-base text-muted transition-colors hover:text-ink"
          >
            Reply
          </button>
        )}
      </div>
      )}
    </div>
  );
}
