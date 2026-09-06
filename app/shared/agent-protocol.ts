export type AgentCapability = "comment" | "suggest" | "write";
export type Pace = "natural" | "fast" | "instant";

export interface AgentRosterEntry {
  name: string;            // slug, unique per doc
  /** Display attribution ("<Owner>'s Agent"); null for anonymous agents. */
  label?: string | null;
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
  /** Persistent block id (null only on pre-block-id documents). */
  id: string | null;
  text: string;            // markdown w/ critic delimiters
}

/**
 * A caller's verified identity, as established upstream (session cookie or
 * OAuth bearer token) and passed down to DocumentAgent/VaporMcp — the single
 * source of truth for both MCP endpoints. `kind: "anonymous"` covers tokenless
 * `/mcp/anonymous` callers (DEFAULT_CAPABILITIES, no owner); `kind:
 * "principal"` covers signed-in/OAuth callers (caps from the OAuth grant).
 */
export interface AgentIdentity {
  kind: "principal" | "anonymous";
  id: string; // principal ("email:…") or anonymous session key
  name: string; // roster slug (agentSlug or slugified clientInfo) — used for @mentions
  /** Human-facing attribution, e.g. "Ada Lovelace's Agent". Falls back to name. */
  label?: string;
  /** Display name of the connecting client, e.g. "Claude" — shown next to comment timestamps. */
  client?: string;
  owner: string | null; // principal for kind=principal, null for anonymous
  caps: AgentCapability[];
}

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  snippet?: string;
}

export type AgentErrorCode =
  | "stale_anchor"
  /** Anchor's block id exists but its content hash is out of date. */
  | "stale_block"
  | "capability_denied"
  | "invalid_token"
  | "doc_not_found"
  | "doc_expired"
  | "find_not_matched"
  | "rate_limited"
  | "invalid_name"
  | "thread_not_found"
  /** Markdown the editor's mark model can't represent (CriticMarkup substitution). */
  | "unsupported_markup"
  /** Events polyfill: a referenced event type or subscription doesn't exist (sketch -32011). */
  | "not_found"
  /** Events polyfill: statically invalid arguments — bad URL, bad whsec_ secret, bad cursor (sketch -32602). */
  | "invalid_params";

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
  "skill.md",
  ".well-known",
  "auth",
  "oauth",
  "settings",
  "privacy",
  "terms",
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
/**
 * Human-facing name for an MCP client, from its `clientInfo.name`. Claude's
 * surfaces identify themselves variously ("claude-code", "Claude", …) but
 * are all one product family to a reader; anything else gets its slug
 * title-cased. Undefined when the client sent nothing.
 */
export function clientDisplayName(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const slug = slugifyAgentName(raw);
  if (slug === "agent") return undefined;
  if (slug.includes("claude")) return "Claude";
  return slug
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

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

/**
 * `@slug` tokens that name roster agents. A slug must be whole (not
 * followed by more slug characters) and must not be the local part of an
 * email mention: `@ada@example.com` names the person ada@example.com, never
 * an agent called `ada`. A sentence-ending period after a slug is fine; a
 * period followed by a letter reads as a domain and is not.
 */
export function findMentions(
  text: string,
  rosterNames: string[]
): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(SLUG_MENTION_RE)) {
    if (rosterNames.includes(m[1])) found.add(m[1]);
  }
  return [...found];
}

/** Group 1 is the slug; the match may start one character early (the boundary). */
export const SLUG_MENTION_RE =
  /(?:^|[^a-z0-9@.])@([a-z0-9][a-z0-9-]{0,30}[a-z0-9])(?![a-z0-9@-])(?!\.[a-z0-9])/g;

/**
 * `@local@domain.tld` tokens: a person mentioned by full email address.
 * Case-insensitive, returned lowercased and deduplicated. A bare address
 * without the leading `@` is ordinary text, as it always was.
 */
export function findEmailMentions(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(EMAIL_MENTION_RE)) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

export const EMAIL_MENTION_RE =
  /(?:^|[^a-z0-9@.])@([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?![a-z0-9@.-])/gi;

/** True when a completion query has the shape of an email address. */
export function isEmailQuery(query: string): boolean {
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(query);
}

/**
 * A display name as a mention handle: `Quiet Otter` → `quiet-otter`. Null
 * when nothing slug-like survives. Same shape as an agent slug, so
 * findMentions and the highlight decoration treat both alike.
 */
export function slugifyName(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return AGENT_NAME_RE.test(slug) ? slug : null;
}

/** One row in the `@` completion popup. `handle` is the text inserted after `@`. */
export interface MentionItem {
  kind: "agent" | "person" | "email";
  handle: string;
  /** Primary text: an agent's label or a person's display name. */
  label: string;
  /** Secondary text: the handle for agents, the email for signed-in people. */
  detail?: string;
  color?: string;
  avatar?: string;
  animal?: string;
}

export interface MentionSources {
  agents: Pick<AgentRosterEntry, "name" | "label" | "color">[];
  people: {
    name: string;
    color: string;
    /** `email:<addr>` for signed-in people, an anonymous id otherwise. */
    id?: string;
    avatar?: string;
    animal?: string;
    isAgent?: boolean;
  }[];
}

const EMAIL_PRINCIPAL = /^email:(.+)$/i;

/**
 * Builds the `@` completion list: agents first (mentioning one wakes it),
 * then people. Signed-in people complete to their email; anonymous people
 * to a slug of their name, with `-2`, `-3`… when it collides with an agent
 * or an earlier person. A query shaped like an email adds a final row that
 * inserts the address as typed, so anyone can be addressed.
 */
export function rankMentionItems(query: string, sources: MentionSources, max = 8): MentionItem[] {
  const q = query.trim().toLowerCase();
  const taken = new Set<string>();
  const items: MentionItem[] = [];

  for (const agent of sources.agents) {
    taken.add(agent.name);
    items.push({
      kind: "agent",
      handle: agent.name,
      label: agent.label ?? agent.name,
      detail: `@${agent.name}`,
      color: agent.color,
    });
  }

  for (const person of sources.people) {
    if (person.isAgent) continue;
    const email = person.id ? EMAIL_PRINCIPAL.exec(person.id)?.[1]?.toLowerCase() : undefined;
    let handle: string;
    if (email) {
      handle = email;
    } else {
      const base = slugifyName(person.name);
      if (!base) continue;
      handle = base;
      for (let n = 2; taken.has(handle); n++) handle = `${base}-${n}`;
    }
    if (taken.has(handle)) continue;
    taken.add(handle);
    items.push({
      kind: "person",
      handle,
      label: person.name,
      detail: email ?? `@${handle}`,
      color: person.color,
      avatar: person.avatar,
      animal: person.animal,
    });
  }

  const matches = q
    ? items.filter((item) => mentionMatches(item, q))
    : items;
  const ranked = matches.slice(0, max);

  if (isEmailQuery(q) && !ranked.some((item) => item.handle === q)) {
    ranked.push({ kind: "email", handle: q, label: `Mention ${q}` });
  }
  return ranked;
}

function mentionMatches(item: MentionItem, q: string): boolean {
  if (item.handle.toLowerCase().startsWith(q)) return true;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return true;
  return label.split(/\s+/).some((word) => word.startsWith(q));
}
