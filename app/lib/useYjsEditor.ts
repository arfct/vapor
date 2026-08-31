import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useAgent } from "agents/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { YjsProvider } from "./yjs-provider";
import { USER_COLOURS } from "~/shared/constants";
import { getAnonIdentity } from "./anon-identity";
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
  const [user, setUser] = useState<UserInfo>(anonUserInfo);

  // If the viewer is signed in, present their real name instead of the
  // anonymous animal. Sign-in is optional; anonymous users keep the animal.
  useEffect(() => {
    let cancelled = false;
    fetch("/auth/me")
      .then((r) => r.json())
      .then((raw) => {
        const s = raw as { signedIn?: boolean; displayName?: string; principal?: string };
        if (cancelled || !s.signedIn || !s.displayName) return;
        setUser((prev) => ({
          ...prev,
          name: s.displayName as string,
          id: s.principal ?? prev.id,
          animal: undefined,
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
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
