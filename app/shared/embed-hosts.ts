/**
 * Embedding hosts: the sites an instance lets frame its pages, and the only
 * ones a framed page tells what is on screen (docs/plans/2026-11-21-embed-context-plan.md).
 *
 * The list comes from the optional EMBED_HOSTS var (app/shared/site.ts) as
 * space-separated CSP host sources. Shared by the Worker, which turns it into
 * `frame-ancestors`, and the client, which matches the framing page against it.
 */

/** A CSP host source this module accepts: scheme, optional `*.`, host, optional `:port` or `:*`. */
const SOURCE_RE = /^(https?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\*|\d{1,5}))?$/;
const ORIGIN_RE = /^(https?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?$/;

/**
 * EMBED_HOSTS as a list of host sources, lowercased. An entry that isn't a
 * plain host source (a path, a quote, a `;` that would end the directive,
 * a keyword like `*` or `'self'`) is dropped, so the var can't inject into
 * the header. Empty when unset.
 */
export function parseEmbedHosts(value: string | undefined | null): string[] {
  const out: string[] = [];
  for (const raw of (value ?? "").split(/\s+/)) {
    const source = raw.trim().toLowerCase().replace(/\/+$/, "");
    if (source && SOURCE_RE.test(source) && !out.includes(source)) out.push(source);
  }
  return out;
}

/** The `frame-ancestors` directive for a host list, or null when there are none (framing is left as it was). */
export function frameAncestors(hosts: readonly string[]): string | null {
  return hosts.length ? ["frame-ancestors", "'self'", ...hosts].join(" ") : null;
}

/**
 * Whether one host source matches an origin, as CSP reads it: `*.` is any
 * subdomain (not the bare domain), `:*` any port, and no port means the
 * scheme's default one.
 */
export function sourceMatches(source: string, origin: string): boolean {
  const s = SOURCE_RE.exec(source.toLowerCase());
  const o = ORIGIN_RE.exec(origin.toLowerCase());
  if (!s || !o) return false;
  const [, scheme, wild, host, port] = s;
  const [, oScheme, oHost, oPort] = o;
  if (scheme !== oScheme) return false;
  if (wild ? !oHost!.endsWith(`.${host}`) : oHost !== host) return false;
  if (port === "*") return true;
  const fallback = scheme === "https" ? "443" : "80";
  return (oPort ?? fallback) === (port ?? fallback);
}

/** Whether an origin is one of the embedding hosts. */
export function isEmbedHost(origin: string | null | undefined, hosts: readonly string[]): boolean {
  return Boolean(origin) && hosts.some((source) => sourceMatches(source, origin!));
}
