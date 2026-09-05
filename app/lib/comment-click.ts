import { Extension, getMarkRange } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * The comment text (the thread's key) at a document position: the position
 * is inside a comment mark, or inside a highlight whose comment follows it.
 * `nodeAt` rather than the resolved position's marks, so a click exactly on
 * a mark boundary (marks are `inclusive: false`) still resolves.
 */
export function commentTextAtPos(state: EditorState, pos: number): string | null {
  const $pos = state.doc.resolve(pos);
  const node = state.doc.nodeAt(pos);
  const marks = node?.isText ? node.marks : $pos.marks();

  if (marks.some((m) => m.type.name === "criticComment")) return node?.isText ? (node.text ?? "") : null;

  if (marks.some((m) => m.type.name === "criticHighlight")) {
    const highlightType = state.schema.marks.criticHighlight;
    const commentType = state.schema.marks.criticComment;
    if (!highlightType || !commentType) return null;
    const hlRange = getMarkRange($pos, highlightType);
    if (!hlRange) return null;
    const cmRange = getMarkRange(state.doc.resolve(hlRange.to), commentType);
    return cmRange ? state.doc.textBetween(cmRange.from, cmRange.to) : null;
  }

  return null;
}

// Beyond this, a touch was a scroll (or a selection drag), not a tap.
const TAP_SLOP_PX = 10;

function touchPoint(event: TouchEvent): { x: number; y: number } | null {
  const t = event.changedTouches?.[0];
  return t ? { x: t.clientX, y: t.clientY } : null;
}

/**
 * Tapping or clicking a comment (or its highlighted text) opens its thread.
 *
 * With a mouse, ProseMirror's click handling does it. On touch the tap must
 * also NOT focus the editor: iOS commits a tap on editable text as focus +
 * caret + keyboard, which the sheet would then have to fight. WebKit only
 * drops that tap when the page cancels `touchend` (`touchstart` is a passive
 * listener in ProseMirror, and cancelling `pointerdown` isn't honoured), so
 * the thread opens from `touchend` directly and the browser click never
 * happens. Cancelling `pointerdown` still helps on browsers that honour it.
 *
 * The callback lives in extension storage, set through a command, rather
 * than in options: options are read once when the editor is created, and
 * the component's handler changes as threads load.
 */
type CommentClickCallback = (commentText: string) => void;

export interface CommentClickStorage {
  /** Read at event time, so the component can swap it as its threads change. */
  onCommentClick: CommentClickCallback | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentClickHandler: {
      /** Replace the callback a tap or click on a comment invokes. */
      setCommentClickHandler: (callback: CommentClickCallback | null) => ReturnType;
    };
  }
}

export const CommentClickHandler = Extension.create<
  { onCommentClick?: (commentText: string) => void },
  CommentClickStorage
>({
  name: "commentClickHandler",
  addOptions() {
    return { onCommentClick: undefined };
  },
  addStorage() {
    return { onCommentClick: this.options.onCommentClick ?? null };
  },
  addCommands() {
    return {
      setCommentClickHandler: (callback) => () => {
        this.storage.onCommentClick = callback;
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    const onCommentClick = (text: string) => storage.onCommentClick?.(text);

    let touchStart: { x: number; y: number } | null = null;

    const commentTextAtTarget = (view: EditorView, target: EventTarget | null): string | null => {
      if (!(target instanceof Node) || !view.dom.contains(target)) return null;
      const pos = view.posAtDOM(target, 0);
      return pos < 0 ? null : commentTextAtPos(view.state, pos);
    };

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            pointerdown(view, event) {
              if (event.pointerType !== "touch") return false;
              const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (hit && commentTextAtPos(view.state, hit.pos)) event.preventDefault();
              return false;
            },
            touchstart(_view, event) {
              touchStart = touchPoint(event);
              return false;
            },
            touchend(view, event) {
              const end = touchPoint(event);
              const moved =
                touchStart && end
                  ? Math.hypot(end.x - touchStart.x, end.y - touchStart.y) > TAP_SLOP_PX
                  : false;
              touchStart = null;
              if (moved) return false;
              const text = commentTextAtTarget(view, event.target);
              if (text === null) return false;
              event.preventDefault();
              onCommentClick(text);
              return true;
            },
          },
          handleClick(view, pos) {
            const text = commentTextAtPos(view.state, pos);
            if (text === null) return false;
            onCommentClick(text);
            return true;
          },
        },
      }),
    ];
  },
});
