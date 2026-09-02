import { useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { hasSuggestionMarkup, processAllRanges } from "~/lib/suggestion-actions";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "~/components/ui/menu";
import Icon from "~/components/Icon";

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
          className="header-button"
          aria-label="Editing mode"
          title={showPreview ? "Markdown" : mode === "suggest" ? "Suggest" : "Edit"}
        >
          <Icon name={showPreview ? "visibility" : mode === "suggest" ? "rate_review" : "edit"} />
        </button>
      </MenuTrigger>
      <MenuContent>
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
