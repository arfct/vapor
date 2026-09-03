import { useState, useCallback, useRef, useEffect } from "react";
import type { ThreadData } from "~/shared/types";
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
  connected,
  reserveActions = false,
}: {
  author: ThreadData["author"];
  timestamp: number;
  text: string;
  connected: boolean;
  /** Leave room for the card's floating actions: on hover, or always (while active). */
  reserveActions?: boolean | "always";
}) {
  return (
    <div className="flex gap-2">
      <div className="flex w-[25px] shrink-0 flex-col items-center">
        <Avatar
          name={author.name}
          avatar={author.avatar}
          animal={author.animal}
          color={author.color}
          className="h-[25px] w-[25px]"
        />
        {connected && <div className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className={`min-w-0 flex-1 ${connected ? "pb-4" : ""}`}>
        {/* Exactly the avatar's height, so the name centres on it and the
            text follows right underneath. */}
        {/* The name keeps its width; the client/time meta gives way first.
            Room for the floating actions is only taken while they show. */}
        <div
          className={`flex h-[25px] min-w-0 items-center gap-2 ${
            reserveActions ? "group-hover:pr-14" : ""
          } ${reserveActions === "always" ? "pr-14" : ""}`}
        >
          <span className="max-w-full shrink-0 truncate text-base font-bold">{author.name}</span>
          <span className="min-w-0 truncate text-sm text-muted">
            {author.agentClient ? `${author.agentClient} • ` : ""}
            {timeAgo(timestamp)}
          </span>
        </div>
        <p className="mt-0.5 text-base">{text}</p>
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
}

export default function ThreadPanel({
  thread,
  active,
  onSelect,
  onReply,
  onResolve,
  onDelete,
}: ThreadPanelProps) {
  const [replyText, setReplyText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReplyInput, setShowReplyInput] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showReplyInput) replyInputRef.current?.focus();
  }, [showReplyInput]);

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

  const handleReplySubmit = useCallback(() => {
    if (!replyText.trim()) return;
    onReply(thread.id, replyText.trim());
    setReplyText("");
    setShowReplyInput(false);
  }, [thread.id, replyText, onReply]);

  const handleReplyKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleReplySubmit();
      } else if (e.key === "Escape") {
        setReplyText("");
        setShowReplyInput(false);
      }
    },
    [handleReplySubmit],
  );

  const handleReplyBlur = useCallback(() => {
    if (!replyText.trim()) setShowReplyInput(false);
  }, [replyText]);

  return (
    <div
      className={`group relative cursor-pointer border px-3 py-4 transition-colors ${
        active ? "border-border bg-canary/15" : "border-transparent hover:border-border"
      }`}
      onClick={() => onSelect(active ? null : thread.id)}
    >
      {/* Actions float in the corner so they never stretch the author row. */}
      <div
        className={`absolute right-2 top-4 flex h-[25px] items-center gap-1 bg-inherit transition-opacity focus-within:opacity-100 group-hover:opacity-100 ${
          menuOpen || active ? "opacity-100" : "opacity-0"
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
        text={thread.commentText}
        connected={thread.replies.length > 0}
        reserveActions={active || menuOpen ? "always" : true}
      />

      {thread.replies.map((reply, i) => (
        <CommentRow
          key={reply.id}
          author={reply.author}
          timestamp={reply.createdAt}
          text={reply.text}
          connected={i < thread.replies.length - 1}
        />
      ))}

      {/* Reply link, shown only while the thread is selected; input appears on click */}
      {active && (
      <div className="mt-3 pl-[33px]" onClick={(e) => e.stopPropagation()}>
        {showReplyInput ? (
          <input
            ref={replyInputRef}
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleReplyKeyDown}
            onBlur={handleReplyBlur}
            enterKeyHint="send"
            placeholder="Reply..."
            className="w-full rounded-full border border-border bg-paper px-3 py-1.5 text-base outline-none focus:border-coral"
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
