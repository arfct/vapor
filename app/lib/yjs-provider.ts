import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS } from "~/shared/constants";

export class YjsProvider {
  private doc: Y.Doc;
  private awareness: awarenessProtocol.Awareness;
  private ws: WebSocket;
  private synced = false;
  private onSyncedChange: ((synced: boolean) => void) | null = null;

  private boundOnMessage: (event: MessageEvent) => void;
  private boundOnDocUpdate: (update: Uint8Array, origin: unknown) => void;
  private boundOnAwarenessChange: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: string | null,
  ) => void;
  private boundOnClose: () => void;
  private boundOnOpen: () => void;

  constructor(ws: WebSocket, doc: Y.Doc, awareness: awarenessProtocol.Awareness, onSyncedChange?: (synced: boolean) => void) {
    this.ws = ws;
    this.doc = doc;
    this.awareness = awareness;
    this.onSyncedChange = onSyncedChange ?? null;

    this.boundOnMessage = this.onMessage.bind(this);
    this.boundOnDocUpdate = this.onDocUpdate.bind(this);
    this.boundOnAwarenessChange = this.onAwarenessChange.bind(this);
    this.boundOnClose = this.onClose.bind(this);
    this.boundOnOpen = this.sendSyncStep1.bind(this);

    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("message", this.boundOnMessage);
    this.ws.addEventListener("close", this.boundOnClose);
    // Persistent (not once): the socket is a PartySocket that survives
    // reconnects — every re-open needs a fresh sync handshake and awareness
    // broadcast, e.g. when a sleeping tab wakes.
    this.ws.addEventListener("open", this.boundOnOpen);
    this.doc.on("update", this.boundOnDocUpdate);
    this.awareness.on("update", this.boundOnAwarenessChange);

    if (this.ws.readyState === WebSocket.OPEN) {
      this.sendSyncStep1();
    }
  }

  get isSynced(): boolean {
    return this.synced;
  }

  private sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));

    // Also broadcast local awareness state
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
      this.doc.clientID,
    ]);
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(awarenessEncoder, awarenessUpdate);
    this.send(encoding.toUint8Array(awarenessEncoder));
  }

  private onMessage(event: MessageEvent): void {
    const data =
      event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
    if (!(data instanceof Uint8Array)) return;

    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        const syncMessageType = syncProtocol.readSyncMessage(
          decoder,
          encoder,
          this.doc,
          this,
        );
        if (syncMessageType === 1 && !this.synced) {
          this.synced = true;
          this.onSyncedChange?.(true);
        }
        if (encoding.length(encoder) > 1) {
          this.send(encoding.toUint8Array(encoder));
        }
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
        break;
      }
    }
  }

  private onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === this) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  private onAwarenessChange(
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void {
    if (origin === this) return;
    const changedClients = changes.added.concat(changes.updated).concat(changes.removed);
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  private onClose(): void {
    if (this.synced) {
      this.synced = false;
      this.onSyncedChange?.(false);
    }
  }

  private send(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  destroy(): void {
    this.ws.removeEventListener("message", this.boundOnMessage);
    this.ws.removeEventListener("close", this.boundOnClose);
    this.ws.removeEventListener("open", this.boundOnOpen);
    this.doc.off("update", this.boundOnDocUpdate);
    this.awareness.off("update", this.boundOnAwarenessChange);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], null);
  }
}
