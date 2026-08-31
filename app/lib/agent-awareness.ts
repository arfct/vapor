import * as encoding from "lib0/encoding";
import { MSG_AWARENESS } from "~/shared/constants";
import { blockHash } from "~/shared/agent-protocol";

/**
 * Presence state for a synthetic (agent) awareness client. Mirrors the
 * `{ user, cursor }` shape human clients write via
 * `awareness.setLocalStateField`, so `@tiptap/extension-collaboration-caret`
 * (via `@tiptap/y-tiptap`'s `yCursorPlugin`) renders agents the same way it
 * renders humans. `cursor`, when present, must be
 * `{ anchor: Y.RelativePositionJSON, head: Y.RelativePositionJSON }` — see
 * `y-tiptap`'s cursor plugin, which decodes both fields with
 * `Y.createRelativePositionFromJSON`.
 */
export interface AgentPresenceState {
  user: { name: string; color: string; isAgent: true };
  status?: string;
  cursor?: unknown;
}

/**
 * Derives a stable synthetic Yjs awareness clientId from an agent's name.
 * Agents have no real Yjs client of their own (no Y.Doc, no random
 * clientID) — this makes reconnects and repeated join/leave cycles for the
 * same agent name resolve to the same clientId instead of a fresh random
 * one each time. `>>> 1` keeps the result a positive 31-bit int (well clear
 * of sign-bit weirdness); the id is forced non-zero because 0 has no
 * special meaning here but is worth avoiding as a footgun for equality
 * checks against "no client" sentinels.
 */
export function agentClientId(name: string): number {
  const id = parseInt(blockHash(name), 16) >>> 1;
  return id === 0 ? 1 : id;
}

/**
 * Hand-encodes a complete MSG_AWARENESS websocket frame carrying exactly
 * one synthetic client's state. Matches the wire format
 * `y-protocols/awareness`'s `encodeAwarenessUpdate` + the MSG_AWARENESS
 * envelope produce, byte for byte, so any real `Awareness` instance (a
 * browser client) can decode it with `applyAwarenessUpdate` without any
 * special-casing. Pure lib0 encoding only — agents have no `Y.Doc` or
 * `Awareness` instance to encode from, so this can't reuse those helpers
 * directly.
 *
 * Frame: varUint(MSG_AWARENESS), varUint8Array(update)
 * Update (1 entry): varUint(1), varUint(clientId), varUint(clock), varString(JSON state | "null")
 */
export function encodeAgentAwareness(
  clientId: number,
  clock: number,
  state: AgentPresenceState | null,
): Uint8Array {
  const updateEncoder = encoding.createEncoder();
  encoding.writeVarUint(updateEncoder, 1); // one entry
  encoding.writeVarUint(updateEncoder, clientId);
  encoding.writeVarUint(updateEncoder, clock);
  encoding.writeVarString(updateEncoder, JSON.stringify(state));

  const frameEncoder = encoding.createEncoder();
  encoding.writeVarUint(frameEncoder, MSG_AWARENESS);
  encoding.writeVarUint8Array(frameEncoder, encoding.toUint8Array(updateEncoder));
  return encoding.toUint8Array(frameEncoder);
}
