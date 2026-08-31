import { useCallback, useState, useEffect } from "react";
import { useDocument } from "~/lib/DocumentContext";
import {
  hasSuggestionMarkup,
  isCursorInSuggestion,
  processRangeAtCursor,
} from "~/lib/suggestion-actions";

export default function SuggestionActions() {
  const { editorInstance: editor, mode } = useDocument();
  const [hasSuggestions, setHasSuggestions] = useState(false);
  const [cursorInRange, setCursorInRange] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const updateSuggestions = () => setHasSuggestions(hasSuggestionMarkup(editor));
    const updateCursor = () => setCursorInRange(isCursorInSuggestion(editor));
    const update = () => {
      updateSuggestions();
      updateCursor();
    };
    update();
    editor.on("update", update);
    editor.on("selectionUpdate", updateCursor);
    return () => {
      editor.off("update", update);
      editor.off("selectionUpdate", updateCursor);
    };
  }, [editor]);

  const handleAcceptAtCursor = useCallback(() => {
    if (!editor) return;
    processRangeAtCursor(editor, true);
  }, [editor]);

  const handleRejectAtCursor = useCallback(() => {
    if (!editor) return;
    processRangeAtCursor(editor, false);
  }, [editor]);

  const isSuggest = mode === "suggest";

  // In edit mode, hide when no suggestions. In suggest mode, always show.
  if (!isSuggest && !hasSuggestions) return null;

  const enabledClass =
    "flex-1 cursor-pointer border border-border px-2 py-1.5 text-sm uppercase tracking-wider text-muted transition-colors hover:bg-border";
  const disabledClass =
    "flex-1 cursor-default border border-border px-2 py-1.5 text-sm uppercase tracking-wider text-muted/40 transition-colors";

  return (
    <div className="flex gap-1 p-3">
      <button
        onClick={handleAcceptAtCursor}
        disabled={!cursorInRange}
        className={cursorInRange ? enabledClass : disabledClass}
      >
        Accept
      </button>
      <button
        onClick={handleRejectAtCursor}
        disabled={!cursorInRange}
        className={cursorInRange ? enabledClass : disabledClass}
      >
        Reject
      </button>
    </div>
  );
}
