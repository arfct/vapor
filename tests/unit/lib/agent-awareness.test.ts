import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as decoding from "lib0/decoding";
import { encodeAgentAwareness, agentClientId } from "~/lib/agent-awareness";

describe("encodeAgentAwareness", () => {
  it("encodes a state the protocol can apply", () => {
    const frame = encodeAgentAwareness(12345, 1, {
      user: { name: "scribe", color: "#4DD0E1", isAgent: true },
    });
    const dec = decoding.createDecoder(frame);
    expect(decoding.readVarUint(dec)).toBe(1); // MSG_AWARENESS
    const aw = new awarenessProtocol.Awareness(new Y.Doc());
    awarenessProtocol.applyAwarenessUpdate(aw, decoding.readVarUint8Array(dec), "test");
    expect(aw.getStates().get(12345)).toMatchObject({
      user: { name: "scribe", isAgent: true },
    });
  });

  it("round-trips a null state as presence removal", () => {
    const doc = new Y.Doc();
    const aw = new awarenessProtocol.Awareness(doc);

    // First establish a present state at clock 1.
    const present = encodeAgentAwareness(999, 1, {
      user: { name: "scribe", color: "#4DD0E1", isAgent: true },
    });
    let dec = decoding.createDecoder(present);
    decoding.readVarUint(dec);
    awarenessProtocol.applyAwarenessUpdate(aw, decoding.readVarUint8Array(dec), "test");
    expect(aw.getStates().has(999)).toBe(true);

    // A higher-clock null frame removes it.
    const removed = encodeAgentAwareness(999, 2, null);
    dec = decoding.createDecoder(removed);
    decoding.readVarUint(dec);
    awarenessProtocol.applyAwarenessUpdate(aw, decoding.readVarUint8Array(dec), "test");
    expect(aw.getStates().has(999)).toBe(false);
  });

  it("round-trips a cursor field shaped for y-tiptap's cursor plugin", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("t");
    ytext.insert(0, "hello");
    const relPos = Y.createRelativePositionFromTypeIndex(ytext, 2);
    const posJson = Y.relativePositionToJSON(relPos);

    const aw = new awarenessProtocol.Awareness(new Y.Doc());
    const frame = encodeAgentAwareness(42, 1, {
      user: { name: "scribe", color: "#4DD0E1", isAgent: true },
      cursor: { anchor: posJson, head: posJson },
    });
    const dec = decoding.createDecoder(frame);
    decoding.readVarUint(dec);
    awarenessProtocol.applyAwarenessUpdate(aw, decoding.readVarUint8Array(dec), "test");

    const state = aw.getStates().get(42) as { cursor: { anchor: unknown; head: unknown } };
    expect(() => Y.createRelativePositionFromJSON(state.cursor.anchor as never)).not.toThrow();
  });
});

describe("agentClientId", () => {
  it("is stable for the same name", () => {
    expect(agentClientId("scribe")).toBe(agentClientId("scribe"));
  });

  it("differs across distinct names (no trivial collision)", () => {
    expect(agentClientId("scribe")).not.toBe(agentClientId("editor-bot"));
  });

  it("is always a non-zero positive integer", () => {
    for (const name of ["a", "scribe", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "0"]) {
      const id = agentClientId(name);
      expect(id).toBeGreaterThan(0);
      expect(Number.isInteger(id)).toBe(true);
    }
  });
});
