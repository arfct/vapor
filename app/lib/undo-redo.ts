import { Extension } from "@tiptap/core";
import { redo, undo, yUndoPluginKey } from "@tiptap/y-tiptap";

/**
 * Undo/redo over the collaboration history, made safe. The Yjs undo plugin
 * remembers the selection to restore from the state *before* the last
 * transaction, so straight after an undo its memory points into content
 * that undo just removed; the next redo then resolves that stale position
 * against the current document and throws out of range. Dispatching one
 * empty transaction first moves the memory onto the current document,
 * after which the library's own undo/redo behave.
 *
 * Registered after Collaboration so these `undo`/`redo` replace its
 * commands; its keyboard shortcuts (⌘Z, ⇧⌘Z, ⌘Y) call the commands by name
 * and so land here, and the Format menu's buttons call them directly.
 */
export const UndoRedo = Extension.create({
  name: "undoRedoSafe",

  addCommands() {
    const run = (which: "undo" | "redo") =>
      () =>
      ({ state, view, dispatch, tr }: { state: import("@tiptap/pm/state").EditorState; view: import("@tiptap/pm/view").EditorView; dispatch?: (tr: import("@tiptap/pm/state").Transaction) => void; tr: import("@tiptap/pm/state").Transaction }) => {
        // The chain must not dispatch `tr`: the history plugin dispatches its own.
        tr.setMeta("preventDispatch", true);
        const undoManager = yUndoPluginKey.getState(state)?.undoManager;
        if (!undoManager) return false;
        const stack = which === "undo" ? undoManager.undoStack : undoManager.redoStack;
        if (stack.length === 0) return false;
        if (!dispatch) return true;
        view.dispatch(view.state.tr);
        return which === "undo" ? undo(view.state) : redo(view.state);
      };
    return { undo: run("undo"), redo: run("redo") };
  },
});
