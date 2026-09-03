import { Popover } from "@base-ui/react/popover";
import { useDocument } from "~/lib/DocumentContext";
import { usePeople } from "~/lib/usePeople";
import { timeAgo } from "~/lib/time-ago";
import type { Person, PresenceUser } from "~/lib/people";
import Avatar from "~/components/Avatar";

const MAX_FACES = 4;

function statusLabel(person: Person): string {
  switch (person.status) {
    case "online":
      return "Here now";
    case "commented":
      return person.at ? `Commented · ${timeAgo(person.at)}` : "Commented";
    case "viewed":
      return person.at ? `Viewed · ${timeAgo(person.at)}` : "Viewed";
  }
}

/**
 * One face. Animal avatars have a translucent tint, so an opaque paper
 * disc sits underneath — otherwise overlapping faces show through each
 * other. People who aren't connected go grey and half strength.
 */
function Face({ person, className }: { person: Person; className: string }) {
  const away = person.status !== "online";
  return (
    <span className={`inline-flex rounded-full bg-paper ${away ? "opacity-50 grayscale" : ""}`}>
      <Avatar
        name={person.user.name}
        avatar={person.user.avatar}
        animal={person.user.animal}
        color={person.user.color}
        className={className}
      />
    </span>
  );
}

/**
 * Who else is on this document: connected people in colour, past
 * commenters and viewers grey and dimmed, at most a few faces with
 * a "+N" for the rest. Opens a list with each person's status. Header
 * space is tight on phones, so it shows from lg up.
 */
export default function FacePile({ alsoOnline }: { alsoOnline?: PresenceUser[] }) {
  const { yjs, threads } = useDocument();
  const people = usePeople(yjs, threads, alsoOnline);
  if (people.length === 0) return null;

  // Oldest on the left, newest on the right; the newest faces are the
  // ones shown, with the older remainder counted at the left.
  const shown = people.slice(-MAX_FACES);
  const overflow = people.length - shown.length;
  const online = people.filter((p) => p.status === "online").length;
  const label = `${people.length} ${people.length === 1 ? "person" : "people"}, ${online} here now`;

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <button
            aria-label={label}
            title={label}
            className="hidden h-full cursor-pointer items-center px-3 transition-colors data-[popup-open]:bg-ink lg:flex [@media(hover:hover)]:hover:bg-border"
          >
            <span className="flex items-center">
              {overflow > 0 && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-border text-xs font-medium text-ink ring-2 ring-paper">
                  +{overflow}
                </span>
              )}
              {shown.map((person, i) => (
                <span key={person.key} className={i === 0 && overflow === 0 ? "" : "-ml-2"}>
                  <Face person={person} className="h-7 w-7 ring-2 ring-paper" />
                </span>
              ))}
            </span>
          </button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={0} collisionPadding={0} className="z-50">
          <Popover.Popup className="max-h-[60vh] w-80 overflow-y-auto border border-border bg-paper py-1 shadow-md outline-none">
            {people.map((person) => (
              <div key={person.key} className="flex min-h-[36px] items-center gap-2 px-3 text-sm">
                <Face person={person} className="h-6 w-6" />
                <span className="min-w-0 truncate">
                  {person.user.name}
                  {person.isAgent && person.user.agentClient && (
                    <span className="text-muted"> · {person.user.agentClient}</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 pl-2 text-xs text-muted">{statusLabel(person)}</span>
              </div>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
