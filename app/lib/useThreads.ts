import { useState, useEffect, useCallback, useRef } from "react";
import { getMarkRange, type Editor as TiptapEditor } from "@tiptap/core";
import type { ThreadData, ThreadReply, UserInfo } from "~/shared/types";
import {
  scanDocumentComments,
  matchThreadsToComments,
  type MatchedThread,
} from "~/lib/comment-threads";
import { blockHash } from "~/shared/agent-protocol";

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Deterministic thread id for a comment mark, so every client that decides
 * to create a thread for the same mark writes the SAME Y.Map key and the
 * writes converge instead of duplicating.
 */
export function threadIdForComment(comment: { commentText: string; highlightText?: string }): string {
  return `t-${blockHash(`${comment.commentText}|${comment.highlightText ?? ""}`)}`;
}

function readAllThreads(map: { forEach: (cb: (val: string, key: string) => void) => void }): ThreadData[] {
  const threads: ThreadData[] = [];
  map.forEach((val) => {
    try {
      threads.push(JSON.parse(val));
    } catch {
      // ignore malformed entries
    }
  });
  return threads;
}

export function useThreads({
  doc,
  editor,
  user,
}: {
  doc: import("yjs").Doc;
  editor: TiptapEditor | null;
  user: UserInfo;
}) {
  const [threads, setThreads] = useState<MatchedThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const threadsMapRef = useRef(doc.getMap<string>("threads"));
  const pendingActivateRef = useRef<string | null>(null);
  const reconcilingRef = useRef(false);
  /** Delayed fallback creations for marks whose author hasn't written a thread yet. */
  const fallbackTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const suppressSelectionRef = useRef(false);

  // Reconcile: scan document marks, auto-create Y.Map entries for new comments,
  // then match all threads to positions and update state
  const reconcile = useCallback(() => {
    if (!editor || reconcilingRef.current) return;

    const comments = scanDocumentComments(editor);
    const allThreads = readAllThreads(threadsMapRef.current);

    // Match existing threads to comments
    const sorted = [...allThreads].sort((a, b) => a.createdAt - b.createdAt);
    const usedCommentIndices = new Set<number>();
    for (const thread of sorted) {
      for (let i = 0; i < comments.length; i++) {
        if (usedCommentIndices.has(i)) continue;
        if (comments[i].commentText === thread.commentText) {
          usedCommentIndices.add(i);
          break;
        }
      }
    }

    // Auto-create threads for unmatched comments (document marks are ground
    // truth) — but only the client that AUTHORED the comment creates its
    // thread immediately. Marks sync to every connected client within
    // milliseconds, and when each of them "reconciled" instantly, one
    // comment became N threads, each stamped with a bystander's identity.
    // Non-authors instead schedule a delayed fallback (covering imported
    // {>>comments<<} whose author isn't present), and every creation path
    // uses a deterministic id so stragglers converge on one Y.Map key.
    let created = false;
    for (let i = 0; i < comments.length; i++) {
      if (usedCommentIndices.has(i)) continue;

      const comment = comments[i];
      const id = threadIdForComment(comment);
      const isAuthor = pendingActivateRef.current === comment.commentText;

      if (!isAuthor) {
        if (!fallbackTimersRef.current.has(id)) {
          const timer = setTimeout(() => {
            fallbackTimersRef.current.delete(id);
            // Re-check: skip if the author's (or anyone's) thread arrived.
            if (threadsMapRef.current.get(id) !== undefined) return;
            const existing = readAllThreads(threadsMapRef.current);
            if (existing.some((t) => t.commentText === comment.commentText)) return;
            // Re-scan: the mark may be gone by now (the author deleted
            // the text). Ground truth is the document.
            const live = scanDocumentComments(editor);
            if (!live.some((c) => c.commentText === comment.commentText)) return;
            reconcilingRef.current = true;
            threadsMapRef.current.set(
              id,
              JSON.stringify({
                id,
                commentText: comment.commentText,
                highlightText: comment.highlightText,
                author: user,
                createdAt: Date.now(),
                resolved: false,
                replies: [],
              } satisfies ThreadData),
            );
            reconcilingRef.current = false;
          }, 3000);
          fallbackTimersRef.current.set(id, timer);
        }
        continue;
      }

      const thread: ThreadData = {
        id,
        commentText: comment.commentText,
        highlightText: comment.highlightText,
        author: user,
        createdAt: Date.now(),
        resolved: false,
        replies: [],
      };

      reconcilingRef.current = true;
      threadsMapRef.current.set(id, JSON.stringify(thread));
      reconcilingRef.current = false;
      created = true;
      setActiveThreadId(id);
      pendingActivateRef.current = null;

      const pendingTimer = fallbackTimersRef.current.get(id);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        fallbackTimersRef.current.delete(id);
      }
    }

    // Re-read threads if we created any, then match and update state
    const finalThreads = created
      ? readAllThreads(threadsMapRef.current)
      : allThreads;

    try {
      const matched = matchThreadsToComments(finalThreads, comments);
      matched.sort((a, b) => {
        if (a.position !== undefined && b.position !== undefined)
          return a.position - b.position;
        if (a.position !== undefined) return -1;
        if (b.position !== undefined) return 1;
        return a.createdAt - b.createdAt;
      });
      setThreads(matched);
    } catch {
      setThreads(finalThreads.map((t) => ({ ...t, position: undefined })));
    }
  }, [editor, user]);

  // Cancel any pending fallback creations when the hook unmounts.
  useEffect(() => {
    const timers = fallbackTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // Observe Y.Map changes (from remote clients)
  useEffect(() => {
    const map = threadsMapRef.current;
    const observer = () => {
      if (!reconcilingRef.current) reconcile();
    };
    map.observe(observer);
    queueMicrotask(reconcile);
    return () => map.unobserve(observer);
  }, [reconcile]);

  // Observe editor updates to reconcile (picks up typed/pasted comments)
  useEffect(() => {
    if (!editor) return;
    const handler = () => reconcile();
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, reconcile]);

  // Auto-highlight sidebar thread when cursor moves into a comment range
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      if (suppressSelectionRef.current) {
        suppressSelectionRef.current = false;
        return;
      }
      const { from } = editor.state.selection;
      const $from = editor.state.doc.resolve(from);
      // Use nodeAt for reliable mark detection at boundaries (inclusive:false)
      const node = editor.state.doc.nodeAt(from);
      const marks = node?.isText ? node.marks : $from.marks();

      // Direct: cursor inside a criticComment mark
      const commentMark = marks.find((m) => m.type.name === "criticComment");
      if (commentMark) {
        if (node?.isText) {
          const match = threads.find((t) => t.commentText === node.text);
          if (match) {
            setActiveThreadId(match.id);
            return;
          }
        }
      }

      // Indirect: cursor inside a criticHighlight → find adjacent comment
      const highlightMark = marks.find((m) => m.type.name === "criticHighlight");
      if (highlightMark) {
        const highlightType = editor.schema.marks.criticHighlight;
        const commentType = editor.schema.marks.criticComment;
        if (highlightType && commentType) {
          const hlRange = getMarkRange($from, highlightType);
          if (hlRange) {
            const $afterHl = editor.state.doc.resolve(hlRange.to);
            const cmRange = getMarkRange($afterHl, commentType);
            if (cmRange) {
              const text = editor.state.doc.textBetween(cmRange.from, cmRange.to);
              const match = threads.find((t) => t.commentText === text);
              if (match) {
                setActiveThreadId(match.id);
                return;
              }
            }
          }
        }
      }

      setActiveThreadId(null);
    };
    editor.on("selectionUpdate", handler);
    return () => {
      editor.off("selectionUpdate", handler);
    };
  }, [editor, threads, setActiveThreadId]);

  // Queue activation of a comment by text (used by CommentInput)
  const activateComment = useCallback((commentText: string) => {
    pendingActivateRef.current = commentText;
  }, []);

  const addReply = useCallback(
    (threadId: string, text: string) => {
      const raw = threadsMapRef.current.get(threadId);
      if (!raw) return;
      const thread: ThreadData = JSON.parse(raw);
      const reply: ThreadReply = {
        id: generateId(),
        author: user,
        text,
        createdAt: Date.now(),
      };
      thread.replies.push(reply);
      threadsMapRef.current.set(threadId, JSON.stringify(thread));
    },
    [user],
  );

  // Remove inline CriticMarkup marks for a comment from the editor.
  // If paired with a highlight, removes both marks but keeps the highlighted text.
  const removeInlineComment = useCallback(
    (thread: ThreadData) => {
      if (!editor) return;
      const comments = scanDocumentComments(editor);
      const comment = comments.find((c) => c.commentText === thread.commentText);
      if (!comment) return;

      const commentType = editor.schema.marks.criticComment;
      const highlightType = editor.schema.marks.criticHighlight;
      if (!commentType) return;

      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          // Delete the comment text (it's just the comment mark text node)
          tr.delete(comment.position, comment.endPosition);

          // If there was a highlight, remove the highlight mark but keep text
          if (comment.highlightText && highlightType) {
            // After deleting comment, the highlight is still at its original position
            // We need to find it again (position may have shifted if comment was after)
            // Since we deleted comment text that was after the highlight, positions before are unchanged
            // Walk doc to find the highlight mark and remove it
            const newDoc = tr.doc;
            newDoc.descendants((node, pos) => {
              if (node.isText && node.marks.some((m) => m.type === highlightType)) {
                tr.removeMark(pos, pos + node.nodeSize, highlightType);
              }
            });
          }
          return true;
        })
        .run();
    },
    [editor],
  );

  const resolveThread = useCallback(
    (threadId: string) => {
      const raw = threadsMapRef.current.get(threadId);
      if (!raw) return;
      const thread: ThreadData = JSON.parse(raw);

      if (!thread.resolved) {
        // Resolving: remove inline markup, mark resolved
        removeInlineComment(thread);
        thread.resolved = true;
      } else {
        // Unresolving: just toggle back (markup already removed)
        thread.resolved = false;
      }
      threadsMapRef.current.set(threadId, JSON.stringify(thread));
    },
    [removeInlineComment],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      const raw = threadsMapRef.current.get(threadId);
      if (raw) {
        const thread: ThreadData = JSON.parse(raw);
        removeInlineComment(thread);
      }
      threadsMapRef.current.delete(threadId);
      setActiveThreadId((prev) => (prev === threadId ? null : prev));
    },
    [removeInlineComment],
  );

  return {
    threads,
    activateComment,
    addReply,
    resolveThread,
    deleteThread,
    activeThreadId,
    setActiveThreadId,
    suppressSelectionRef,
  };
}
