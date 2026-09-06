import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from "react";

/** What the suggestion plugin drives through `ReactRenderer.ref`. */
export interface SuggestionListHandle {
  /** Returns true when the key was consumed (the editor must not see it). */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface SuggestionListProps<I> {
  items: I[];
  command: (item: I) => void;
  renderItem: (item: I, selected: boolean) => ReactNode;
  /** Optional group label per item; a header renders whenever it changes. */
  groupOf?: (item: I) => string | undefined;
  /** Shown when there are no items. Nothing renders when omitted. */
  empty?: ReactNode;
  /** A11y label for the listbox. */
  label: string;
}

function SuggestionListInner<I>(
  { items, command, renderItem, groupOf, empty, label }: SuggestionListProps<I>,
  ref: React.ForwardedRef<SuggestionListHandle>,
) {
  const [selected, setSelected] = useState(0);

  // A new item set starts at the top; the plugin re-renders on every keystroke.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(0);
  }, [items]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(event) {
        if (items.length === 0) return false;
        if (event.key === "ArrowDown") {
          setSelected((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelected((i) => (i - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[selected];
          if (item !== undefined) command(item);
          return true;
        }
        return false;
      },
    }),
    [items, selected, command],
  );

  if (items.length === 0) {
    if (!empty) return null;
    return (
      <div className="suggestion-popup px-3 py-2 text-sm text-muted" role="status">
        {empty}
      </div>
    );
  }

  return (
    <div className="suggestion-popup" role="listbox" aria-label={label}>
      {items.map((item, i) => {
        const group = groupOf?.(item);
        const previous = i > 0 ? groupOf?.(items[i - 1]) : undefined;
        const header = group !== undefined && group !== previous ? group : null;
        const isSelected = i === selected;
        return (
          <div key={i}>
            {header && (
              <div className="px-3 pb-1 pt-2 text-xs uppercase tracking-wider text-muted">{header}</div>
            )}
            <div
              role="option"
              aria-selected={isSelected}
              className={`flex min-h-[36px] cursor-pointer select-none items-center gap-2 px-3 text-sm ${
                isSelected ? "bg-accent text-ink" : ""
              }`}
              onMouseEnter={() => setSelected(i)}
              // mousedown, not click: the editor keeps focus and its selection.
              onMouseDown={(e) => {
                e.preventDefault();
                command(item);
              }}
            >
              {renderItem(item, isSelected)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The shared completion popup: arrow keys move, Enter or Tab picks, the
 * mouse hovers and picks. Escape is the plugin's business (it closes the
 * suggestion), so it is not handled here. Styling lives in `.suggestion-popup`.
 */
const SuggestionList = forwardRef(SuggestionListInner) as <I>(
  props: SuggestionListProps<I> & { ref?: React.Ref<SuggestionListHandle> },
) => ReactNode;

export default SuggestionList;
