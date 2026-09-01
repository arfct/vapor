import { useEffect, useState, useMemo, useCallback } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { USER_COLOURS } from "~/shared/constants";
import { getAnonIdentity, retireAnonId } from "./anon-identity";
import { useSession } from "./useSession";
import { reattributeThreads } from "./thread-reattribution";
import type { UserInfo, DocMode } from "~/shared/types";

export interface LocalDoc {
  doc: Y.Doc;
  awareness: Awareness;
  user: UserInfo;
  docState: Y.Map<string>;
  mode: DocMode;
  setMode: (mode: DocMode) => void;
}

function anonUserInfo(): UserInfo {
  const anon = getAnonIdentity();
  const c = USER_COLOURS[anon.colorIndex];
  return {
    name: `${anon.adjective} ${anon.animal.name}`,
    color: c.color,
    colorLight: c.light,
    animal: anon.animal.glyph,
    id: anon.id,
  };
}

/**
 * Everything a vapor document needs that exists without a network: the
 * Y.Doc the editor binds to, presence awareness, who the local user is,
 * and the shared `docState` map (mode). No sockets — see useRemoteSync
 * for the wire, and useYjsEditor for the two composed.
 */
export function useLocalDoc(): LocalDoc {
  const doc = useMemo(() => new Y.Doc(), []);
  const awareness = useMemo(() => new Awareness(doc), [doc]);
  const anon = useMemo(() => anonUserInfo(), []);
  const session = useSession();

  // A signed-in viewer presents their real name and avatar; anonymous
  // viewers keep the animal. Derived from the shared session so signing in
  // mid-session updates presence and comment attribution without a reload.
  const user = useMemo<UserInfo>(() => {
    if (session?.signedIn && session.displayName) {
      return {
        ...anon,
        name: session.displayName,
        id: session.principal ?? anon.id,
        animal: undefined,
        avatar: session.avatar ?? undefined,
      };
    }
    return anon;
  }, [session, anon]);

  useEffect(() => {
    awareness.setLocalStateField("user", user);
  }, [awareness, user]);

  // On sign-in, retire this browser's anonymous id and re-attribute the
  // comments it authored in this document to the signed-in identity.
  useEffect(() => {
    if (!session?.signedIn || !anon.id || !user.id || user.id === anon.id) return;
    reattributeThreads(doc, anon.id, user);
    retireAnonId();
  }, [session, user, anon, doc]);

  const docState = useMemo(() => doc.getMap<string>("docState"), [doc]);
  const [mode, setModeState] = useState<DocMode>("edit");

  useEffect(() => {
    const observer = () => {
      const m = docState.get("mode");
      if (m === "edit" || m === "suggest") setModeState(m);
    };
    docState.observe(observer);
    observer();
    return () => docState.unobserve(observer);
  }, [docState]);

  const setMode = useCallback(
    (newMode: DocMode) => {
      docState.set("mode", newMode);
    },
    [docState],
  );

  return useMemo(
    () => ({ doc, awareness, user, docState, mode, setMode }),
    [doc, awareness, user, docState, mode, setMode],
  );
}
