# Identity phase — design

Vapor gains optional user identity: Google sign-in on the web, OAuth for MCP clients, and counterpart agents bound to their owners. The architecture is a port of subpixel's proven stack (see `~/Code/subpixel/server/auth.ts`, `oauth.ts`, `registry.ts`) — same account, same conventions, battle-tested code.

Decisions settled in discussion, 2026-08-30:

- **Provider**: Google only this phase (GSI credential flow — client-side ID token, server-side WebCrypto verification against Google's JWKS, no client secret, no auth library). GitHub/Apple/magic-links later; subpixel's issuer-table sketch is the extension path.
- **Identity = verified email principal** (`email:<lowercased addr>`), exactly subpixel's model. A stable random `uid` decouples storage from the principal.
- **Sign-in stays optional, everywhere.** Public-by-URL, anonymous editing, and anonymous MCP are unchanged. Identity buys attribution and counterpart agents — never a wall.
- **Identity ≠ access control this phase.** No ACLs, no private docs. Owner fields get real values; enforcement comes later.
- **Storage**: one global `Registry` Durable Object (`idFromName("global")`), SQLite-backed, prefixed key namespaces — no D1, no KV. Matches vapor's DO-native architecture and subpixel's reference implementation.

## Components

```
Browser ──GSI credential──► POST /auth/google ──verify──► session cookie (vp_session)
MCP client ──OAuth 2.1 (PKCE)──► /oauth/* ──consent──► access token = short-lived session JWT
                                     │
                                     ▼
                            Registry DO ("global")
                 profiles · agent slugs · oauth clients/codes/refresh tokens
                                     │ principal flows via props
                                     ▼
VaporMcp ──RPC──► DocumentAgent (roster entries gain owner = principal)
```

- **`server-side auth module`** (`app/lib/auth.server.ts` + `workers/` wiring): ported from subpixel `server/auth.ts`. Google ID-token verification (JWKS via Cache API), HS256 session JWT signer/verifier (WebCrypto HMAC, `SESSION_SECRET`), cookie (`vp_session`, HttpOnly, SameSite=Lax, Secure, 30-day TTL) + `Authorization: Bearer` fallback, same-origin guard on credential posts.
- **`Registry` DO** (`agents/registry.ts`): profiles keyed `p:<principal>` → `{ uid, displayName, avatar, agentSlug }`; reverse indexes `u:<uid>`, `a:<agentSlug>`. Also owns OAuth AS state: registered clients, auth codes, refresh tokens (prefixed namespaces, subpixel pattern).
- **OAuth 2.1 authorization server** (`workers/oauth.ts`, port of subpixel `server/oauth.ts`): PKCE S256, dynamic client registration, RFC 8414/9728 discovery documents, consent page, refresh. Access token = 1-hour session JWT carrying `{ principal, email, caps }`; refresh token rotates in the Registry. No `workers-oauth-provider` — consistency with subpixel beats the library.

## Routes

| Route | Purpose |
|---|---|
| `GET /auth/config` | public Google client id |
| `POST /auth/google` | verify GSI credential → set session cookie |
| `GET /auth/me` | current session (principal, displayName, agentSlug) |
| `POST /auth/logout` | clear cookie |
| `GET/POST /oauth/authorize`, `POST /oauth/token`, `POST /oauth/register`, `POST /oauth/revoke` | MCP OAuth AS |
| `GET /.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | discovery |

Reserved-slug list gains `auth`, `oauth`, `.well-known` (already covered), `settings`.

## The two MCP doors

Identity is the default; anonymity is the explicitly chosen door:

- **`/mcp`** — the primary endpoint. Accepts exactly one credential type: an OAuth access token. A request with no (or an invalid) credential gets `401` + `WWW-Authenticate` with the resource-metadata URL — which is exactly what makes Claude Code and claude.ai run the browser consent flow automatically. Adding `https://vapor.fyi/mcp` means signing in.
- **`/mcp/anonymous`** — identical tool surface, never challenges. Tokenless → auto-enrolled anonymous agent (current behavior, relocated). The zero-friction door for people who don't want an account, and the connector URL the help page offers second, not first.

Migration note: this is a deliberate breaking change for existing `/mcp` clients — tokenless ones get walked into consent (the intended nudge), and `vpr_` bearer holders are cut off (see below). The help page and README lead with the signed-in door and mention `/mcp/anonymous` as the alternative.

## Per-doc tokens retire

User-facing `vpr_` tokens are removed — they were the identity stopgap, and OAuth replaces them (Nicholas approved the break: no users to migrate).

- **Invite agent dialog** shrinks to what it should have been: connection instructions (the two doors) plus the roster with revoke. No minting, no one-time token screen, no capability switches — capabilities now live on the OAuth grant.
- **Write capability** is granted at consent time, per user, instead of per doc. Per-doc revoke survives via the roster (severing that doc's enrollment); revoking the grant itself kills the counterpart everywhere.
- **`create_document`** returns id + URL only — the calling identity (principal or anonymous session) is already enrolled on the new doc; no token in the response.
- **Headless agents** (CI, scripts) use `/mcp/anonymous` (suggest + comment), or complete one browser consent and hold the refresh token; personal API tokens return later if that pinches.
- **Internally**, `DocumentAgent`'s roster and RPC surface migrate from raw-token arguments to a verified identity argument (`{ kind: "principal" | "anonymous", id, caps }`) passed by `VaporMcp` after it has authenticated the caller — the `agent_tokens` hashing machinery goes away entirely rather than lingering as plumbing. Rate limits key on the identity instead of the token hash.

## Consent and capabilities

The consent page (server-rendered, GSI inline — subpixel's `consentPage` pattern) shows the requesting client's name and a capability choice:

- **Suggest & comment** (default, pre-selected) — the counterpart argues, humans decide.
- **Full write** — explicit opt-in, one extra click.

Granted caps ride in the access token. Rationale: the org's agents-suggest-by-default posture, applied at the identity level.

## Counterpart agents

One standing agent identity per user:

- **`agentSlug`**: auto-derived at first grant — `slugifyAgentName(displayName)`, uniquified globally in the Registry (`-2`, `-3`, …). User-editable later (settings page is out of scope this phase).
- On any authenticated `/mcp` tool call touching a doc, `VaporMcp` enrolls (or reuses) a roster entry: `name = agentSlug`, `owner = principal`, capabilities = the grant's caps. No tokens involved — the verified identity is the credential, so enrollment is durable and cross-session by construction.
- The roster UI shows the owner; the caret badge is unchanged. Revoke in a doc severs that doc's entry only; the OAuth grant itself is revoked via `/oauth/revoke` or a future settings page.
- Invariant: counterpart capabilities ≤ the grant's caps ≤ what any URL-holder could do anyway (all docs world-editable this phase), preserving the no-escalation argument.

## Web sign-in

- A **Sign in** affordance in the doc header (GSI button in a small popover; subpixel's `web/js/auth.js` is the reference). Optional forever.
- Signed-in presence: awareness `user.name` = displayName (replacing "User 397"); comments authored with displayName. Anonymous users keep the current behavior.
- No handle system this phase — displayName from Google suffices for attribution; `agentSlug` covers the machine-name need.

## Secrets

`SESSION_SECRET` (new, `wrangler secret put`), `GOOGLE_CLIENT_ID` (public, plain var). Google Cloud console setup: one OAuth client id for vapor.fyi (+ localhost for dev). Per org standards, values live in Workers secrets and the vault; `.dev.vars.example` gains the names.

## Out of scope (recorded so they stay out)

ACLs/private docs, doc ownership enforcement, handle claiming UI, settings page, personal API tokens for headless agents (per-doc tokens cover them meanwhile), GitHub/Apple/magic-link providers, ADMIN_EMAILS-gated features, extracting a shared auth package for subpixel+vapor (candidate follow-up once both run the ported code).

## Testing

- **Unit**: session JWT round-trip + expiry + tamper rejection; Google ID-token verification against a fixture JWKS (subpixel's test approach); slug uniquification; OAuth code/PKCE verifier checks; consent-cap encoding.
- **Integration**: Registry DO profile round-trip via the mock-Agent pattern; `/mcp` 401-challenge shape (bare and invalid-credential requests); grant → counterpart enrollment → roster owner set; `/mcp/anonymous` behaves exactly as today's tokenless `/mcp` (regression); DocumentAgent RPCs accept the verified-identity argument and reject malformed ones.
- **Live acceptance**: add `vapor.fyi/mcp` in Claude Code → browser consent → suggest lands as `<agentSlug>` owned by the signed-in principal; `vapor.fyi/mcp/anonymous` still connects with zero configuration; sign in on the web → presence shows displayName.
