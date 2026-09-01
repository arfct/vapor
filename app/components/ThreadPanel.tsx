import { useState, useCallback, useRef, useEffect } from "react";
import type { ThreadData } from "~/shared/types";
import Icon from "~/components/Icon";
import Avatar from "~/components/Avatar";

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function AuthorHeader({
  author,
  timestamp,
  children,
}: {
  author: ThreadData["author"];
  timestamp: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Avatar
        name={author.name}
        avatar={author.avatar}
        animal={author.animal}
        color={author.color}
        className="h-[25px] w-[25px]"
      />
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-base font-bold">{author.name}</span>
        <span className="shrink-0 text-sm text-muted">
          {author.agentClient ? `${author.agentClient} • ` : ""}
          {timeAgo(timestamp)}
        </span>
      </div>
      {children}
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
      className={`group cursor-pointer p-3 ${active ? "bg-canary/15" : ""}`}
      onClick={() => onSelect(active ? null : thread.id)}
    >
      {/* Author + timestamp + actions */}
      <AuthorHeader author={thread.author} timestamp={thread.createdAt}>
        <div
          className={`ml-auto flex items-center gap-1 transition-opacity focus-within:opacity-100 group-hover:opacity-100 ${
            menuOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => onResolve(thread.id)}
            title={thread.resolved ? "Reopen" : "Resolve"}
            aria-label={thread.resolved ? "Reopen" : "Resolve"}
            className="cursor-pointer p-1 text-muted transition-colors hover:text-ink"
          >
            <Icon name={thread.resolved ? "undo" : "check"} />
          </button>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title="More actions"
              aria-label="More actions"
              className="cursor-pointer p-1 text-muted transition-colors hover:text-ink"
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
      </AuthorHeader>

      {/* Comment text */}
      <p className="mt-1 pl-[33px] text-base">{thread.commentText}</p>

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {thread.replies.map((reply) => (
            <div key={reply.id}>
              <AuthorHeader author={reply.author} timestamp={reply.createdAt} />
              <p className="mt-1 pl-[33px] text-base">{reply.text}</p>
            </div>
          ))}
        </div>
      )}

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
            placeholder="Reply..."
            className="w-full rounded-full border border-border bg-paper px-3 py-1.5 text-base outline-none focus:border-coral"
          />
        ) : (
          <button
            onClick={() => setShowReplyInput(true)}
            className="cursor-pointer text-base text-muted transition-colors hover:text-ink"
          >
            Reply
          </button>
        )}
      </div>
      )}
    </div>
  );
}
