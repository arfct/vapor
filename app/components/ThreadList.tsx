import { useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import ThreadPanel from "~/components/ThreadPanel";

export default function ThreadList() {
  const {
    threads,
    activeThreadId,
    setActiveThreadId: onSelectThread,
    addReply: onReply,
    resolveThread: onResolve,
    deleteThread: onDelete,
  } = useDocument();

  const [showResolved, setShowResolved] = useState(false);

  const openThreads = threads.filter((t) => !t.resolved);
  const resolvedThreads = threads.filter((t) => t.resolved);
  const visibleThreads = showResolved ? threads : openThreads;

  return (
    <div className="flex flex-col">
      {visibleThreads.map((thread) => (
        <div key={thread.id} className="border-b border-border">
          <ThreadPanel
            thread={thread}
            active={activeThreadId === thread.id}
            onSelect={onSelectThread}
            onReply={onReply}
            onResolve={onResolve}
            onDelete={onDelete}
          />
        </div>
      ))}

      {resolvedThreads.length > 0 && (
        <button
          onClick={() => setShowResolved((v) => !v)}
          className="cursor-pointer px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-border"
        >
          {showResolved
            ? "Hide resolved"
            : `Show resolved (${resolvedThreads.length})`}
        </button>
      )}
    </div>
  );
}
