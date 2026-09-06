/**
 * Sealing for stored wake-target secrets: AES-GCM under a key derived from
 * the deployment's SESSION_SECRET with HKDF, so no second Workers secret is
 * needed and a copy of the Registry's storage alone reveals nothing.
 * WebCrypto only, so the same code runs in the Worker and in tests.
 */

const HKDF_INFO = "vapor wake target v1";
const IV_BYTES = 12;

export async function deriveWakeKey(sessionSecret: string): Promise<CryptoKey> {
  if (!sessionSecret) throw new Error("SESSION_SECRET is required to seal wake targets");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(sessionSecret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(HKDF_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** base64(iv ‖ ciphertext). A fresh IV per seal. */
export async function sealSecret(plain: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toBase64(out);
}

/** Null when the blob is malformed or was sealed under another key. */
export async function openSecret(sealed: string, key: CryptoKey): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(sealed);
  } catch {
    return null;
  }
  if (bytes.length <= IV_BYTES) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES) },
      key,
      bytes.slice(IV_BYTES),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
