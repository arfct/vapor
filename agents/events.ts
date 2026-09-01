/**
 * The events core for the MCP Events polyfill — protocol-agnostic pieces
 * shared by the tool mirrors, the spec-shaped `events/*` methods, and the
 * DocumentAgent's webhook dispatcher. Shapes follow the MCP Triggers &
 * Events WG design sketch (draft 2026-02-19); see
 * docs/plans/2026-08-31-mcp-events-polyfill-plan.md.
 *
 * Deliberately imports nothing from the `agents` package so it stays
 * unit-testable in plain Vitest (same convention as mcp-tools.ts).
 */

/** Tag carried in `_meta` so draft-dialect traffic is distinguishable. */
export const EVENTS_DRAFT_META_KEY = "fyi.vapor/events-draft";
export const EVENTS_DRAFT_VERSION = "2026-02-19";

/* ---------- Event catalog ---------- */

/** Wire name ↔ the internal `events.type` column value. */
export const EVENT_TYPES = [
  {
    name: "document.changed",
    internalType: "doc_changed",
    description:
      "Fires when the document's content changes (digested — one event per burst of edits, not per keystroke).",
    delivery: ["poll", "webhook"] as const,
    addressed: false,
  },
  {
    name: "mention",
    internalType: "mention",
    description: "Fires when this agent is @mentioned in the document text.",
    delivery: ["poll", "webhook"] as const,
    addressed: true,
  },
  {
    name: "thread.reply",
    internalType: "thread_reply",
    description: "Fires when a human replies in a comment thread this agent participated in.",
    delivery: ["poll", "webhook"] as const,
    addressed: true,
  },
] as const;

export type EventTypeName = (typeof EVENT_TYPES)[number]["name"];

const DOC_ID_SCHEMA = {
  type: "object",
  properties: {
    doc_id: { type: "string", description: "The 8-character document id (from its URL)." },
  },
  required: ["doc_id"],
} as const;

/** The `events/list` result, per the sketch's EventType shape. */
export function eventCatalog(): {
  name: string;
  description: string;
  delivery: string[];
  inputSchema: unknown;
  payloadSchema: unknown;
}[] {
  return EVENT_TYPES.map((t) => ({
    name: t.name,
    description: t.description,
    delivery: [...t.delivery],
    inputSchema: DOC_ID_SCHEMA,
    payloadSchema: {
      type: "object",
      properties: {
        doc_id: { type: "string" },
        ...(t.addressed ? { agent: { type: "string" } } : {}),
      },
    },
  }));
}

export function eventTypeByName(name: string) {
  return EVENT_TYPES.find((t) => t.name === name) ?? null;
}

export function wireNameForInternal(internalType: string): EventTypeName | null {
  return EVENT_TYPES.find((t) => t.internalType === internalType)?.name ?? null;
}

/* ---------- Cursors and occurrence ids ---------- */

/** Cursors are opaque to callers: the per-doc event seq, serialized. */
export function encodeCursor(seq: number): string {
  return `s${seq}`;
}

export function decodeCursor(cursor: string | null | undefined): number | null {
  if (cursor == null) return 0; // null = start from the beginning of the doc's log
  const m = /^s(\d+)$/.exec(cursor);
  return m ? Number(m[1]) : null;
}

export function eventId(docId: string, seq: number): string {
  return `${docId}:${seq}`;
}

/** The sketch's EventOccurrence, as delivered by poll and webhook alike. */
export interface EventOccurrence {
  eventId: string;
  name: string;
  timestamp: string;
  data: Record<string, unknown>;
  cursor: string;
}

export function buildOccurrence(args: {
  docId: string;
  seq: number;
  internalType: string;
  payload: unknown;
  createdAt: number;
}): EventOccurrence | null {
  const name = wireNameForInternal(args.internalType);
  if (!name) return null;
  const payload = (args.payload ?? {}) as Record<string, unknown>;
  return {
    eventId: eventId(args.docId, args.seq),
    name,
    timestamp: new Date(args.createdAt).toISOString(),
    data: { doc_id: args.docId, ...payload },
    cursor: encodeCursor(args.seq),
  };
}

/* ---------- Webhook subscriptions ---------- */

/** Standard Webhooks symmetric secret: whsec_ + base64 of 24–64 bytes. */
export function isValidWebhookSecret(secret: string): boolean {
  const m = /^whsec_([A-Za-z0-9+/=]+)$/.exec(secret);
  if (!m) return false;
  try {
    const raw = atob(m[1]);
    return raw.length >= 24 && raw.length <= 64;
  } catch {
    return false;
  }
}

/**
 * HTTPS-only, and no private-network literals — the dispatcher must not be
 * an SSRF primitive. Hostname checks are literal (a Worker cannot resolve
 * DNS before fetching); a hostile DNS record is out of scope for v1.
 */
export function webhookUrlError(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "delivery.url is not a valid URL";
  }
  if (u.protocol !== "https:") return "delivery.url must be https";
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
  ) {
    return "delivery.url must not target a private network";
  }
  return null;
}

/**
 * Deterministic subscription id over the sketch's key
 * `(principal, delivery.url, name, arguments)` — a routing handle, not a
 * capability.
 */
export async function subscriptionId(
  principal: string,
  url: string,
  name: string,
  argumentsJson: string,
): Promise<string> {
  const key = [principal, url, name, argumentsJson].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sub_${hex.slice(0, 16)}`;
}

/* ---------- Standard Webhooks signing ---------- */

/**
 * Builds the Standard Webhooks headers for one delivery:
 * `webhook-signature: v1,base64(HMAC-SHA256(secret, "{id}.{timestamp}.{body}"))`.
 */
export async function signWebhook(args: {
  secret: string;
  messageId: string;
  timestampSeconds: number;
  body: string;
}): Promise<Record<string, string>> {
  const m = /^whsec_(.+)$/.exec(args.secret);
  if (!m) throw new Error("not a whsec_ secret");
  const keyBytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${args.messageId}.${args.timestampSeconds}.${args.body}`;
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return {
    "webhook-id": args.messageId,
    "webhook-timestamp": String(args.timestampSeconds),
    "webhook-signature": `v1,${b64}`,
  };
}

/* ---------- Delivery and TTL policy ---------- */

/** Grant floor: protects against refresh storms from misbehaving clients. */
export const SUBSCRIPTION_TTL_FLOOR_MS = 5 * 60 * 1000;

/** Retry delays after a failed delivery attempt (2 retries). */
export const DELIVERY_RETRY_DELAYS_MS = [1_000, 5_000];

/** Suspend only after consecutive failures spanning at least this long. */
export const SUSPEND_AFTER_FAILING_MS = 60 * 60 * 1000;

/** Pacing hint returned with empty poll results. */
export const POLL_RETRY_AFTER_MS = 30_000;

/**
 * TTL grant: min(suggested, remaining document lifetime), floored — a
 * subscription dies with its document anyway, so refresh choreography is
 * only imposed on clients who ask for less. Always finite (no-expiry
 * requests get the document's remaining lifetime).
 */
export function grantTtlMs(
  suggestedTtlMs: number | null | undefined,
  docExpiresAt: number,
  now: number,
): number {
  const remaining = Math.max(docExpiresAt - now, SUBSCRIPTION_TTL_FLOOR_MS);
  if (suggestedTtlMs == null) return remaining;
  return Math.min(Math.max(suggestedTtlMs, SUBSCRIPTION_TTL_FLOOR_MS), remaining);
}
