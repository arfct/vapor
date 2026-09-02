import { useEffect, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { YjsEditorState } from "~/lib/useYjsEditor";
import type { ThreadData } from "~/shared/types";
import { mergePeople, recordViewer, viewersMap, personKey, type Person, type PresenceUser } from "~/lib/people";

function othersOnline(awareness: Awareness): PresenceUser[] {
  const users: PresenceUser[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const user = (state as { user?: PresenceUser }).user;
    if (user?.name) users.push(user);
  }
  return users;
}

/**
 * Everyone else on this document: connected now (awareness), has
 * commented (threads), or has viewed it (the shared `viewers` map). Also
 * records the local user's own visit, so others see them later; a sign-in
 * mid-visit moves the record from the anonymous id to the principal.
 * `alsoOnline` adds people to treat as connected — the homepage tour uses
 * it so its cast looks present rather than long gone.
 */
export function usePeople(
  yjs: YjsEditorState,
  threads: ThreadData[],
  alsoOnline: PresenceUser[] = [],
): Person[] {
  const { doc, awareness, user } = yjs;
  const [tick, setTick] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const viewers = viewersMap(doc);
    awareness.on("change", bump);
    viewers.observe(bump);
    return () => {
      awareness.off("change", bump);
      viewers.unobserve(bump);
    };
  }, [doc, awareness]);

  const previousKey = useRef<string | null>(null);
  useEffect(() => {
    const key = personKey(user);
    if (previousKey.current && previousKey.current !== key) viewersMap(doc).delete(previousKey.current);
    previousKey.current = key;
    recordViewer(doc, user);
  }, [doc, user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeople(
      mergePeople({
        online: [...othersOnline(awareness), ...alsoOnline],
        viewers: new Map(viewersMap(doc).entries()),
        threads,
        self: user,
      }),
    );
  }, [doc, awareness, user, threads, alsoOnline, tick]);

  return people;
}
