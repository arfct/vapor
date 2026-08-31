import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useAgent } from "agents/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { YjsProvider } from "./yjs-provider";
import { USER_COLOURS } from "~/shared/constants";
import { getAnonIdentity, retireAnonId } from "./anon-identity";
import { useSession } from "./useSession";
import { reattributeThreads } from "./thread-reattribution";
import type { UserInfo, DocMode } from "~/shared/types";

function anonUserInfo(): UserInfo {
  const anon = getAnonIdentity();
  const c = USER_COLOURS[anon.colorIndex];
  return {
    name: `Anonymous ${anon.animal.name}`,
    color: c.color,
    colorLight: c.light,
    animal: anon.animal.glyph,
    id: anon.id,
  };
}

export function useYjsEditor(docId: string) {
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

  // Keep the awareness (presence) user in sync when it changes — e.g. on
  // sign-in — so remote clients see the new name/avatar live.
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
  const providerRef = useRef<YjsProvider | null>(null);
  const [synced, setSynced] = useState(false);
  const [mode, setModeState] = useState<DocMode>("edit");
  const [isOnboarding, setIsOnboarding] = useState(false);

  const socket = useAgent({
    agent: "document-agent",
    name: docId,
  });

  // Observe docState Y.Map for mode and onboarding changes from other clients
  useEffect(() => {
    const observer = () => {
      const m = docState.get("mode");
      if (m === "edit" || m === "suggest") {
        setModeState(m);
      }
      setIsOnboarding(docState.get("onboarding") === "true");
    };
    docState.observe(observer);
    // Read initial value
    observer();
    return () => {
      docState.unobserve(observer);
    };
  }, [docState]);

  const setMode = useCallback(
    (newMode: DocMode) => {
      docState.set("mode", newMode);
    },
    [docState],
  );

  // Bridge socket to Yjs
  useEffect(() => {
    if (!socket) return;

    const ws = socket as unknown as WebSocket;
    const provider = new YjsProvider(ws, doc, awareness, setSynced);
    providerRef.current = provider;

    return () => {
      provider.destroy();
      providerRef.current = null;
      setSynced(false);
    };
  }, [socket, doc, awareness]);

  return { doc, awareness, socket, synced, user, mode, setMode, docState, isOnboarding };
}
