import { forwardRef } from "react";
import type { MentionItem } from "~/shared/agent-protocol";
import Avatar from "~/components/Avatar";
import Icon from "~/components/Icon";
import SuggestionList, { type SuggestionListHandle } from "~/components/SuggestionList";
import type { PopupProps } from "~/lib/suggestion-popup";

function renderItem(item: MentionItem) {
  return (
    <>
      {item.kind === "email" ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-muted">
          <Icon name="alternate_email" className="text-[18px]" />
        </span>
      ) : item.kind === "agent" ? (
        <Avatar name={item.label} color={item.color} shape="hexagon" client={item.client} className="h-6 w-6" />
      ) : (
        <Avatar name={item.label} avatar={item.avatar} animal={item.animal} color={item.color} className="h-6 w-6" />
      )}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.detail && <span className="min-w-0 max-w-[50%] truncate text-xs text-muted">{item.detail}</span>}
    </>
  );
}

/** The `@` popup: agents, then people, then "Mention <typed address>". */
const MentionList = forwardRef<SuggestionListHandle, PopupProps<MentionItem>>(function MentionList(
  { items, command, query },
  ref,
) {
  return (
    <SuggestionList
      ref={ref}
      items={items}
      command={command}
      renderItem={renderItem}
      label="Mention"
      empty={
        query.length === 0 ? (
          <>
            No one to mention yet. Connect an agent from <span className="text-ink">Share → Invite an agent</span>,
            or type an email address.
          </>
        ) : undefined
      }
    />
  );
});

export default MentionList;
