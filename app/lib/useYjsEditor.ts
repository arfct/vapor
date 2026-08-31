import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useAgent } from "agents/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { YjsProvider } from "./yjs-provider";
import { useIdleSleep } from "./useIdleSleep";
import { USER_COLOURS } from "~/shared/constants";
import { getAnonIdentity, retireAnonId } from "./anon-identity";
import { useSession } from "./useSession";
import { reattributeThreads } from "./thread-reattribution";
import type { UserInfo, DocMode } from "~/shared/types";

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

  // Sleeping tabs: an idle or hidden tab disconnects so it stops pinning
  // the document's Durable Object; waking reconnects and resyncs. The
  // socket is a PartySocket — close() stops its auto-reconnect, and
  // reconnect() re-opens through the same object, so the provider's
  // persistent listeners carry across the nap.
  const asleep = useIdleSleep();
  useEffect(() => {
    if (!socket) return;
    const ps = socket as unknown as {
      close: () => void;
      reconnect: () => void;
      readyState: number;
    };
    if (asleep) {
      ps.close();
    } else if (
      ps.readyState === WebSocket.CLOSED ||
      ps.readyState === WebSocket.CLOSING
    ) {
      ps.reconnect();
    }
  }, [asleep, socket]);

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

  return { doc, awareness, socket, synced, asleep, user, mode, setMode, docState, isOnboarding };
}
