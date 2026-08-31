# Identity Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional Google identity for vapor — web sign-in, OAuth-gated `/mcp` with automatic client consent, `/mcp/anonymous` for tokenless access, counterpart agents owned by principals, and full retirement of per-doc `vpr_` tokens.

**Architecture:** Port subpixel's dependency-free auth stack (Google ID-token verification, HMAC session JWTs, hand-rolled OAuth 2.1 AS) into vapor. A new global `Registry` DO holds profiles + OAuth state. `DocumentAgent`'s RPC surface migrates from raw tokens to a verified-identity argument; `VaporMcp` authenticates callers and passes identity down. Spec: `docs/plans/2026-08-30-identity-design.md`. Port sources (read, then adapt — same owner, no license concerns; keep a pointer comment): `~/Code/subpixel/server/auth.ts` (381 lines), `oauth.ts` (355), `registry.ts` (802).

**Tech Stack:** Cloudflare Workers + DOs, WebCrypto (RS256 verify, HMAC HS256), Agents SDK, React Router 7, Vitest.

## Global Constraints

- Nothing under `app/` imports from `agents/`; `agents/` may import `app/lib`/`app/shared`. `workers/routes.ts` and new `workers/oauth.ts` stay free of the `agents` npm package (dependency-injected) so they unit-test in plain Vitest.
- DO integration tests use the mock-Agent pattern in `tests/integration/agents/` (extend the sql/state fakes as needed).
- Errors from DocumentAgent RPCs are return values `{ error: { code, message } }`, never throws.
- Session cookie name `vp_session`; secrets `SESSION_SECRET` (Workers secret) + `GOOGLE_CLIENT_ID` (plain var); `.dev.vars.example` gains both names.
- Verified identity type (single source of truth, `app/shared/agent-protocol.ts`):
  ```ts
  export interface AgentIdentity {
    kind: "principal" | "anonymous";
    id: string;            // principal ("email:…") or anonymous session key
    name: string;          // roster/display slug (agentSlug or slugified clientInfo)
    owner: string | null;  // principal for kind=principal, null for anonymous
    caps: AgentCapability[];
  }
  ```
- Anonymous capabilities stay `DEFAULT_CAPABILITIES`; principal caps come from the OAuth grant.
- Reserved slugs gain `auth`, `oauth`, `settings` (`.well-known` already present).
- ESLint `_` prefix; TS strict; commits imperative with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer; run `npm run typecheck && npm run lint && npx vitest run tests` before each commit.
- BREAKING is fine (approved): `vpr_` tokens, mint/one-time-token UI, and `agent_tokens` machinery are deleted, not deprecated.

---

### Task 1: Port the auth core

**Files:**
- Create: `app/lib/auth.server.ts` (port of subpixel `server/auth.ts` — sessions, Google verify, cookies)
- Modify: `app/shared/agent-protocol.ts` (add `AgentIdentity`, reserved slugs), `.dev.vars.example`
- Test: `tests/unit/lib/auth-server.test.ts`

**Interfaces (produces):**
```ts
export interface SessionClaims { principal: string; email: string; caps?: AgentCapability[]; iat: number; exp: number; }
export async function mintSessionToken(claims: Omit<SessionClaims,"iat"|"exp">, secret: string, ttlSeconds?: number): Promise<string>;
export async function verifySessionToken(token: string, secret: string): Promise<SessionClaims | null>;
export async function verifyGoogleIdToken(credential: string, clientId: string): Promise<{ email: string; name: string; picture?: string } | null>; // RS256 vs Google JWKS, cached via caches.default; injectable JWKS fetcher for tests
export function sessionFromRequest(req: Request, secret: string): Promise<SessionClaims | null>; // vp_session cookie OR Authorization: Bearer
export function sessionCookieHeader(token: string, maxAge: number, secure: boolean): string; // HttpOnly; SameSite=Lax; Path=/
export function principalFromEmail(email: string): string; // "email:" + lowercased
```
Adapt from subpixel: rename cookie `sp_session`→`vp_session`; keep the same-origin guard helper; drop Playdate device-pairing entirely; make the JWKS fetch injectable (`(url) => Promise<JsonWebKey[]>`) so tests use a fixture keypair generated with WebCrypto in the test itself (sign a fake ID token with the fixture private key; verify against the fixture JWKS).

- [ ] **Step 1:** Failing unit tests: session mint→verify round-trip; expired token → null; tampered payload → null; `verifyGoogleIdToken` accepts a fixture-signed token with correct aud/iss/exp and rejects wrong-aud, wrong-iss, expired, bad-signature; cookie header shape; `principalFromEmail("Foo@Bar.COM") === "email:foo@bar.com"`.
- [ ] **Step 2:** RED → port/implement → GREEN. Add `AgentIdentity` + reserved-slug additions with a one-line unit test each.
- [ ] **Step 3:** Full gates; commit `Port session and Google auth core from subpixel`.

### Task 2: Registry Durable Object

