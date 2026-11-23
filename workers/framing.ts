// Who may frame vapor's pages, and what that costs the cookies (#121,
// docs/plans/2026-11-21-embed-context-plan.md). Pure: no `cloudflare:`
// imports, so the unit tests exercise it directly.
//
// An instance names its embedding hosts in EMBED_HOSTS. Its HTML then says
// `frame-ancestors 'self' <hosts>`, and the session cookie becomes
// SameSite=None over https, since a framed page is a third-party context.
// Lax had been the defense against a cross-site form posting with the
// person's session, so a write that arrives cross-site loses its session
// cookie here instead (crossSiteWrite, withoutSessionCookie). Unset, nothing
// about framing or the cookie changes.

import { frameAncestors } from "../app/shared/embed-hosts";
import { SESSION_COOKIE } from "../app/lib/auth.server";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A write a browser sent from another site: Sec-Fetch-Site says cross-site
 * or same-site, or, without it, an Origin other than the request's own. A
 * framed vapor page's own requests are same-origin, so they pass. Requests
 * with neither header (MCP clients, agents, servers, tests) pass.
 */
export function crossSiteWrite(request: Request): boolean {
  if (SAFE.has(request.method.toUpperCase())) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

/** The cookies that act for the person: the session and its upgrade marker. */
const AMBIENT = new Set([SESSION_COOKIE, `${SESSION_COOKIE}_none`]);

/** The request without its session cookie; any other cookie stays. */
export function withoutSessionCookie(request: Request): Request {
  const header = request.headers.get("cookie");
  if (!header) return request;
  const parts = header.split(/;\s*/).filter(Boolean);
  const kept = parts.filter((part) => !AMBIENT.has(part.slice(0, Math.max(0, part.indexOf("=")))));
  if (kept.length === parts.length) return request;
  const headers = new Headers(request.headers);
  if (kept.length) headers.set("cookie", kept.join("; "));
  else headers.delete("cookie");
  return new Request(request, { headers });
}

/** A cross-site write goes on signed out; everything else is untouched. */
export function guardCrossSiteWrite(request: Request): Request {
  return crossSiteWrite(request) ? withoutSessionCookie(request) : request;
}

/** Marks a session cookie already re-set as SameSite=None, so the upgrade runs once. */
export const SESSION_UPGRADED = `${SESSION_COOKIE}_none`;

/**
 * SameSite for the session cookie: None (with Secure) over https when the
 * instance names embedding hosts, so a framed page is signed in; Lax
 * otherwise, and always on plain http, where None is refused without Secure.
 */
export function sessionSameSite(secure: boolean, framed: boolean): "None" | "Lax" {
  return secure && framed ? "None" : "Lax";
}

function cookies(request: Request): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out.set(part.slice(0, i), part.slice(i + 1));
  }
  return out;
}

/**
 * A session cookie set before an instance named its hosts is Lax, and a
 * framed page never sees it. A first-party page load re-sets it as
 * SameSite=None, once, marked by a second cookie so later loads leave it
 * alone. The JWT's own `exp` still ends the session; the cookie's lifetime
 * only bounds when it is sent. Null when there is nothing to do.
 */
export function sessionUpgrade(request: Request, maxAgeSeconds: number, framed: boolean): string[] | null {
  if (!framed) return null;
  const url = new URL(request.url);
  if (url.protocol !== "https:" || request.method !== "GET") return null;
  if (request.headers.get("sec-fetch-dest") !== "document") return null;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return null;
  const jar = cookies(request);
  const value = jar.get(SESSION_COOKIE);
  if (!value || jar.has(SESSION_UPGRADED)) return null;
  return [
    `${SESSION_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=None; Secure`,
    upgradeMarkerCookie(maxAgeSeconds),
  ];
}

/** The marker that says the session cookie is already SameSite=None. */
export function upgradeMarkerCookie(maxAgeSeconds: number): string {
  return `${SESSION_UPGRADED}=1; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=None; Secure`;
}

function isHtml(response: Response): boolean {
  return /^text\/html\b/i.test(response.headers.get("content-type") ?? "");
}

/**
 * An HTML response as this instance frames it: `frame-ancestors 'self'
 * <hosts>` when hosts are named and the response has no CSP of its own (an
 * attachment's sandbox CSP, the consent page's `'none'` win), and any
 * session upgrade cookies. WebSocket upgrades and non-HTML pass untouched.
 */
export function framedResponse(response: Response, hosts: readonly string[], setCookies: string[] | null = null): Response {
  if (response.status === 101 || response.webSocket || !isHtml(response)) return response;
  const directive = frameAncestors(hosts);
  const addCsp = directive !== null && !response.headers.has("content-security-policy");
  if (!addCsp && !setCookies?.length) return response;
  const out = new Response(response.body, response);
  if (addCsp) out.headers.set("Content-Security-Policy", directive);
  for (const cookie of setCookies ?? []) out.headers.append("Set-Cookie", cookie);
  return out;
}

/** The consent page is the one page where a click grants something; it is never framed. */
export const NEVER_FRAMED = "frame-ancestors 'none'";
