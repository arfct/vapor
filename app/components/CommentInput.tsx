import { useCallback, useRef } from "react";
import { useDocument } from "~/lib/DocumentContext";
import CommentEditor, { type CommentEditorHandle } from "~/components/CommentEditor";

export default function CommentInput() {
  const {
    editorInstance: editor,
    commentActive: active,
    handleCommentActiveChange: onActiveChange,
    commentSelection: selection,
    activateComment: onCommentInserted,
    mentionSources,
  } = useDocument();
  const editorRef = useRef<CommentEditorHandle>(null);

  const handleSubmit = useCallback((comment: string) => {
    if (!editor || !comment.trim()) return;

    const from = selection ? selection.from : editor.state.selection.from;
    const to = selection ? selection.to : editor.state.selection.from;
    const isEmpty = from === to;

    // Prevent nesting comments inside existing comments
    if (from > 0) {
      const node = editor.state.doc.nodeAt(from - 1);
      if (node?.marks.some((m) => m.type.name === "criticComment")) return;
    }

    const commentType = editor.schema.marks.criticComment;
    const highlightType = editor.schema.marks.criticHighlight;
    if (!commentType || !highlightType) return;

    // Before the marks land: the editor update they cause runs the thread
    // reconcile synchronously, and only the client that knows it authored
    // the comment creates the thread on the spot (#81).
    onCommentInserted(comment);

    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        if (isEmpty) {
          // Insert comment text with criticComment mark at cursor
          tr.insertText(comment, from);
          tr.addMark(from, from + comment.length, commentType.create());
        } else {
          // Apply highlight mark to selection, then insert comment after
          tr.addMark(from, to, highlightType.create());
          tr.insertText(comment, to);
          tr.addMark(to, to + comment.length, commentType.create());
        }
        return true;
      })
      .run();

    onActiveChange(false);
  }, [editor, selection, onCommentInserted, onActiveChange]);

  const handleCancel = useCallback(() => {
    onActiveChange(false);
  }, [onActiveChange]);

  if (!active) return null;

  return (
    <div className="p-3">
      <label className="mb-1 block text-sm uppercase tracking-wider text-muted">
        Comment
      </label>
      {selection && (
        <div className="mb-1.5 truncate rounded-sm bg-border/50 px-2 py-1 text-sm text-muted">
          {selection.text.length > 60
            ? selection.text.slice(0, 60) + "\u2026"
            : selection.text}
        </div>
      )}
      <CommentEditor
        ref={editorRef}
        placeholder="Add a comment..."
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        autoFocus
        mentions={mentionSources}
        className="comment-editor-box w-full border border-border bg-paper px-2 py-1.5 focus-within:border-coral"
      />
      <div className="mt-1.5 flex gap-1">
        <button
          onClick={() => editorRef.current?.submit()}
          className="min-h-[44px] flex-1 cursor-pointer border border-border px-2 py-1 text-sm uppercase tracking-wider text-muted transition-colors hover:bg-border"
        >
          Add
        </button>
        <button
          onClick={handleCancel}
          className="min-h-[44px] flex-1 cursor-pointer border border-border px-2 py-1 text-sm uppercase tracking-wider text-muted transition-colors hover:bg-border"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
