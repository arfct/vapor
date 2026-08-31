import { useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { hasSuggestionMarkup, processAllRanges } from "~/lib/suggestion-actions";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "~/components/ui/menu";
import Icon from "~/components/Icon";

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * Header menu for the editing mode. Edit and Suggest switch modes, Markdown
 * toggles the source view; Accept all / Reject all apply to every pending
 * suggestion.
 */
export default function ModeMenu() {
  const { editorInstance: editor, mode, setMode, showPreview, togglePreview } = useDocument();
  const [hasSuggestions, setHasSuggestions] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const update = () => setHasSuggestions(hasSuggestionMarkup(editor));
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);

  const itemClass = "gap-2";

  return (
    <Menu>
      <MenuTrigger>
        <button
          className="flex h-full cursor-pointer items-center gap-1 px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
          aria-label="Editing mode"
        >
          {showPreview ? "Markdown" : mode === "suggest" ? "Suggest" : "Edit"}
          <ChevronDown />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem
          className={itemClass}
          onClick={() => {
            setMode("edit");
            if (showPreview) togglePreview();
          }}
        >
          <Icon name="edit" />
          <span>Edit</span>
          {mode === "edit" && !showPreview && <span className="ml-auto pl-3 text-muted">{"✓"}</span>}
        </MenuItem>
        <MenuItem
          className={itemClass}
          onClick={() => {
            setMode("suggest");
            if (showPreview) togglePreview();
          }}
        >
          <Icon name="rate_review" />
          <span>Suggest</span>
          {mode === "suggest" && !showPreview && <span className="ml-auto pl-3 text-muted">{"✓"}</span>}
        </MenuItem>
        <MenuItem className={itemClass} onClick={togglePreview}>
          <Icon name="visibility" />
          <span>Markdown</span>
          {showPreview && <span className="ml-auto pl-3 text-muted">{"✓"}</span>}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          className={itemClass}
          disabled={!hasSuggestions}
          onClick={() => editor && processAllRanges(editor, true)}
        >
          <Icon name="done_all" />
          <span>Accept all</span>
        </MenuItem>
        <MenuItem
          className={itemClass}
          disabled={!hasSuggestions}
          onClick={() => editor && processAllRanges(editor, false)}
        >
          <Icon name="remove_done" />
          <span>Reject all</span>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
