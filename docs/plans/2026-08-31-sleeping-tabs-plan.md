# Sleeping tabs and Durable Object duration

**Goal:** An open vapor tab stops costing money when nobody is using it. Today every open tab — and every idling agent — pins its document's Durable Object in memory around the clock, which exhausted the free tier's daily duration quota on 2026-08-31 and took the whole product down for the day.

**Status:** Phases 1 and 2 shipped on the notes-import branch (PR #6, "Free-tier safeguards: sleeping tabs and DO wake hygiene") and are deployed. Phase 3's usage script lives at [tools/do-usage.mjs](../../tools/do-usage.mjs) — it needs a `CLOUDFLARE_API_TOKEN` with *Account Analytics: Read* (not yet provisioned; runs and fails cleanly without it). The webhook successor to `await_events` polling has its own plan: [MCP Events polyfill](2026-08-31-mcp-events-polyfill-plan.md).

## Why documents never sleep

The Agents SDK already serves connections through the WebSocket **hibernation API** (`hibernate: true` is its default), and `ensureInitialised()` already rebuilds the Y.Doc from SQLite on wake — the architecture *can* sleep. Four things prevent it in practice:

1. **Awareness heartbeats.** y-protocols awareness re-broadcasts each client's presence roughly every 15–30s. Each message wakes the DO, and a woken DO lingers in memory well past the message — with per-tab heartbeats faster than the eviction window, an open tab keeps its DO effectively pinned 24/7 whether or not anyone is typing.
2. **`agentAwaitEvents` holds an RPC open for up to 50s** per poll ([document.ts](../../agents/document.ts)). An in-flight RPC pins the DO for its whole duration, so one agent long-polling in a loop = one DO pinned around the clock.
3. **In-memory idle timers.** Agent presence cleanup uses 5-minute `setTimeout`s; a pending timer keeps the isolate alive.
4. **Typed performances** hold the DO awake for their whole animation (~10 chars/s at natural pace — minutes for a long insert).

Independent of duration, **persistence writes the full document state on every Yjs update** — one SQLite row write per keystroke tick, against a 100k rows-written/day free cap and $1.00/M paid. Same fix family, so it rides along here.

## Cost model

Constants: a DO occupies 128 MB = 0.125 GB, so **1 pinned DO-hour = 450 GB-s**. Free tier: 13,000 GB-s/day (≈ 29 pinned hours/day, account-wide). Workers Paid ($5/mo): 400,000 GB-s/mo included (≈ 30 pinned hours/day), then **$12.50 per million GB-s** — i.e. a pinned DO-hour ≈ $0.0056, a DO pinned for a whole month ≈ **$4.11**. Hibernated time is free; requests are $0.15/M (hibernation-API WebSocket messages bill 20:1).

What that means at different scales, monthly on Workers Paid, duration only:

| Scenario | Pinned as today | With sleeping tabs (Phase 1) | With wake hygiene too (Phase 2) |
|---|---|---|---|
| Dogfood: ~40 tab-h/day + 1 polling agent | ≈ 870k GB-s → **~$11** total, and the free tier bursts daily | within included | within included |
| 100 DAU, tabs open ~6h/day, ~25% active | 27M GB-s → **~$340** | 6.8M → **~$85** | near-included → **~$5–15** |
| 1,000 DAU, same shape | 270M GB-s → **~$3,380** | 67M → **~$845** | **~$50–150** |
| 500 idle counterpart agents long-polling | +164M GB-s → **+$2,055** | unchanged (server-side) | **≈ $0–30** (bounded/alarm polls) |

Two conclusions fall out. First, **tab-pinning scales with tabs *open*, not tabs *used*** — real users leave tabs open overnight, so unmitigated cost grows ~4–10× faster than usage. Second, **the agent long-poll is the sleeper cost**: every idling counterpart agent is a full pinned DO (~$4/mo each), which at "every user has an agent" scale dwarfs the human side. Phase 1 fixes the human half; Phase 2 fixes the agent half and lets hibernation actually engage. Workers Paid is the prerequisite baseline regardless — the free tier's 29 pinned-hours/day cannot host a multiplayer product whose tabs stay open, and the cliff is a hard outage, not a bill.

## Phase 1 — Sleeping tabs (client, S)

A tab disconnects when it's clearly not in use and reconnects instantly on return. Yjs makes this safe: reconnect syncs state vectors, so a sleeping tab that wakes catches up in one round trip and loses nothing.

- **Sleep triggers**: page hidden (Page Visibility API) for > 60s, or visible but no pointer/key/selection activity for > 10 minutes. Sleeping = `provider.destroy()` + socket close + local awareness cleared (presence correctly disappears for others).
- **Wake triggers**: visibilitychange to visible, pointer/key activity, or focus. Reconnect through the existing `useAgent`/YjsProvider path; a `synced` flip already exists for UI.
- **UI**: the connection dot gains a "Sleeping" state; the editor stays readable (the Y.Doc is still in browser memory) with a subtle "reconnecting on input" affordance rather than a blocking overlay. Any local edit made in the wake-up instant is queued by Yjs and syncs on reconnect.
- **Files**: new `app/lib/useIdleSleep.ts`; wiring in [useYjsEditor.ts](../../app/lib/useYjsEditor.ts) (make the socket conditional on awake state); `ConnectionStatus` state map; tests for the trigger/wake state machine (timers mocked).
- **Non-goals**: no server changes; agents and other clients see a normal disconnect.

## Phase 2 — DO wake hygiene (server, M)

Make the DO's awake time proportional to actual work, so hibernation between messages does the saving:

- **Bound `agentAwaitEvents`**: cap the hold at ~20s (from 50s) *and* return a `retry_after_ms` hint so well-behaved agents poll on a cadence instead of hot-looping; document the cadence in the tool description. Longer term, mention delivery can move to a DO alarm + queued events so idle agents cost nothing.
- **Kill standing timers**: replace the 5-minute agent-idle `setTimeout`s with a DO alarm (one alarm, next-deadline scheduling), and audit for any other pending timers/intervals that pin the isolate.
- **Cap typed performances**: a wall-clock budget (~12s) per mutation; when the budget runs out, the remainder applies instantly. Keeps the show without letting a long insert pin the DO for minutes.
- **Debounce persistence**: write doc state on a 2s quiet edge and on connection close/hibernate (plus an alarm safety net), instead of every update. Cuts rows-written by ~50–100× under typing and trims CPU (full-state encode per keystroke today).
- **Verify hibernation engages**: temporary structured logs on wake/sleep; confirm with `durableObjectsPeriodicGroups` analytics that active time per tab-hour collapses.

## Phase 3 — Measurement and guardrails (S, ongoing)

- `tools/do-usage.mjs`: per-day DO active time (converted to GB-s at the 128 MB billing size) and request counts from the GraphQL Analytics API, printed against the free-tier daily budgets with a warning at 70% and a failure exit at 100% — runnable ad hoc or from CI/cron. Requires `CLOUDFLARE_ACCOUNT_ID` plus a `CLOUDFLARE_API_TOKEN` scoped to *Account Analytics: Read*.
- Revisit the awareness heartbeat cadence only if analytics show wake-per-message still dominating after Phases 1–2 (thinning presence updates trades cursor liveness for cost; not worth it until measured).

## Sequencing and expected effect

Phase 1 ships first and alone (client-only, no protocol change) — it removes the dominant human-side burn and would have prevented today's outage. Phase 2 follows before counterpart agents are promoted any further. Rough post-fix shape at 1,000 DAU: **$5 base + low tens of dollars/month**, versus ~$3,400 unmitigated — and no daily cliff in the meantime once the account is on Workers Paid.
