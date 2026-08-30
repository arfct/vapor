const TOKEN_PREFIX = "vpr_";
const TOKEN_RANDOM_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generates a new agent token: "vpr_" + 43 base64url chars (32 random bytes). */
export function generateAgentToken(): string {
  const bytes = new Uint8Array(TOKEN_RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  return TOKEN_PREFIX + toBase64Url(bytes);
}

/** Hashes a token to a stable 64-char hex SHA-256 digest for storage/lookup. */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
