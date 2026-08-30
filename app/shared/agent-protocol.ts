export type AgentCapability = "comment" | "suggest" | "write";
export type Pace = "natural" | "fast" | "instant";

export interface AgentRosterEntry {
  name: string;            // slug, unique per doc
  color: string;           // one of USER_COLOURS .color values
  owner: string | null;    // free text this phase
  capabilities: AgentCapability[];
  createdAt: number;
  lastSeenAt: number | null;
}

export interface BlockAnchor {
  index: number;
  hash: string;            // 8 hex chars
}

export interface DocBlock extends BlockAnchor {
  text: string;            // markdown w/ critic delimiters
}

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  snippet?: string;
}

export type AgentErrorCode =
  | "stale_anchor"
  | "capability_denied"
  | "invalid_token"
  | "doc_not_found"
  | "doc_expired"
  | "find_not_matched"
  | "rate_limited"
  | "invalid_name"
  | "thread_not_found"
  /** Markdown the editor's mark model can't represent (CriticMarkup substitution). */
  | "unsupported_markup";

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

/**
 * Root slugs that can never be a document id: documents live at `/:id`, so
 * the root path is one shared namespace with these routes and well-known
 * files. Enforced in two places — generateDocumentId never mints one
 * (app/shared/constants.ts) and the `/:id` loader 404s them outright
 * (app/routes/doc.$id.tsx).
 */
export const RESERVED_SLUGS = [
  "new",
  "mcp",
  "agents",
  "api",
  "assets",
  "demo",
  "favicon.ico",
  "robots.txt",
  ".well-known",
];

/** Whether a root slug is reserved (case-insensitive — URLs aren't). */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug.toLowerCase());
}

/**
 * The most agents one document's roster can hold. A document is a shared,
 * unauthenticated URL, so the roster needs a ceiling: without one, anyone who
 * can reach the invite endpoint can grow it without bound.
 */
export const MAX_AGENTS_PER_DOC = 16;
export const DEFAULT_CAPABILITIES: AgentCapability[] = ["suggest", "comment"];
export const RATE_LIMIT_MUTATIONS_PER_MIN = 10;
export const RATE_LIMIT_CHARS_PER_HOUR = 20_000;

export function blockHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function formatAnchor(a: BlockAnchor): string {
  return `b${a.index}-${a.hash}`;
}

export function parseAnchor(s: string): BlockAnchor | null {
  const m = /^b(\d+)-([0-9a-f]{8})$/.exec(s);
  return m ? { index: Number(m[1]), hash: m[2] } : null;
}

/**
 * Turns an arbitrary string (an MCP client's `clientInfo.name`, typically)
 * into a valid agent name: lowercased, non-slug characters collapsed to a
 * single hyphen, leading/trailing hyphens trimmed, clamped to the 32-char
 * limit `AGENT_NAME_RE` allows. Falls back to `"agent"` when nothing usable
 * survives (empty input, symbols only, a single character).
 */
export function slugifyAgentName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return AGENT_NAME_RE.test(slug) ? slug : "agent";
}

export function findMentions(
  text: string,
  rosterNames: string[]
): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(
    /(?:^|[^a-z0-9@.])@([a-z0-9][a-z0-9-]{0,30}[a-z0-9])/g
  )) {
    if (rosterNames.includes(m[1])) found.add(m[1]);
  }
  return [...found];
}
