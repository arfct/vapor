import { useCallback, useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useDocument } from "~/lib/DocumentContext";
import { usePeople } from "~/lib/usePeople";
import { timeAgo } from "~/lib/time-ago";
import type { Person, PresenceUser } from "~/lib/people";
import { parseMentionToken, type AgentRosterEntry } from "~/shared/agent-protocol";
import { isValidDocumentId } from "~/shared/constants";
import Avatar from "~/components/Avatar";
import Icon from "~/components/Icon";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "~/components/ui/menu";

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
 * One face on an opaque paper disc, so overlapping faces don't show
 * through each other. People who aren't connected go grey and half strength.
 */
function Face({ user, away, className }: { user: PresenceUser; away: boolean; className: string }) {
  return (
    // opacity/filter create stacking contexts that would float dimmed faces
    // above the others; give every face one, with the present ones on top.
    <span className={`relative inline-flex rounded-full bg-paper ${away ? "z-0 opacity-50 grayscale" : "z-10"}`}>
      <Avatar
        name={user.name}
        avatar={user.avatar}
        animal={user.animal}
        color={user.color}
        shape={user.isAgent ? "hexagon" : "circle"}
        client={user.agentClient}
        className={className}
      />
    </span>
  );
}

/** A line in the list: a person (present or past) or an enrolled agent. */
interface Row {
  key: string;
  user: PresenceUser;
  away: boolean;
  status: string;
  /** The roster entry when this row is an agent on the document. */
  agent?: AgentRosterEntry;
}

function agentDisplayName(entry: AgentRosterEntry): string {
  return entry.label ?? entry.name;
}

/** The readable part of an agent's mention, `@slug+agent`, never its id. */
function agentHandle(entry: AgentRosterEntry): string {
  const token = parseMentionToken(entry.mention);
  return token ? `@${token.slug}${token.tag ? `+${token.tag}` : ""}` : `@${entry.name}`;
}

/**
 * Who else is on this document: connected people in colour, past
 * commenters and viewers grey and dimmed, at most a few faces with a
 * "+N" for the rest. Opens a list with each person's status. Agents on the
 * document's roster are listed too, present or not, each with a menu to
 * mention or revoke them; this is where agents are managed. Header space is
 * tight on phones, so it shows from md up.
 */
export default function FacePile({ alsoOnline }: { alsoOnline?: PresenceUser[] }) {
  const { yjs, threads, docId, editorInstance } = useDocument();
  const people = usePeople(yjs, threads, alsoOnline);
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const hasRoster = isValidDocumentId(docId);

  const loadRoster = useCallback(() => {
    if (!hasRoster) return;
    fetch(`/${docId}/agents`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRoster(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [docId, hasRoster]);

  useEffect(() => {
    if (open) loadRoster();
  }, [open, loadRoster]);

  const revoke = useCallback(
    async (name: string) => {
      await fetch(`/${docId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "revoke", name }),
      });
      loadRoster();
    },
    [docId, loadRoster],
  );

  const mention = useCallback(
    (entry: AgentRosterEntry) => {
      const token = parseMentionToken(entry.mention);
      const content = token
        ? [{ type: "mention", attrs: { slug: token.slug, tag: token.tag, sid: token.sid } }, { type: "text", text: " " }]
        : `@${entry.name} `;
      editorInstance?.chain().focus().insertContent(content).run();
      setOpen(false);
    },
    [editorInstance],
  );

  if (people.length === 0 && roster.length === 0) return null;

  // Present agents match their roster entry by display name (presence
  // carries the label, the roster the slug); enrolled agents who aren't
  // connected right now are added as away rows.
  const byName = new Map(roster.map((entry) => [agentDisplayName(entry), entry]));
  const rows: Row[] = people.map((person) => ({
    key: person.key,
    user: person.user,
    away: person.status !== "online",
    status: statusLabel(person),
    agent: person.isAgent ? byName.get(person.user.name) : undefined,
  }));
  const present = new Set(rows.filter((r) => r.agent).map((r) => r.agent!.name));
  for (const entry of roster) {
    if (present.has(entry.name)) continue;
    rows.push({
      key: `agent:${entry.name}`,
      user: { name: agentDisplayName(entry), color: entry.color, isAgent: true, agentClient: entry.client ?? undefined },
      away: true,
      status: entry.lastSeenAt ? `Agent · ${timeAgo(entry.lastSeenAt)}` : "Agent",
      agent: entry,
    });
  }

  // Oldest on the left, newest on the right; the newest faces are the
  // ones shown, with the older remainder counted at the left.
  const shown = people.slice(-MAX_FACES);
  const overflow = people.length - shown.length;
  const online = people.filter((p) => p.status === "online").length;
  const label = `${people.length} ${people.length === 1 ? "person" : "people"}, ${online} here now`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <button
            aria-label={label}
            title={label}
            className="hidden h-[48px] cursor-pointer items-center rounded-full px-3 transition-colors data-[popup-open]:bg-ink md:flex [@media(hover:hover)]:hover:bg-border"
          >
            <span className="flex items-center">
              {overflow > 0 && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-border text-xs font-medium text-ink ring-2 ring-paper">
                  +{overflow}
                </span>
              )}
              {shown.map((person, i) => (
                <span key={person.key} className={i === 0 && overflow === 0 ? "" : "-ml-2"}>
                  <Face user={person.user} away={person.status !== "online"} className="h-7 w-7 ring-2 ring-paper" />
                </span>
              ))}
            </span>
          </button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={0} className="z-50">
          <Popover.Popup className="max-h-[60vh] w-80 overflow-y-auto border border-border bg-paper py-1 shadow-md outline-none">
            {rows.map((row) => (
              <div key={row.key} className="flex min-h-[36px] items-center gap-2 pl-3 pr-1 text-sm">
                <Face user={row.user} away={row.away} className="h-6 w-6" />
                <span className="min-w-0 truncate">
                  {row.user.name}
                  {row.agent ? (
                    <span className="font-mono text-xs text-muted"> {agentHandle(row.agent)}</span>
                  ) : (
                    row.user.isAgent && row.user.agentClient && <span className="text-muted"> · {row.user.agentClient}</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 pl-2 text-xs text-muted">{row.status}</span>
                {row.agent ? (
                  <Menu>
                    <MenuTrigger>
                      <button
                        aria-label={`Options for ${row.user.name}`}
                        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-border hover:text-ink data-[popup-open]:text-ink"
                      >
                        <Icon name="more_vert" />
                      </button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      {editorInstance && <MenuItem onClick={() => mention(row.agent!)}>Mention {agentHandle(row.agent)}</MenuItem>}
                      <MenuItem onClick={() => navigator.clipboard?.writeText(`@${row.agent!.mention}`).catch(() => {})}>
                        Copy {agentHandle(row.agent)}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem destructive onClick={() => revoke(row.agent!.name)}>
                        Remove from document
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                ) : (
                  <span className="w-8 shrink-0" />
                )}
              </div>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
