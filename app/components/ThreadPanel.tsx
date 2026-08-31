import { useState, useCallback, useRef, useEffect } from "react";
import type { ThreadData } from "~/shared/types";

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

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\u2026" : text;
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
  const [showReplyInput, setShowReplyInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showReplyInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showReplyInput]);

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

  return (
    <div
      className={`cursor-pointer p-3 ${active ? "bg-canary/15" : ""}`}
      onClick={() => onSelect(active ? null : thread.id)}
    >
      {/* Author + timestamp */}
      <div className="flex items-center gap-1.5">
        {thread.author.avatar ? (
          <img className="author-avatar" src={thread.author.avatar} alt="" />
        ) : (
          thread.author.animal && (
            <span className="anon-animal text-sm" style={{ color: thread.author.color }}>
              {thread.author.animal}
            </span>
          )
        )}
        <span className="text-base font-medium">{thread.author.name}</span>
        <span className="text-sm text-muted">{timeAgo(thread.createdAt)}</span>
      </div>

      {/* Highlight context */}
      {thread.highlightText && (
        <div className="cm-highlight mt-1 truncate px-1 text-base">
          {truncate(thread.highlightText, 80)}
        </div>
      )}

      {/* Comment text */}
      <p className="mt-1 text-base">{thread.commentText}</p>

      {/* Replies */}
      {thread.replies.length > 0 && (
        <div className="mt-2 space-y-2 border-l border-border pl-3">
          {thread.replies.map((reply) => (
            <div key={reply.id}>
              <div className="flex items-center gap-1.5">
                {reply.author.avatar ? (
                  <img className="author-avatar" src={reply.author.avatar} alt="" />
                ) : (
                  reply.author.animal && (
                    <span className="anon-animal text-sm" style={{ color: reply.author.color }}>
                      {reply.author.animal}
                    </span>
                  )
                )}
                <span className="text-base font-medium">{reply.author.name}</span>
                <span className="text-sm text-muted">
                  {timeAgo(reply.createdAt)}
                </span>
              </div>
              <p className="mt-0.5 text-base">{reply.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      {showReplyInput && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleReplyKeyDown}
            placeholder="Reply..."
            className="w-full border border-border bg-paper px-2 py-1 outline-none focus:border-coral"
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-2 flex border border-border" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setShowReplyInput(true)}
          className="flex-1 cursor-pointer px-2.5 py-1.5 text-sm uppercase tracking-wider text-muted transition-colors hover:bg-border"
        >
          Reply
        </button>
        <button
          onClick={() => onResolve(thread.id)}
          className="flex-1 cursor-pointer border-l border-border px-2.5 py-1.5 text-sm uppercase tracking-wider text-green-600 transition-colors hover:bg-border"
        >
          {thread.resolved ? "Reopen" : "Resolve"}
        </button>
        <button
          onClick={() => onDelete(thread.id)}
          className="flex-1 cursor-pointer border-l border-border px-2.5 py-1.5 text-sm uppercase tracking-wider text-red-500 transition-colors hover:bg-border"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
