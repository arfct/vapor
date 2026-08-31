/**
 * Session and Google identity verification: dependency-free, WebCrypto-only.
 *
 * Ported from subpixel server/auth.ts. Adapted for vapor:
 * - Session cookie renamed sp_session -> vp_session.
 * - Playdate device-pairing code dropped entirely (not part of vapor).
 * - `verifyGoogleIdToken` takes an injectable `fetchJwks` so tests can hand
 *   it a fixture keypair instead of hitting Google's network endpoint.
 * - `principalFromEmail` returns a bare string (no null path) per this
 *   phase's interface contract; callers own email validation upstream.
 *
 * Importable by both workers/ and React Router server code — must not
 * import from agents/ (see docs/plans/2026-08-30-identity-plan.md, Global
 * Constraints).
 */
import type { AgentCapability } from "~/shared/agent-protocol";

export interface SessionClaims {
  principal: string;
  email: string;
  caps?: AgentCapability[];
  iat: number;
  exp: number;
}

export const SESSION_COOKIE = "vp_session";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function bytesToBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJwtPart(value: string): unknown {
  return JSON.parse(decoder.decode(base64UrlToBytes(value)));
}

function jsonPart(value: unknown): string {
  return stringToBase64Url(JSON.stringify(value));
}

async function hmacKey(secretValue: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secretValue),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signSession(data: string, secretValue: string): Promise<string> {
  const key = await hmacKey(secretValue);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return bytesToBase64Url(new Uint8Array(signature));
}

/** "email:" + lowercased address. Vapor's identity principal. */
export function principalFromEmail(email: string): string {
  return `email:${email.toLowerCase()}`;
}

export async function mintSessionToken(
  claims: Omit<SessionClaims, "iat" | "exp">,
  secret: string,
  ttlSeconds: number = DEFAULT_SESSION_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionClaims = { ...claims, iat: now, exp: now + ttlSeconds };
  const data = `${jsonPart({ alg: "HS256", typ: "JWT" })}.${jsonPart(payload)}`;
  return `${data}.${await signSession(data, secret)}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionClaims | null> {
  if (token.length === 0 || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header: unknown;
  let payload: unknown;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    return null;
  }
  if (!isRecord(header) || header.alg !== "HS256") return null;

  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = base64UrlToBytes(parts[2]);
  } catch {
    return null;
  }
  const data = `${parts[0]}.${parts[1]}`;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(data));
  if (!ok) return null;

  if (!isRecord(payload)) return null;
  const { principal, email, iat, exp, caps } = payload;
  if (typeof principal !== "string" || typeof email !== "string") return null;
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null;

  const now = Math.floor(Date.now() / 1000);
  if ((exp as number) <= now) return null;
  if ((iat as number) > now + 60) return null;
  if (caps !== undefined && !Array.isArray(caps)) return null;

  return {
    principal,
    email,
    iat: iat as number,
    exp: exp as number,
    ...(caps !== undefined ? { caps: caps as AgentCapability[] } : {}),
  };
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return rawValue.join("=");
  }
  return null;
}

/** One session helper, both doors: browser cookie or Authorization bearer. */
export async function sessionFromRequest(request: Request, secret: string): Promise<SessionClaims | null> {
  const token =
    cookieValue(request, SESSION_COOKIE) ??
    request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ??
    null;
  return token ? verifySessionToken(token, secret) : null;
}

export function sessionCookieHeader(token: string, maxAge: number, secure: boolean): string {
  const secureFlag = secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  return sessionCookieHeader("", 0, secure);
}

/** Same-origin guard on credential-posting endpoints (/auth/google, consent). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

type GoogleJwk = JsonWebKey & { kid?: string };
type FetchJwks = (url: string) => Promise<GoogleJwk[]>;

async function defaultFetchJwks(url: string): Promise<GoogleJwk[]> {
  const cache = typeof caches !== "undefined" ? (caches as CacheStorage & { default: Cache }).default : undefined;
  const request = new Request(url);
  const cached = await cache?.match(request);
  if (cached) {
    const data = (await cached.json()) as { keys?: GoogleJwk[] };
    return data.keys ?? [];
  }
  const response = await fetch(request);
  if (!response.ok) throw new Error("google jwks fetch failed");
  await cache?.put(request, response.clone());
  const data = (await response.json()) as { keys?: GoogleJwk[] };
  return data.keys ?? [];
}

async function verifyRs256(data: string, signature: Uint8Array<ArrayBuffer>, jwk: GoogleJwk): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, encoder.encode(data));
}

/**
 * Verifies a Google GSI ID token: RS256 signature against Google's JWKS
 * (cached via `caches.default` when available), issuer/audience/expiry, and
 * `email_verified`. `fetchJwks` defaults to a live fetch of Google's cert
 * URL; tests inject a fixture that returns a locally-generated keypair.
 */
export async function verifyGoogleIdToken(
  credential: string,
  clientId: string,
  fetchJwks: FetchJwks = defaultFetchJwks,
): Promise<{ email: string; name: string; picture?: string } | null> {
  if (credential.length === 0 || credential.length > 8192) return null;
  const parts = credential.split(".");
  if (parts.length !== 3) return null;

  let header: unknown;
  let payload: unknown;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    return null;
  }
  if (!isRecord(header) || header.alg !== "RS256" || typeof header.kid !== "string") return null;

  let keys: GoogleJwk[];
  try {
    keys = await fetchJwks(GOOGLE_JWKS_URL);
  } catch {
    return null;
  }
  const key = keys.find((candidate) => candidate.kid === header.kid);
  if (!key) return null;

  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = base64UrlToBytes(parts[2]);
  } catch {
    return null;
  }
  const verified = await verifyRs256(`${parts[0]}.${parts[1]}`, signatureBytes, key);
  if (!verified) return null;

  if (!isRecord(payload)) return null;
  const { iss, aud, exp, email, email_verified: emailVerified, name, picture } = payload;
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com") return null;
  if (aud !== clientId) return null;
  if (!Number.isInteger(exp)) return null;

  const now = Math.floor(Date.now() / 1000);
  if ((exp as number) <= now) return null;
  if (emailVerified !== true || typeof email !== "string") return null;

  const normalizedEmail = email.toLowerCase();
  return {
    email: normalizedEmail,
    name: typeof name === "string" && name.length > 0 ? name : normalizedEmail,
    ...(typeof picture === "string" ? { picture } : {}),
  };
}
