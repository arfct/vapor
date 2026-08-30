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
  | "thread_not_found";

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
export const RESERVED_SLUGS = [
  "new",
  "mcp",
  "agents",
  "api",
  "assets",
  "demo",
  "favicon.ico",
  "robots.txt",
];
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