**Files:**
- Create: `agents/registry.ts`
- Modify: `workers/app.ts` (export), `wrangler.jsonc` (binding `Registry`, migration v3 `new_sqlite_classes: ["Registry"]`)
- Test: `tests/integration/agents/registry.test.ts` (mock-Agent pattern; may need its own small sql fake)

**Interfaces (RPCs, all return values never throws):**
```ts
async upsertProfile(principal: string, info: { displayName: string; avatar?: string }): Promise<{ profile: Profile }>
async getProfile(principal: string): Promise<{ profile: Profile } | { error }>
async ensureAgentSlug(principal: string): Promise<{ slug: string }>   // slugify(displayName), global uniquify -2/-3…, stable once set
// OAuth state (namespaced rows): registerClient, getClient, putCode, takeCode (single-use), putRefresh, rotateRefresh, revokeGrant
```
`Profile = { uid, principal, displayName, avatar: string|null, agentSlug: string|null }`. Follow subpixel `registry.ts` key scheme (`p:`, `u:`, `a:` + `oc:`/`code:`/`rt:` for OAuth). Accessed via `getAgentByName(env.Registry, "global")`.

- [ ] Failing integration tests: profile upsert/get round-trip; slug uniquification (two principals, displayName "Nicholas J" → `nicholas-j`, `nicholas-j-2`); slug stability across calls; code single-use (second `takeCode` fails); refresh rotate invalidates old.
- [ ] Implement → GREEN → gates → commit `Add global Registry durable object for profiles and OAuth state`.

### Task 3: Auth HTTP routes

**Files:**
- Modify: `workers/routes.ts` (add `handleAuth(request, deps): Promise<Response|null>` covering GET /auth/config, POST /auth/google, GET /auth/me, POST /auth/logout), `workers/app.ts` (wire before React Router, after redirects)
- Test: extend `tests/unit/agents/worker-routes.test.ts`

Deps injected: `{ secret, googleClientId, verifyGoogle, registry: { upsertProfile, getProfile } }`. `POST /auth/google`: same-origin check → verify credential → upsertProfile → mint 30-day session → Set-Cookie + JSON `{ principal, displayName }`. `/auth/me`: session or `{ signedIn: false }`. Logout clears cookie (Max-Age=0).

- [ ] Failing tests (fake deps): config returns client id; google happy path sets `vp_session` cookie with HttpOnly/SameSite=Lax; cross-origin POST → 403; bad credential → 401; me with/without cookie; logout clears.
- [ ] Implement → GREEN → gates → commit `Add auth routes for Google sign-in sessions`.

### Task 4: OAuth 2.1 authorization server

**Files:**
- Create: `workers/oauth.ts` (port of subpixel `server/oauth.ts`), `app/lib/oauth-pages.ts` (consent HTML: client name, GSI sign-in when no session, capability radio — "Suggest & comment" checked / "Full write"; reuse mcp-help.ts styling + origin validation)
- Modify: `workers/app.ts` (route `/oauth/*` + the two `/.well-known/oauth-*` documents)
- Test: `tests/unit/agents/oauth.test.ts` (injected registry/auth fakes)

Port faithfully: PKCE S256 required; dynamic client registration (`POST /oauth/register`); auth code 10-min TTL single-use; access token = 1h session JWT with `caps` claim; refresh rotation; `POST /oauth/revoke`. Discovery docs advertise issuer `https://vapor.fyi`, endpoints, `code` + `refresh_token` grants, S256. Consent POST requires a valid web session (the GSI flow on the page creates one) and writes the chosen caps into the code record.

- [ ] Failing tests: register → client id; authorize without session → page contains GSI; full code+PKCE exchange (fixture session) → access token whose claims carry principal + chosen caps; wrong verifier → error; code reuse → error; refresh rotates; revoke kills refresh; discovery JSON shapes.
- [ ] Implement → GREEN → gates → commit `Add OAuth 2.1 authorization server for MCP clients`.

### Task 5: DocumentAgent speaks identity, tokens die

**Files:**
- Modify: `agents/document.ts`, `app/shared/agent-protocol.ts` (remove token-only types if any), delete `app/lib/agent-tokens.ts`
- Test: rewrite affected blocks of `tests/integration/agents/document-agent.test.ts`, delete `tests/unit/lib/agent-tokens.test.ts`

Every `agent*` RPC's first parameter becomes `identity: AgentIdentity` (already verified upstream — DocumentAgent trusts VaporMcp/DO-RPC callers; validate shape defensively, `invalid_token` code renamed usage → keep code for malformed identity). Enrollment: `ensureRosterEntry(identity)` creates/reuses a roster row `{ name, color, owner, capabilities, created_at, last_seen_at }` — name collision for a DIFFERENT identity id gets suffixed (registry-independent, per-doc). Delete: `agent_tokens` table + hashing + mint/verify/revoke-token RPCs (`revokeAgentEntry(name)` replaces revoke, removing roster row + severing presence). Rate limits: keyed `identity.id` in a `rate_limits` roster column. `exportMarkdown`, events, performance engine, presence: unchanged except plumbing.

