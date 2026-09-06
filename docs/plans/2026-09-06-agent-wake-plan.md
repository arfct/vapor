# Wake my agent: identity-wide mention and reply delivery

**Goal:** a signed-in person sets up, once, how vapor should wake their agent. From then on, a mention of their agent in any document where it's enrolled, or a reply in one of its threads, fires that target. No relay to deploy, no per-document subscription, no secret to generate.

**Relationship to other plans:** builds on the events polyfill ([2026-08-31](2026-08-31-mcp-events-polyfill-plan.md)), which keeps per-document `events_subscribe` webhooks unchanged. Replaces the hand-deployed relay described there for the common case; the relay stays in the repo as an example of a custom receiver.

## What exists already

- `DocumentAgent.recordEvent` writes `mention` / `thread_reply` / `doc_changed` rows and calls `dispatchWebhooks` for per-document subscriptions. Addressed events name the target agent (`payload.agent`), and the roster row for that name carries `owner` (the principal) for signed-in agents.
- The `Registry` is one global Durable Object keyed by principal (`kv` table: `p:` profiles, `a:` agent slugs, `u:` uids). It has `SESSION_SECRET` in its env.
- `/auth/me` and `/auth/*` are same-origin cookie routes in `workers/routes.ts`; `/:id/agents` is a React Router resource route for the roster.
- The Invite an agent dialog (`AgentsPanel`) has one tab per client and the document roster with revoke.
- Claude Code routines expose a per-routine fire endpoint: `POST …/routines/<trig_…>/fire` with `Authorization: Bearer sk-ant-oat01-…`, `anthropic-beta: experimental-cc-routine-2026-04-01`, `anthropic-version`, and `{"text": "…"}`. Every accepted call is a new session; there is no idempotency key. Fire text arrives wrapped as untrusted data, so the routine's prompt must opt in to acting on it.

## Design

### Target kinds

A wake target is `{ kind, url, secret }`. Two kinds in v1, defined in one table so a third is one entry:

| kind | url | secret | request |
|---|---|---|---|
| `claude-routine` | the routine's `/fire` URL | the routine's token (`sk-ant-oat01-…`) | routine headers, body `{"text": <prose>}` |
| `webhook` | any public HTTPS URL | optional. `whsec_…` signs per Standard Webhooks; anything else is sent as `Authorization: Bearer` | JSON `EventOccurrence` plus a `text` field with the same prose |

The prose is the same for both kinds: what happened, the document URL and id, who was mentioned, the block or thread text, and one line saying what to do. It is written for a model reading it cold.

### Storage

In the Registry `kv` table, key `w:<principal>`, one record per principal:

```
kind, url, sealedSecret, secretHint, createdAt, updatedAt,
lastFiredAt, lastStatus, lastError, fires: number[] (timestamps, last 24h), lastFiredByDoc: { docId: ts }
```

The secret is sealed with AES-GCM under a key derived from `SESSION_SECRET` by HKDF (info `vapor wake target v1`), so no new Workers secret is needed. The plain secret is only ever decrypted inside the Registry to send a fire. Owners see a hint (last four characters), never the value.

### Trigger

`recordEvent` gains `dispatchWake(type, payload)` next to `dispatchWebhooks`. For `mention` and `thread_reply` only, it reads the addressed roster row; if it has an owner, it calls `Registry.wake({ principal, docId, occurrence })` under `waitUntil`. `doc_changed` never wakes anyone. Without a Registry binding (the test harness) it does nothing.

The Registry does the sending, so the secret never leaves it and the rate limits and status live with the target:

- Per document, at most one fire per agent every 30 seconds.
- Per principal, at most 50 fires a day.
- No retries. A routine fire creates a session, so a retry after a lost response would double it. 4xx and 5xx alike record `lastStatus` and `lastError` for the owner to see.

### Scope

A target only fires for documents where the owner's agent is on the roster, which is today's mention rule. Two ways to get there without an MCP call from the agent: the skill's share step calls `join` after creating a document, and the dialog offers "Add my agent to this document" to a signed-in person. Revoking the agent from a document stops wakes for that document; removing the target stops them everywhere.

### Routes

Same-origin, cookie session, in `workers/wake-routes.ts` as a pure handler wired from `workers/app.ts`:

| Method and path | Purpose |
|---|---|
| `GET /me/wake` | The owner's target, public view, or `{ target: null }` |
| `PUT /me/wake` | Set or replace `{ kind, url, secret }`; validation errors are 400 with a message |
| `DELETE /me/wake` | Remove |
| `POST /me/wake/test` | Fire a synthetic test event; returns the receiver's status |

`POST /:id/agents` gains `intent: "join"`: enrols the signed-in person's counterpart agent (slug from the Registry, label "First's Agent", suggest and comment) and returns the roster.

### UI

Inside the Invite an agent dialog, in the tab the target belongs to: **Wake a routine on mentions** under Claude, **Wake a webhook on mentions** under Other. Each client tab (Claude, ChatGPT with Codex, Cursor, Gemini, VS Code, Other) carries its mark (`app/assets/agents`, listed in `app/shared/agent-clients.ts`, which also maps an MCP client's declared name to a mark so agent types can be shown elsewhere).

- Signed out: one line, "Sign in, and a mention of your agent in any document can wake …".
- Signed in, no target: URL, secret, Save. Under Claude, three short steps above the fields with links: create a routine (claude.ai/code/routines) with the canonical prompt (copy button) and the Vapor connector, add an API trigger and generate a token, paste both here.
- Signed in, target of this kind: "Mentions wake your Claude Code routine (…hint). Last woken 3 minutes ago, answered 200." with Test, Change, Remove. Last error shown when there is one.
- Signed in, target of the other kind: "Mentions currently wake your Webhook. Switch to Claude Code routine."
- On a document, when the person's agent isn't on the roster: "Add my agent".

### Docs

Help page and markdown guide gain a "Wake your agent" section with the canonical prompt; README a paragraph; the skill's share step drops the relay env vars in favour of `join`; the events plan marks the relay as an example receiver; `CLAUDE.md` gets a line.

## Tasks

1. `app/shared/wake-policy.ts` (pure): kinds table, validation, prose formatter, request builder, rate-limit decision, canonical prompt. Unit tests.
2. `app/shared/wake-crypto.ts` (pure, WebCrypto): HKDF key derivation, seal, open. Unit tests, including that a different secret cannot open.
3. Registry: `getWakeTarget`, `setWakeTarget`, `deleteWakeTarget`, `wake`, `testWake`. Integration tests over the kv fake with `fetch` stubbed.
4. DocumentAgent: `dispatchWake` from `recordEvent`, guarded when no Registry binding.
5. `workers/wake-routes.ts` + tests; wire in `workers/app.ts`. `intent: "join"` in `doc.$id.agents.ts`.
6. `AgentsPanel` section; `useSession` inside the panel.
7. Docs and skill.
8. Live check on dev: set a Claude target pointing at the real routine, mention the agent in a document, see the run and the comment; set a webhook target pointing at the relay and see a signed delivery.

## Out of scope

Per-document opt-out of wakes (revoke covers it); wake targets for anonymous agents; more than one target per principal; retries with idempotency.
