/**
 * Short public ids: eight lowercase alphanumerics, the same shape as a
 * document id. A signed-in person's `uid` is one (minted by the Registry
 * with a uniqueness check), an anonymous browser's id is one (minted
 * locally), and a mention token carries one so that `@nicholas-jitkoff~k3f0a9x2`
 * names exactly one person without naming their address
 * (docs/plans/2026-09-06-agent-identity-plan.md).
 */

export const SHORT_ID_RE = /^[a-z0-9]{8}$/;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomShortId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * The short id an identity key carries. A short id is itself; anything
 * longer (a legacy UUID anonymous id, a principal) reduces to the first
 * eight of its lowercase alphanumerics, so ids stored before short ids
 * existed still mention and match without a migration. Null when the key
 * has fewer than eight usable characters.
 */
export function shortIdOf(id: string | null | undefined): string | null {
  if (!id) return null;
  if (SHORT_ID_RE.test(id)) return id;
  const compact = id.toLowerCase().replace(/^[a-z]+:/, "").replace(/[^a-z0-9]/g, "");
  return compact.length >= 8 ? compact.slice(0, 8) : null;
}

/** FNV-1a, 32-bit, as 8 hex characters. Shared by block hashes and colour choice. */
export function fnv1a32Hex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * A stable colour index for an identity, so a signed-in person and every
 * agent they own draw in the same colour in every document, on every
 * device. `count` is the palette size.
 */
export function colorIndexFor(id: string, count: number): number {
  return parseInt(fnv1a32Hex(id), 16) % count;
}