- [ ] Rewrite tests first (RED): mutations gated by `identity.caps`; anonymous identity gets DEFAULT_CAPABILITIES enforcement upstream (DocumentAgent honors whatever caps arrive); owner lands in roster; rate limit keyed per identity; alarm purges roster + rate state; thread_reply/mention events keyed by roster name still work.
- [ ] Implement → GREEN → gates → commit `Replace per-doc tokens with verified identity in DocumentAgent`.

### Task 6: VaporMcp — two doors

**Files:**
- Modify: `agents/mcp.ts`, `agents/mcp-tools.ts` (ToolDeps carries `identity` not token), `agents/mcp-anonymous.ts` (rename semantics: session-held identity, no tokens), `workers/app.ts`
- Test: `tests/unit/agents/mcp-tools.test.ts`, `tests/unit/agents/mcp-anonymous.test.ts` updates; new `tests/unit/agents/mcp-door.test.ts` for the 401 challenge builder

Routing in `workers/app.ts`: `/mcp/anonymous` → serve with `props = { auth: { kind: "anonymous" } }`; `/mcp` → verify bearer as session JWT (`verifySessionToken`); valid → `props = { auth: { kind: "principal", claims } }`; missing/invalid → `401` with `WWW-Authenticate: Bearer resource_metadata="https://vapor.fyi/.well-known/oauth-protected-resource"` (exact header per MCP auth spec — verify against the installed SDK's expectations). VaporMcp builds `AgentIdentity`: principal path pulls `agentSlug` via Registry (`ensureAgentSlug`, cached in session state) with `owner = principal`, `caps` from claims; anonymous path keeps clientInfo slug, `owner: null`, DEFAULT_CAPABILITIES. `create_document` returns `{ id, url }` only and enrolls the caller. Help page reachable on both doors' GET-with-Accept-html.

- [ ] Failing tests → implement → GREEN → gates → commit `Gate /mcp behind OAuth and move tokenless access to /mcp/anonymous`.

### Task 7: Connection panel replaces the mint dialog

**Files:**
- Modify: `app/components/InviteAgentDialog.tsx` (rename file/content to `AgentsPanel.tsx` if cleaner — panel shows the two connect commands + roster with revoke), `app/routes/doc.$id.agents.ts` (GET roster + `{ intent: "revoke", name }` only; mint intent removed → 410), header menu label ("Agents")
- Test: update `tests/unit/components/*`, `tests/unit/routes/doc-agents-route.test.ts`

- [ ] Failing tests → implement → GREEN → gates → commit `Replace token minting UI with agents connection panel`.

### Task 8: Web sign-in UI

**Files:**
- Create: `app/components/SignIn.tsx` (header affordance: signed-out → "Sign in" popover loading GSI script with client id from `/auth/config`; signed-in → displayName + sign-out)
- Modify: doc header composition; `app/lib/useYjsEditor.ts` or the awareness-name source (`user.name` = displayName when `/auth/me` says signed in); comment author name likewise
- Test: `tests/unit/components/SignIn.test.tsx` (mock fetch: signed-out renders button, signed-in renders name + sign-out posts logout); a unit test that the awareness name prefers the session displayName

GSI script loads only when the popover opens (not on every doc view). Anonymous users: zero change.

- [ ] Failing tests → implement → GREEN → gates → commit `Add Google sign-in to the doc header`.

### Task 9: Docs, help page, config

**Files:**
- Modify: `app/lib/mcp-help.ts` (two doors, signed-in first), `README.md`, `CLAUDE.md` (identity architecture note; spec pointer), `wrangler.jsonc` (GOOGLE_CLIENT_ID var placeholder), `.dev.vars.example`
- Test: update mcp-help tests

- [ ] Update → gates → commit `Document the identity model and two MCP doors`.

### Task 10: Live acceptance

- [ ] `SESSION_SECRET`: generate (`openssl rand -base64 32`) → `wrangler secret put` (controller does this at deploy time, not in CI).
- [ ] With the user-supplied `GOOGLE_CLIENT_ID`: `npm run dev`; sign in on web (name appears in presence); OAuth flow end-to-end with curl (register client → authorize w/ session cookie → code+PKCE → token → `/mcp` tool call lands as agentSlug with owner); `/mcp/anonymous` regression; bare `/mcp` returns the 401 challenge shape.
- [ ] Record transcript in the task report. Deploy only on explicit go-ahead.

## Self-review notes
- Spec coverage: auth core (T1), Registry (T2), auth routes (T3), OAuth AS + consent caps (T4), token retirement + identity RPCs (T5), doors + counterpart enrollment (T6), UI panel (T7), web sign-in + presence attribution (T8), docs/config (T9), acceptance (T10).
- Deliberate scope note: `revokeGrant` in T2 covers `/oauth/revoke`; per-doc severing is T5's `revokeAgentEntry`. Anonymous rate-limit identity id = the MCP session id (stable per session), stated here so T5/T6 agree.
- Ordering: T5 and T6 are coupled (RPC signature change) — execute sequentially, never in parallel.
