import { fnv1a32Hex, shortIdOf } from "./short-id";
import { agentClient, agentClientFor } from "./agent-clients";

export type AgentCapability = "comment" | "suggest" | "write";
export type Pace = "natural" | "fast" | "instant";

export interface AgentRosterEntry {
  name: string;            // slug, unique per doc
  /** Display attribution ("<Owner>'s Claude"); null for anonymous agents. */
  label?: string | null;
  color: string;           // one of USER_COLOURS .color values
  /** The owner's public short id; null for anonymous agents. Never the principal. */
  ownerUid: string | null;
  /** The connecting client, e.g. "Claude"; null when it didn't say. */
  client: string | null;
  /** The mention token (without `@`), e.g. `nicholas-jitkoff+agent~k3f0a9x2`. */
  mention: string;
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
  owner: string | null; // principal for kind=principal, null for anonymous — server-side only
  /** The owner's public short id and display name, for the roster and the mention token. */
  ownerUid?: string | null;
  ownerName?: string | null;
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
  | "reply_not_found"
  /** Editing or deleting a comment someone else wrote. */
  | "not_author"
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
  return fnv1a32Hex(text);
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
 * Human-facing name for an MCP client, from its `clientInfo.name`. Clients
 * the client table knows get their label ("Claude" for every Claude
 * surface, "LM Studio" for "lmstudio-mcp-server-session"); anything else
 * gets its slug title-cased. Undefined when the client sent nothing.
 */
export function clientDisplayName(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const known = agentClientFor(raw);
  if (known !== "other") return agentClient(known).label;
  const slug = slugifyAgentName(raw);
  if (slug === "agent") return undefined;
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
 * A mention token, as it appears in markdown after the `@`:
 * `slug[+tag]~sid`. The slug is a display-name hint for readers of the raw
 * text; the short id (and, for agents, the tag) is what resolves. The
 * editor shows the name and hides the rest
 * (docs/plans/2026-09-06-agent-identity-plan.md).
 */
export interface MentionToken {
  slug: string;
  /** `agent` for a person's counterpart agent; null for the person. */
  tag: string | null;
  sid: string;
}

export const MENTION_TAG_AGENT = "agent";

/**
 * Group 1 slug, group 2 tag (optional), group 3 short id; the match may
 * start one character early (the boundary). A trailing alphanumeric means
 * the id isn't finished, so it is not a mention yet.
 */
export const MENTION_RE =
  /(?:^|[^a-z0-9@.~+])@([a-z0-9][a-z0-9-]{0,30}[a-z0-9])(?:\+([a-z0-9][a-z0-9-]{0,15}))?~([a-z0-9]{8})(?![a-z0-9~+])/g;

/** One token, no `@`, or null when the text isn't exactly a token. */
export function parseMentionToken(text: string): MentionToken | null {
  const m = /^([a-z0-9][a-z0-9-]{0,30}[a-z0-9])(?:\+([a-z0-9][a-z0-9-]{0,15}))?~([a-z0-9]{8})$/.exec(text);
  return m ? { slug: m[1], tag: m[2] ?? null, sid: m[3] } : null;
}

export function formatMention(token: MentionToken): string {
  return `${token.slug}${token.tag ? `+${token.tag}` : ""}~${token.sid}`;
}

/** What a token resolves by: tag plus short id, slug ignored. */
export function mentionKey(token: Pick<MentionToken, "tag" | "sid">): string {
  return `${token.tag ?? ""}~${token.sid}`;
}

/** Every mention token in a text, in order, duplicates included. */
export function findMentionTokens(text: string): MentionToken[] {
  const out: MentionToken[] = [];
  for (const m of text.matchAll(MENTION_RE)) out.push({ slug: m[1], tag: m[2] ?? null, sid: m[3] });
  return out;
}

/** A person's token: their name as a slug, their short id. Null without a usable id. */
export function personMention(name: string, id: string | null | undefined): string | null {
  const sid = shortIdOf(id);
  const slug = slugifyName(name) ?? "someone";
  return sid ? formatMention({ slug, tag: null, sid }) : null;
}

/** A counterpart agent's token: the owner's name slug, the agent tag, the owner's short id. */
export function agentMention(ownerName: string, ownerUid: string): string {
  const sid = shortIdOf(ownerUid) ?? fnv1a32Hex(ownerUid);
  return formatMention({ slug: slugifyName(ownerName) ?? "agent", tag: MENTION_TAG_AGENT, sid });
}

/**
 * A counterpart agent's display name: the owner's first name, possessive,
 * plus the client it connected from — "Ada's Claude" — or "Ada's Agent"
 * when the client didn't identify itself.
 */
export function counterpartLabel(ownerName: string, client: string | null | undefined): string {
  const firstName = ownerName.trim().split(/\s+/)[0] || "Someone";
  return `${firstName}'s ${client ?? "Agent"}`;
}

/** An anonymous agent's token: its client slug and a short id from its session. */
export function anonymousAgentMention(name: string, sessionId: string): string {
  return formatMention({ slug: name, tag: null, sid: fnv1a32Hex(sessionId) });
}

/** A roster agent as the mention matcher sees it: its internal name and its token. */
export interface MentionTarget {
  name: string;
  mention?: string | null;
}

/**
 * The roster agents a text mentions, by internal name, once each. A token
 * matches an agent whose `mention` has the same tag and short id (the slug
 * is a hint and may be stale). A bare `@slug` still matches an agent by
 * internal name, so mentions written before tokens existed keep working
 * until their documents expire. A slug followed by `@` is never read as an
 * agent: `@ada@example.com` is text about an address, not `@ada`.
 */
export function findMentions(text: string, roster: readonly (string | MentionTarget)[]): string[] {
  const byName = new Map<string, string>();
  const byKey = new Map<string, string>();
  for (const entry of roster) {
    const target = typeof entry === "string" ? { name: entry } : entry;
    byName.set(target.name, target.name);
    const token = target.mention ? parseMentionToken(target.mention) : null;
    if (token) byKey.set(mentionKey(token), target.name);
  }

  const found = new Set<string>();
  for (const token of findMentionTokens(text)) {
    const name = byKey.get(mentionKey(token));
    if (name) found.add(name);
  }
  for (const m of text.matchAll(SLUG_MENTION_RE)) {
    const name = byName.get(m[1]);
    if (name) found.add(name);
  }
  return [...found];
}

/** Group 1 is the slug; the match may start one character early (the boundary). */
export const SLUG_MENTION_RE =
  /(?:^|[^a-z0-9@.])@([a-z0-9][a-z0-9-]{0,30}[a-z0-9])(?![a-z0-9@~+-])(?!\.[a-z0-9])/g;

/**
 * Plain-text mentions with their ids removed: `@nicholas-jitkoff+agent~k3f0a9x2`
 * reads as `@nicholas-jitkoff`. For surfaces that show comment text as
 * text, where the editor's node isn't there to hide the id.
 */
export function stripMentionIds(text: string): string {
  return text.replace(MENTION_RE, (match, slug: string) => {
    const at = match.indexOf("@");
    return `${match.slice(0, at)}@${slug}`;
  });
}

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
  /** The mention token for agents and people; the typed address for an email row. */
  handle: string;
  /** Primary text: an agent's label or a person's display name. */
  label: string;
  /** Secondary text: the readable part of the handle, never the id. */
  detail?: string;
  color?: string;
  avatar?: string;
  animal?: string;
  /** The agent's client, for its mark. */
  client?: string | null;
}

export interface MentionSources {
  agents: Pick<AgentRosterEntry, "name" | "label" | "color" | "mention" | "client">[];
  people: {
    name: string;
    color: string;
    /** The person's public id: a short uid for the signed-in, the browser id otherwise. */
    id?: string;
    avatar?: string;
    animal?: string;
    isAgent?: boolean;
  }[];
}

/** The readable part of a token, for a popup's detail line: `@slug` or `@slug+tag`. */
function readableHandle(handle: string): string {
  const token = parseMentionToken(handle);
  return token ? `@${token.slug}${token.tag ? `+${token.tag}` : ""}` : `@${handle}`;
}

/**
 * Builds the `@` completion list: agents first (mentioning one wakes it),
 * then people. Both complete to a token carrying a short id, so the
 * document names exactly one of them; a person with no usable id falls
 * back to a name slug, uniquified within the list. A query shaped like an
 * email adds a final row that the popup resolves to a person before
 * anything is inserted — the address itself is never written.
 */
export function rankMentionItems(query: string, sources: MentionSources, max = 8): MentionItem[] {
  const q = query.trim().toLowerCase();
  const taken = new Set<string>();
  const items: MentionItem[] = [];

  for (const agent of sources.agents) {
    const handle = agent.mention || agent.name;
    taken.add(handle);
    taken.add(agent.name);
    items.push({
      kind: "agent",
      handle,
      label: agent.label ?? agent.name,
      detail: readableHandle(handle),
      color: agent.color,
      client: agent.client ?? null,
    });
  }

  for (const person of sources.people) {
    if (person.isAgent) continue;
    let handle = personMention(person.name, person.id);
    if (!handle) {
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
      detail: readableHandle(handle),
      color: person.color,
      avatar: person.avatar,
      animal: person.animal,
    });
  }

  const matches = q
    ? items.filter((item) => mentionMatches(item, q))
    : items;
  const ranked = matches.slice(0, max);

  if (isEmailQuery(q)) {
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
