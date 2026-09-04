import { useState, useCallback, useEffect, useRef } from "react";
import { useDocument } from "~/lib/DocumentContext";

export default function CommentInput() {
  const {
    editorInstance: editor,
    commentActive: active,
    handleCommentActiveChange: onActiveChange,
    commentSelection: selection,
    activateComment: onCommentInserted,
  } = useDocument();

  const [comment, setComment] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus synchronously: iOS only raises the keyboard for a focus() that
  // runs inside the tap's own task, so a deferred focus lands silently.
  useEffect(() => {
    if (!active) return;
    // No scroll on focus: the box is placed beside its selection already.
    if (inputRef.current) inputRef.current.focus({ preventScroll: true });
    else requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [active]);

  const handleSubmit = useCallback(() => {
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

    onCommentInserted(comment);
    setComment("");
    onActiveChange(false);
  }, [editor, comment, selection, onCommentInserted, onActiveChange]);

  const handleCancel = useCallback(() => {
    setComment("");
    onActiveChange(false);
  }, [onActiveChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        handleCancel();
      }
    },
    [handleSubmit, handleCancel],
  );

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
      <input
        ref={inputRef}
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={handleKeyDown}
        enterKeyHint="send"
        placeholder="Add a comment..."
        className="w-full border border-border bg-paper px-2 py-1.5 outline-none focus:border-coral"
      />
      <div className="mt-1.5 flex gap-1">
        <button
          onClick={handleSubmit}
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
