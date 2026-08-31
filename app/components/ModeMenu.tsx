import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useDocument } from "~/lib/DocumentContext";
import { hasSuggestionMarkup, processAllRanges } from "~/lib/suggestion-actions";
import Icon from "~/components/Icon";

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * Header menu for the editing mode. Edit and Suggest switch modes, Preview
 * toggles the rendered view; Accept all / Reject all apply to every
 * pending suggestion.
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

  const itemClass =
    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-border data-[disabled]:cursor-default data-[disabled]:text-muted/40";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex h-full cursor-pointer items-center gap-1 px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
          aria-label="Editing mode"
        >
          {showPreview ? "Preview" : mode === "suggest" ? "Suggest" : "Edit"}
          <ChevronDown />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-40 border border-border bg-paper py-1"
          align="end"
          sideOffset={4}
        >
          <DropdownMenu.Item
            onSelect={() => {
              setMode("edit");
              if (showPreview) togglePreview();
            }}
            className={itemClass}
          >
            <Icon name="edit" />
            <span>Edit</span>
            {mode === "edit" && !showPreview && <span className="ml-auto text-muted">{"✓"}</span>}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => {
              setMode("suggest");
              if (showPreview) togglePreview();
            }}
            className={itemClass}
          >
            <Icon name="rate_review" />
            <span>Suggest</span>
            {mode === "suggest" && !showPreview && <span className="ml-auto text-muted">{"✓"}</span>}
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={togglePreview} className={itemClass}>
            <Icon name="visibility" />
            <span>Preview</span>
            {showPreview && <span className="ml-auto text-muted">{"✓"}</span>}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 border-t border-border" />
          <DropdownMenu.Item
            disabled={!hasSuggestions}
            onSelect={() => editor && processAllRanges(editor, true)}
            className={itemClass}
          >
            <Icon name="done_all" />
            <span>Accept all</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!hasSuggestions}
            onSelect={() => editor && processAllRanges(editor, false)}
            className={itemClass}
          >
            <Icon name="remove_done" />
            <span>Reject all</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
