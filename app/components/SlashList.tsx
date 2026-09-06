import { forwardRef } from "react";
import Icon from "~/components/Icon";
import SuggestionList, { type SuggestionListHandle } from "~/components/SuggestionList";
import type { PopupProps } from "~/lib/suggestion-popup";
import type { SlashRow } from "~/lib/slash-commands";

function renderItem(item: SlashRow) {
  return (
    <span className={`flex min-w-0 flex-1 items-center gap-2 ${item.disabled ? "opacity-50" : ""}`}>
      <Icon name={item.icon} className="text-[20px]" />
      <span className="truncate">{item.title}</span>
    </span>
  );
}

/** The `/` popup: grouped when browsing, flat once a query narrows it. */
const SlashList = forwardRef<SuggestionListHandle, PopupProps<SlashRow>>(function SlashList(
  { items, command, query },
  ref,
) {
  return (
    <SuggestionList
      ref={ref}
      items={items}
      command={command}
      renderItem={renderItem}
      groupOf={query ? undefined : (item) => item.group}
      label="Insert"
    />
  );
});

export default SlashList;
