/**
 * Per-instance identity. vapor is meant to be run by anyone, so nothing in
 * the code names a particular host: the origin comes from the request that
 * is being served, and the few things a request can't tell us (who operates
 * the instance, where its source lives) come from optional Worker vars.
 * Everything here has a working default, so a fresh deploy needs none of it.
 *
 *   PUBLIC_ORIGIN   canonical origin, e.g. https://vapor.example. Used where no
 *                   request is in hand (wake-up messages sent from a document,
 *                   the MCP server card's icons) and as the redirect target for
 *                   REDIRECT_HOSTS. Unset: the request's own origin is used.
 *   REDIRECT_HOSTS  comma-separated hostnames to 301 to PUBLIC_ORIGIN
 *                   (www. aliases, spare domains). Unset: no redirects.
 *   OPERATOR_NAME   who runs this instance; shown on /privacy and /terms.
 *   SOURCE_URL      where this instance's code and plugin live. Shown in the
 *                   footer and used to derive the plugin install commands, so
 *                   a fork that ships its own plugin should point this at itself.
 */

export interface SiteConfig {
  /** The origin this instance is served from, no trailing slash. */
  origin: string;
  /** Operator name for the legal pages, or null to leave them generic. */
  operatorName: string | null;
  /** Repository URL: footer link, issue reports, plugin install commands. */
  sourceUrl: string;
}

/** The upstream repository — the default for SOURCE_URL. */
export const UPSTREAM_SOURCE_URL = "https://github.com/arfct/vapor";

/**
 * The subset of the Worker env this module reads. Typed loosely so tests and
 * the client (which never has an env) can call the helpers with a plain object.
 */
export interface SiteEnv {
  PUBLIC_ORIGIN?: string;
  REDIRECT_HOSTS?: string;
  OPERATOR_NAME?: string;
  SOURCE_URL?: string;
}

/**
 * `origin` is interpolated into HTML and markdown that clients copy and
 * paste, and it derives from the client-controlled Host header, so anything
 * that doesn't look like a plain http(s) origin (scheme, host, optional port
 * or IPv6 brackets — no `<`, `>`, quotes, or paths) is rejected.
 */
export const SAFE_ORIGIN_RE = /^https?:\/\/[a-z0-9.:[\]-]+$/i;

export function isSafeOrigin(origin: string): boolean {
  return SAFE_ORIGIN_RE.test(origin);
}

function cleanOrigin(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  return trimmed && isSafeOrigin(trimmed) ? trimmed : null;
}

function cleanUrl(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!/^https?:\/\/[^\s<>"']+$/.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, "");
}

/** PUBLIC_ORIGIN if set and well-formed, else null. */
export function configuredOrigin(env: SiteEnv): string | null {
  return cleanOrigin(env.PUBLIC_ORIGIN);
}

/** REDIRECT_HOSTS as a list of lowercase hostnames (empty when unset). */
export function redirectHosts(env: SiteEnv): string[] {
  return (env.REDIRECT_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The site config for one request. The request's origin wins over
 * PUBLIC_ORIGIN so previews (workers.dev, localhost, a tunnel) describe
 * themselves correctly; a hostile Host header falls back to PUBLIC_ORIGIN,
 * and failing that to a relative-safe placeholder that can't break out of
 * an HTML attribute.
 */
export function siteForRequest(env: SiteEnv, requestOrigin: string): SiteConfig {
  const origin = cleanOrigin(requestOrigin) ?? configuredOrigin(env) ?? "http://localhost";
  return {
    origin,
    operatorName: (env.OPERATOR_NAME ?? "").trim() || null,
    sourceUrl: cleanUrl(env.SOURCE_URL) ?? UPSTREAM_SOURCE_URL,
  };
}

/**
 * The site config when there is no request — code running inside a Durable
 * Object. Falls back to PUBLIC_ORIGIN, then to a placeholder; callers that
 * can know the real origin (a stored record, a request) should prefer it.
 */
export function siteWithoutRequest(env: SiteEnv): SiteConfig {
  return siteForRequest(env, configuredOrigin(env) ?? "");
}

/**
 * `owner/repo` when the source URL is on GitHub, else null. Drives the
 * `claude plugin marketplace add owner/repo` snippet, which only makes
 * sense for a GitHub-hosted marketplace.
 */
export function githubSlug(sourceUrl: string): string | null {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(sourceUrl);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The hostname of an origin, for prose ("open vapor.example/mcp"). */
export function displayHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^https?:\/\//, "");
  }
}
