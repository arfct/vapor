import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { getMarkRange } from "@tiptap/core";
import { useDocument } from "~/lib/DocumentContext";
import { layoutComments, type LayoutItem } from "~/lib/comment-layout";
import ThreadPanel from "~/components/ThreadPanel";
import CommentInput from "~/components/CommentInput";

const NEW_COMMENT = "__new-comment";
const GAP = 8;
const THREAD_HEIGHT_GUESS = 96;
const INPUT_HEIGHT_GUESS = 150;
const TAIL_SPACE = 24;
/** Cards sit this much above their anchor so the author row, not the card edge, lines up with the text. */
const CARD_OFFSET = 20;

function sameMap(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/**
 * Desktop comments beside the document, in the same page flow so they
 * travel with the text. Each card sits level with its highlight;
 * overlapping cards stack; the selected card (or the new-comment input)
 * is pinned to its anchor and the rest slide around it. Anchors are
 * measured from the editor's DOM relative to the rail element, so
 * scrolling itself costs nothing — only edits and resizes re-measure.
 */
export default function CommentRail({ originRef }: { originRef: RefObject<HTMLElement | null> }) {
  const {
    threads,
    activeThreadId,
    setActiveThreadId,
    addReply,
    resolveThread,
    deleteThread,
    editorInstance: editor,
    commentActive,
    commentHighlight,
    showPreview,
  } = useDocument();

  const [showResolved, setShowResolved] = useState(false);
  const [anchors, setAnchors] = useState<Map<string, number>>(new Map());
  const [heights, setHeights] = useState<Map<string, number>>(new Map());
  const [settled, setSettled] = useState(false);

  const visible = useMemo(
    () => threads.filter((t) => showResolved || !t.resolved || t.id === activeThreadId),
    [threads, showResolved, activeThreadId],
  );
  const resolvedCount = threads.filter((t) => t.resolved).length;

  const measureAnchors = useCallback(() => {
    const container = originRef.current;
    if (!editor || !container || editor.isDestroyed) return;
    const view = editor.view;
    const editorVisible = !showPreview && view.dom.offsetParent !== null;
    // Rail-relative origin: subtracting this from a viewport y gives a
    // position that doesn't change as the page scrolls.
    const origin = container.getBoundingClientRect().top;
    const yAt = (pos: number | undefined): number | null => {
      if (pos === undefined || !editorVisible) return null;
      const clamped = Math.max(0, Math.min(pos, view.state.doc.content.size));
      try {
        return Math.max(0, Math.round(view.coordsAtPos(clamped).top - origin) - CARD_OFFSET);
      } catch {
        return null;
      }
    };
    // A thread's position is its (hidden) comment text; the card should
    // line up with the highlighted phrase just before it when there is one.
    const highlight = editor.schema.marks.criticHighlight;
    const anchorPos = (thread: (typeof threads)[number]): number | undefined => {
      if (thread.position === undefined) return undefined;
      if (highlight && thread.highlightText && thread.position > 0) {
        const $pos = editor.state.doc.resolve(Math.min(thread.position - 1, editor.state.doc.content.size));
        const range = getMarkRange($pos, highlight);
        if (range && range.to === thread.position) return range.from;
      }
      return thread.position;
    };
    const next = new Map<string, number>();
    for (const thread of threads) {
      const y = yAt(anchorPos(thread));
      if (y !== null) next.set(thread.id, y);
    }
    if (commentActive) {
      const y = yAt(commentHighlight?.from ?? editor.state.selection.from);
      if (y !== null) next.set(NEW_COMMENT, y);
    }
    setAnchors((prev) => (sameMap(prev, next) ? prev : next));
  }, [editor, originRef, threads, commentActive, commentHighlight, showPreview]);

  // Synchronous on data changes (a new thread, the comment box opening) so
  // a card never paints at a fallback spot and then jumps; editor events
  // below coalesce through a frame instead.
  useLayoutEffect(() => {
    measureAnchors();
  }, [measureAnchors]);

  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureAnchors);
    };
    schedule();
    editor.on("update", schedule);
    editor.on("selectionUpdate", schedule);
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(editor.view.dom);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("update", schedule);
      editor.off("selectionUpdate", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [editor, measureAnchors]);

  // Cards animate between positions, but not on their first paint.
  useEffect(() => {
    if (settled || anchors.size === 0) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [anchors, settled]);

  // One ResizeObserver watches every card so the layout follows replies
  // opening, text wrapping, or the reply box appearing.
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const observerRef = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let next = prev;
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const id = el.dataset.cardId;
          const height = Math.round(el.offsetHeight);
          if (!id || next.get(id) === height) continue;
          if (next === prev) next = new Map(prev);
          next.set(id, height);
        }
        return next;
      });
    });
    observerRef.current = observer;
    for (const el of cardEls.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);
  const registerCard = useCallback((id: string, el: HTMLDivElement | null) => {
    const previous = cardEls.current.get(id);
    if (previous && previous !== el) observerRef.current?.unobserve(previous);
    if (el) {
      cardEls.current.set(id, el);
      observerRef.current?.observe(el);
    } else {
      cardEls.current.delete(id);
    }
  }, []);

  const items: LayoutItem[] = visible.map((thread) => ({
    id: thread.id,
    anchor: anchors.get(thread.id) ?? Number.NaN,
    height: heights.get(thread.id) ?? THREAD_HEIGHT_GUESS,
  }));
  if (commentActive) {
    items.push({
      id: NEW_COMMENT,
      anchor: anchors.get(NEW_COMMENT) ?? Number.NaN,
      height: heights.get(NEW_COMMENT) ?? INPUT_HEIGHT_GUESS,
    });
  }
  const tops = layoutComments(items, commentActive ? NEW_COMMENT : activeThreadId, GAP);
  const bottom = items.reduce((max, item) => Math.max(max, (tops.get(item.id) ?? 0) + item.height), 0);

  const cardClass = `absolute left-0 right-[12px] ${settled ? "transition-[top] duration-300 ease-out" : ""}`;

  return (
    <div className="relative" style={{ height: bottom + (resolvedCount > 0 ? 60 : TAIL_SPACE) }}>
      {commentActive && (
        <div
          ref={(el) => registerCard(NEW_COMMENT, el)}
          data-card-id={NEW_COMMENT}
          className={`${cardClass} z-10`}
          style={{ top: tops.get(NEW_COMMENT) }}
        >
          <CommentInput />
        </div>
      )}
      {visible.map((thread) => (
        <div
          key={thread.id}
          ref={(el) => registerCard(thread.id, el)}
          data-card-id={thread.id}
          className={`${cardClass} ${thread.id === activeThreadId ? "z-10" : ""}`}
          style={{ top: tops.get(thread.id) }}
        >
          <ThreadPanel
            thread={thread}
            active={activeThreadId === thread.id}
            onSelect={setActiveThreadId}
            onReply={addReply}
            onResolve={resolveThread}
            onDelete={deleteThread}
          />
        </div>
      ))}
      {resolvedCount > 0 && (
        <button
          onClick={() => setShowResolved((v) => !v)}
          className="absolute left-0 cursor-pointer px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-border"
          style={{ top: bottom + GAP }}
        >
          {showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`}
        </button>
      )}
    </div>
  );
}
