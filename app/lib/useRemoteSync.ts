import { useEffect, useRef, useState, useMemo } from "react";
import { useAgent } from "agents/react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { YjsProvider } from "./yjs-provider";
import { useIdleSleep } from "./useIdleSleep";

/** What consumers need from the socket: connection state and its events. */
export type DocSocket = EventTarget & { readyState: number };

export interface RemoteSync {
  socket: DocSocket | null;
  synced: boolean;
  asleep: boolean;
}

/**
 * The wire for a document: the DocumentAgent websocket, the Yjs sync
 * provider bridging it to `doc`, and idle sleep. Knows nothing about the
 * editor or UI — it takes the doc as an argument and only reports
 * connection state. A document that never connects (the homepage) simply
 * doesn't call this.
 */
export function useRemoteSync(doc: Y.Doc, awareness: Awareness, docId: string): RemoteSync {
  const providerRef = useRef<YjsProvider | null>(null);
  const [synced, setSynced] = useState(false);

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

  return useMemo(() => ({ socket, synced, asleep }), [socket, synced, asleep]);
}
