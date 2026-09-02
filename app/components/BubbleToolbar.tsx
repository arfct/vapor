import { BubbleMenu } from "@tiptap/react/menus";
import { getMarkRange, isMarkActive, type Editor as TiptapEditor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { processRangeAtCursor } from "~/lib/suggestion-actions";

type BubbleContext =
  | { kind: "selection" }
  | { kind: "suggestion" }
  | { kind: "annotation" }
  | null;

/**
 * Compute the bubble menu context from editor state.
 * Cached per state object to avoid redundant computation across
 * the three BubbleMenu plugin instances.
 */
const contextCache = new WeakMap<EditorState, BubbleContext>();

function getContext(state: EditorState): BubbleContext {
  const cached = contextCache.get(state);
  if (cached !== undefined) return cached;

  const ctx = detectContext(state);
  contextCache.set(state, ctx);
  return ctx;
}

function detectContext(state: EditorState): BubbleContext {
  const { from, to, empty } = state.selection;

  if (empty) {
    const $from = state.doc.resolve(from);

    for (const markName of ["criticAddition", "criticDeletion"] as const) {
      const mt = state.schema.marks[markName];
      if (mt && getMarkRange($from, mt)) return { kind: "suggestion" };
    }

    for (const markName of ["criticComment", "criticHighlight"] as const) {
      const mt = state.schema.marks[markName];
      if (mt && getMarkRange($from, mt)) return { kind: "annotation" };
    }

    return null;
  }

  if (!state.doc.textBetween(from, to).length) return null;

  if (isMarkActive(state, "criticAddition")) return { kind: "suggestion" };
  if (isMarkActive(state, "criticDeletion")) return { kind: "suggestion" };
  if (isMarkActive(state, "criticComment")) return { kind: "annotation" };
  if (isMarkActive(state, "criticHighlight")) return { kind: "annotation" };

  return { kind: "selection" };
}

/**
 * shouldShow callbacks must be STABLE references (not inline arrows).
 *
 * TipTap's BubbleMenu dispatches updateOptions transactions with the shared
 * meta key 'bubbleMenu'. When multiple BubbleMenu instances exist, ALL of
 * their transactionHandlers receive every updateOptions dispatch, overwriting
 * each other's shouldShow. Stable references prevent the updateOptions effect
 * from firing, avoiding the cross-contamination entirely.
 */
interface ShouldShowProps {
  editor: TiptapEditor;
  element: HTMLElement;
  view: EditorView;
  state: EditorState;
}

// No focus gate: iOS's native selection handles steal focus mid-gesture and
// a `view.hasFocus()` check made the menu flicker or never appear on touch.
// The context checks below (a real selection, a mark under the caret) are
// what decide visibility; `updateDelay` absorbs the handle-drag churn.
function baseChecks(_view: EditorView, _element: HTMLElement, editor: TiptapEditor): boolean {
  return editor.isEditable;
}

const shouldShowSelection = ({ editor, element, view, state }: ShouldShowProps) => {
  if (!baseChecks(view, element, editor)) return false;
  return getContext(state)?.kind === "selection";
};

const shouldShowSuggestion = ({ editor, element, view, state }: ShouldShowProps) => {
  if (!baseChecks(view, element, editor)) return false;
  return getContext(state)?.kind === "suggestion";
};

const shouldShowAnnotation = ({ editor, element, view, state }: ShouldShowProps) => {
  if (!baseChecks(view, element, editor)) return false;
  return getContext(state)?.kind === "annotation";
};

// 44px tall at every width: Accept/Reject sit side by side and a mis-tap
// on track changes is destructive.
const btnClass =
  "min-h-[44px] px-4 text-sm uppercase tracking-wider text-paper transition-colors hover:bg-paper/15 cursor-pointer";

const menuClass = "bubble-menu flex bg-ink shadow-md";

// flip/shift keep the menu on screen when the keyboard or viewport edge
// would otherwise cover it.
const menuOptions = { placement: "bottom" as const, offset: { mainAxis: 8 }, flip: true, shift: true };

const UPDATE_DELAY_MS = 120;

export default function BubbleToolbar({
  editor,
  onNewComment,
  onResolveAtCursor,
  onDeleteAtCursor,
}: {
  editor: TiptapEditor;
  onNewComment: () => void;
  onResolveAtCursor: () => void;
  onDeleteAtCursor: () => void;
}) {
  return (
    <>
      {/* Plain text selection → Comment */}
      <BubbleMenu
        editor={editor}
        pluginKey="bubbleSelection"
        updateDelay={UPDATE_DELAY_MS}
        shouldShow={shouldShowSelection}
        options={menuOptions}
        className={menuClass}
      >
        <button className={btnClass} onClick={onNewComment}>
          Comment
        </button>
      </BubbleMenu>

      {/* Suggestion marks → Accept / Reject */}
      <BubbleMenu
        editor={editor}
        pluginKey="bubbleSuggestion"
        updateDelay={UPDATE_DELAY_MS}
        shouldShow={shouldShowSuggestion}
        options={menuOptions}
        className={menuClass}
      >
        <button
          className={`${btnClass} border-r border-paper/20`}
          onClick={() => processRangeAtCursor(editor, true)}
        >
          Accept
        </button>
        <button className={btnClass} onClick={() => processRangeAtCursor(editor, false)}>
          Reject
        </button>
      </BubbleMenu>

      {/* Annotation marks → Resolve / Delete */}
      <BubbleMenu
        editor={editor}
        pluginKey="bubbleAnnotation"
        updateDelay={UPDATE_DELAY_MS}
        shouldShow={shouldShowAnnotation}
        options={menuOptions}
        className={menuClass}
      >
        <button
          className={`${btnClass} border-r border-paper/20`}
          onClick={onResolveAtCursor}
        >
          Resolve
        </button>
        <button className={btnClass} onClick={onDeleteAtCursor}>
          Delete
        </button>
      </BubbleMenu>
    </>
  );
}
