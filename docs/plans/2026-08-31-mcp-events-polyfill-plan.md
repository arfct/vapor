# MCP Events polyfill

**Goal:** Replace idle polling with standards-shaped push. vapor implements the MCP Triggers & Events Working Group's [Events design sketch](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/pull/1) — optimistically, before it ratifies — so agents can register **webhooks** for mentions and document changes today, and so vapor becomes a running reference implementation of the draft.

**Relationship to other plans:** completes the agent half of the [sleeping-tabs plan](2026-08-31-sleeping-tabs-plan.md) (the 15s-capped `await_events` + `retryAfterMs` was the stopgap; webhooks are the fix). Builds on the events table and cursor that shipped with the WYSIWYG work.

## What we are polyfilling

The sketch (draft by the WG's Anthropic co-lead, 2026-02-19) defines an `events` capability with:

- **`events/list`** — event types: `{name, description, delivery: ("poll"|"push"|"webhook")[], inputSchema, payloadSchema}`.
- **`events/poll`** — `{name, arguments, cursor, maxEvents}` → `{events[], cursor, truncated, hasMore, nextPollMs}`. Stateless per request.
- **`events/subscribe`** (webhook only) — `{name, arguments, delivery: {mode: "webhook", url, secret}, cursor, ttlMs}` → `{id, refreshBefore, cursor, truncated}`. Idempotent upsert keyed on `(principal, url, name, arguments)`; refresh = re-subscribe; `events/unsubscribe` for eager teardown.
- **Delivery**: POST of an `EventOccurrence` `{eventId, name, timestamp, data, cursor}` signed per **Standard Webhooks** (`webhook-id` / `webhook-timestamp` / `webhook-signature: v1,base64(HMAC-SHA256(secret, "id.timestamp.body"))`) plus `X-MCP-Subscription-Id`.
- **Rules that bind us**: `delivery.secret` is client-supplied and must match `whsec_` + base64(24–64 bytes); webhook mode **requires an authenticated principal** (unauthenticated servers may offer poll/push only); cursors are opaque, client-owned, and `truncated: true` signals gaps; error codes `-32011 NotFound` … `-32015 CallbackEndpointError`.
- **`events/stream`** (push over a long-lived request) also exists in the sketch — **out of scope here** (it re-pins the DO; exactly what the sleeping-tabs work removed).

## vapor's event catalog

One events core, mapped from what the DocumentAgent already records:

| Event type | Arguments (`inputSchema`) | Payload (`payloadSchema`) |
|---|---|---|
| `document.changed` | `{doc_id}` | `{doc_id, digest}` — the existing doc_changed digest |
| `mention` | `{doc_id}` | `{doc_id, agent, text}` |
| `thread.reply` | `{doc_id}` | `{doc_id, agent, thread_id, text}` |

- **Cursor** = the existing per-doc `events.seq`, serialized opaquely as `s<seq>`. **`eventId`** = `<doc_id>:<seq>` (stable, dedupable).
- Subscriptions are **doc-scoped** in v1 (arguments require `doc_id`). An identity-wide inbox ("any doc I'm enrolled in", routed via the Registry) is the natural v2 and slots into the same catalog as argument-free variants.
- `mention` and `thread.reply` deliver only events addressed to the subscribing identity — same filtering `agentAwaitEvents` does today.

## How the polyfill is provided — three layers over one core

The core (event log + cursor + subscription store + dispatcher) is protocol-agnostic; the layers are skins. When the SEP ratifies with different names or shapes, only the skins get re-cut.

**Layer 1 — spec-shaped protocol methods (for tomorrow's clients).** Mount `events/list`, `events/poll`, `events/subscribe`, `events/unsubscribe` as custom request handlers on VaporMcp's underlying `Server` (the low-level SDK accepts arbitrary method schemas), and declare `capabilities.events`. Shapes copied from the sketch verbatim, including its error codes. Tagged experimental via `_meta["fyi.vapor/events-draft"] = "2026-02-19"` so a future ratified version is distinguishable on the wire. No mainstream client calls these today; this layer exists so spec-native SDKs work against vapor on day one.

**Layer 2 — tool mirrors (the polyfill for today's clients).** The same four operations exposed as ordinary tools — `events_list`, `events_poll`, `events_subscribe`, `events_unsubscribe` — with input schemas transliterated from the sketch. Any current MCP client can register a webhook via a tool call. Tool descriptions say plainly: this mirrors the draft MCP Events extension and will be deprecated in favor of the protocol methods when the SEP lands. `await_events` survives as a deprecated alias whose description points at `events_poll` (its response already matches the poll contract in spirit: events + cursor + retry pacing).

**Layer 3 — the webhook dispatcher (the part that kills polling).**
- **Store**: a `subscriptions` table in the document's own DO (`id, principal, url, secret, name, arguments, cursor_floor, expires_at, failures, active`) — doc-scoped subscriptions live and die with the doc, which also gives TTL cleanup and the 99h expiry for free.
- **Auth**: per the sketch, webhook mode requires a principal — so `events_subscribe` works **only through the OAuth door** (`/mcp`); the anonymous door gets poll only, refused with `-32012 Forbidden`. This also keeps the public-doc abuse surface closed (no anonymous "make vapor POST to arbitrary URLs").
- **Dispatch**: `recordEvent` → after the row insert, look up matching active subscriptions and POST each `EventOccurrence` with Standard Webhooks signatures via `waitUntil`. Coalescing: `document.changed` digests are already debounced server-side; mention/reply send immediately.
- **Retries & hygiene**: 2 retries with short backoff per delivery; `failures` increments on exhaustion and `active` flips false after 5 consecutive failures (the sketch's suspension semantics — a successful re-subscribe reactivates). HTTPS-only URLs; reject private-network literals (`localhost`, RFC1918, `.internal`) to keep the dispatcher from being an SSRF primitive.
- **TTL policy**: grant `min(suggested, 24h)` with a 5-minute floor; never grant no-expiry in v1 (the sketch lets servers refuse by granting finite). `refreshBefore` returned as ISO 8601; refresh is the idempotent re-subscribe the sketch specifies, including secret rotation semantics (replace; skip dual-signing in v1, documented).

## Tasks

1. **Core** (`agents/events.ts`, plain module, unit-testable): event-type catalog with zod schemas; cursor encode/decode; `EventOccurrence` construction; Standard Webhooks signing (WebCrypto HMAC — vapor already has the primitives in auth.server.ts); subscription-key hashing for `id`.
2. **DocumentAgent**: `subscriptions` table + `eventsSubscribe/eventsUnsubscribe/eventsPoll/eventsList` RPCs (verifyIdentity-gated, capability rules above); dispatcher wired into `recordEvent`; lazy TTL expiry on dispatch and on subscribe.
3. **Layer 2 tools** in mcp-tools.ts (schema transliteration; `await_events` deprecation note).
4. **Layer 1 methods** in agents/mcp.ts via `setRequestHandler` + `capabilities.events` declaration + `_meta` draft tag.
5. **Tests**: signing vectors against the Standard Webhooks spec examples; subscribe/refresh/expire lifecycle; dispatch retry/suspend; poll parity with `await_events`; anonymous-door refusal; SSRF guard.
6. **Docs**: `/mcp` help page gains an events section; a short note filed to the WG repo as field-report feedback once it's running (they're soliciting exactly this).

## Drift management (this is a draft, and it will move)

- The WG is actively debating whether webhooks belong at the protocol layer at all vs. a transport-level redelivery mechanism. If delivery moves to the transport, **layers 1–2 shrink but the core and dispatcher survive unchanged** — every variant still needs a cursored log, signed delivery, and subscription lifecycle.
- Watch items: the SEP ("Events in MCP v1") status in the incubation repo; SEP-1686 (Tasks) for interaction; rename churn. Re-cut the skins when ratified, keep tool mirrors one release past that for stragglers, then drop them.
- Everything user-visible carries the word *experimental* and the draft date, so nobody mistakes the polyfill for the standard.

## Out of scope

`events/stream` push mode; identity-wide (cross-document) subscriptions and the Registry inbox; dual-signature secret rotation; a standalone pager/hub product (see the webhook-infrastructure discussion — A2A `PushNotificationConfig`, Maritime, AgentMail all validate the space; vapor stays scoped to its own documents).
