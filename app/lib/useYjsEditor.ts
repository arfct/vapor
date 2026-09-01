import { useMemo } from "react";
import { useLocalDoc, type LocalDoc } from "./useLocalDoc";
import { useRemoteSync, type RemoteSync } from "./useRemoteSync";

/** What DocumentProvider and the editor consume: a local doc plus its connection state. */
export type YjsEditorState = LocalDoc & RemoteSync;

/** A document synced with its DocumentAgent: the local doc composed with the wire. */
export function useYjsEditor(docId: string): YjsEditorState {
  const local = useLocalDoc();
  const remote = useRemoteSync(local.doc, local.awareness, docId);
  return useMemo(() => ({ ...local, ...remote }), [local, remote]);
}

/** A document that never connects: synced by definition, never asleep. */
export function useStandaloneDoc(): YjsEditorState {
  const local = useLocalDoc();
  return useMemo(() => ({ ...local, socket: null, synced: true, asleep: false }), [local]);
}
