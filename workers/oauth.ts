/**
 * A minimal OAuth 2.1 authorization server so any MCP client can connect to
 * /mcp with the user's own identity. Ported from subpixel server/oauth.ts:
 *   - access tokens ARE vapor's HMAC session JWTs (1h TTL, carrying the
 *     granted capabilities), verified by the same code path everywhere;
 *   - clients, single-use codes, and rotating hashed refresh tokens live in
 *     the Registry DO;
 *   - public clients only: PKCE S256 required, no client secrets.
 * Dependency-injected (no `agents` package import) so it unit-tests in
 * plain Vitest; workers/app.ts supplies the Registry stub.
 */
import {
  mintSessionToken,
  sessionFromRequest,
  verifySessionToken,
  type SessionClaims,
} from "../app/lib/auth.server";
import { consentPageHtml } from "../app/lib/oauth-pages";
import { DEFAULT_CAPABILITIES } from "../app/shared/agent-protocol";
import type { AgentCapability } from "../app/shared/agent-protocol";
import type { AuthCode, OAuthClient, RefreshGrant, TokenReplay } from "../agents/registry";

export interface OAuthRegistry {
  registerClient(info: { name: string; redirectUris: string[] }): Promise<{ client: OAuthClient }>;
  getClient(clientId: string): Promise<{ client: OAuthClient | null }>;
  putCode(data: Omit<AuthCode, "exp">): Promise<{ code: string }>;
  peekCode(code: string): Promise<{ data: AuthCode | null }>;
  takeCode(code: string): Promise<{ data: AuthCode | null }>;
  putReplay(code: string, data: Omit<TokenReplay, "exp">): Promise<{ ok: true }>;
  getReplay(code: string): Promise<{ data: TokenReplay | null }>;
  putRefresh(data: Omit<RefreshGrant, "exp">): Promise<{ token: string }>;
  rotateRefresh(
    oldToken: string,
  ): Promise<{ token: string; data: RefreshGrant } | { error: { code: string; message: string } }>;
  revokeRefresh(token: string): Promise<{ ok: true }>;
}

export interface OAuthDeps {
  secret: string;
  registry: OAuthRegistry;
  /** Resolves a personal access token to its grant, when the deployment issues them. */
  lookupAccessToken?: (token: string) => Promise<{ grant: { principal: string; email: string } | null }>;
  /** The display name behind a principal, for `name` in userinfo. */
  displayName?: (principal: string) => Promise<string | null>;
}

const ACCESS_TTL_SECONDS = 60 * 60;
const MAX_CLIENT_NAME = 64;
const MAX_REDIRECT_URIS = 8;

const WRITE_CAPS: AgentCapability[] = ["suggest", "comment", "write"];

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Loopback hosts, as URL.hostname renders them (IPv6 keeps its brackets). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopback(parsed: URL): boolean {
  return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
}

// https redirects only; loopback (localhost, 127.0.0.1, [::1]) excepted for native + dev clients
function validRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 512) return false;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  return isLoopback(parsed);
}

/**
 * Whether a requested redirect_uri is covered by a registered one. Exact
 * match, except that a loopback URI matches on any port: native clients
 * bind an ephemeral port at request time, and RFC 8252 §7.3 requires the
 * server to accept it (#79). A registered loopback URI with no port covers
 * every port; scheme, host, path, and query must still agree.
 */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(requested);
  } catch {
    return false;
  }
  if (!isLoopback(a) || !isLoopback(b)) return false;
  return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
}

/** Whether the caller is a browser that should see an HTML page rather than an OAuth JSON error. */
function wantsHtml(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").includes("text/html");
}

function oauthError(status: number, error: string, description: string): Response {
  return Response.json({ error, error_description: description }, { status });
}

/**
 * Resolves a `client_id` to a client record. Two shapes are supported:
 *   - a DCR client id (opaque string) → looked up in the Registry;
 *   - a Client ID Metadata Document URL (CIMD, an https URL) → the document
 *     is fetched and its `redirect_uris`/`client_name` used directly, with
 *     no stored registration. This is what "Use Anthropic's hosted client
 *     metadata" needs. The document is cached via the Cache API.
 * Returns null when the id is unknown or the metadata is unusable.
 */
async function resolveClient(
  clientId: string,
  deps: OAuthDeps,
): Promise<OAuthClient | null> {
  if (!clientId) return null;
  if (!/^https:\/\//i.test(clientId)) {
    const { client } = await deps.registry.getClient(clientId);
    return client;
  }

  // CIMD: the client_id is itself the metadata URL.
  const cache = typeof caches !== "undefined" ? (caches as CacheStorage & { default: Cache }).default : undefined;
  const req = new Request(clientId, { headers: { Accept: "application/json" } });
  let res = await cache?.match(req);
  if (!res) {
    try {
      res = await fetch(req);
    } catch {
      return null;
    }
    if (!res.ok) return null;
    if (cache) await cache.put(req, res.clone());
  }

  let meta: Record<string, unknown>;
  try {
    meta = (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
  // The document must declare itself as this exact client_id and list valid
  // redirect URIs — otherwise it can't be trusted to authorize a redirect.
  if (typeof meta.client_id === "string" && meta.client_id !== clientId) return null;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every(validRedirectUri)) return null;

  return {
    clientId,
    name: typeof meta.client_name === "string" ? meta.client_name.slice(0, MAX_CLIENT_NAME) : clientId,
    redirectUris: uris as string[],
    createdAt: 0,
  };
}

function serverMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    // Who a token belongs to, for clients that ask (ChatGPT's plugin review does; #103).
    userinfo_endpoint: `${origin}/oauth/userinfo`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [],
    service_documentation: `${origin}/mcp`,
    // Accept a Client ID Metadata Document URL as the client_id (CIMD),
    // in addition to dynamically-registered ids.
    client_id_metadata_document_supported: true,
  };
}

function consentResponse(opts: Parameters<typeof consentPageHtml>[0]): Response {
  return new Response(consentPageHtml(opts), {
    status: opts.error ? 400 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handleRegister(request: Request, deps: OAuthDeps): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return oauthError(400, "invalid_client_metadata", "body must be JSON");
  }
  const uris: unknown = body?.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > MAX_REDIRECT_URIS ||
    !uris.every(validRedirectUri)
  ) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must be https (or localhost) URLs");
  }
  const name =
    typeof body.client_name === "string" ? body.client_name.slice(0, MAX_CLIENT_NAME) : "an MCP client";
  const { client } = await deps.registry.registerClient({ name, redirectUris: uris as string[] });
  return Response.json(
    {
      client_id: client.clientId,
      redirect_uris: uris,
      client_name: name,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}

// Validation order matters: an unknown client or unregistered redirect must
// NEVER redirect (that would be an open redirector); every later error DOES
// redirect with ?error= per RFC 6749.
function redirectWith(redirectUri: string, extra: Record<string, string>, state: string | null): Response {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  if (state) url.searchParams.set("state", state);
  return Response.redirect(url.toString(), 302);
}

async function handleAuthorize(request: Request, deps: OAuthDeps): Promise<Response> {
  const url = new URL(request.url);
  const params =
    request.method === "POST" ? new URLSearchParams(await request.text()) : url.searchParams;

  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  // Neither of these may redirect (open redirector), so the answer is a
  // page for a browser and an OAuth error for anything else — and in both
  // cases it says what was received and what would have been accepted, so
  // a client can see which side of the mismatch it is on (#80).
  const refuse = (clientName: string, detail: string): Response =>
    wantsHtml(request)
      ? consentResponse({ clientName, email: null, params: {}, error: detail })
      : oauthError(400, "invalid_request", detail);
  const client = await resolveClient(clientId, deps);
  if (!client) {
    return refuse("unknown", `unknown client_id: ${clientId || "(none)"}`);
  }
  if (!client.redirectUris.some((registered) => redirectUriMatches(registered, redirectUri))) {
    return refuse(
      client.name,
      `redirect_uri ${redirectUri || "(none)"} is not registered for this client; registered: ${client.redirectUris.join(", ")} (loopback URIs match on any port)`,
    );
  }

  const state = params.get("state");
  if (params.get("response_type") !== "code") {
    return redirectWith(redirectUri, { error: "unsupported_response_type" }, state);
  }
  const codeChallenge = params.get("code_challenge") ?? "";
  if (
    !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge) ||
    (params.get("code_challenge_method") ?? "S256") !== "S256"
  ) {
    return redirectWith(
      redirectUri,
      { error: "invalid_request", error_description: "PKCE S256 is required" },
      state,
    );
  }

  const session = await sessionFromRequest(request, deps.secret);
  const passthrough: Record<string, string> = {};
  for (const key of [
    "client_id",
    "redirect_uri",
    "response_type",
    "code_challenge",
    "code_challenge_method",
    "state",
    "scope",
  ]) {
    const v = params.get(key);
    if (v !== null) passthrough[key] = v;
  }

  if (!session) {
    return consentResponse({ clientName: client.name, email: null, params: passthrough });
  }
  if (request.method === "GET") {
    return consentResponse({ clientName: client.name, email: session.email, params: passthrough });
  }

  // POST with a live session: the decision (same-origin form + SameSite
  // cookie makes cross-site forgery a non-starter)
  if (params.get("decision") !== "approve") {
    return redirectWith(redirectUri, { error: "access_denied" }, state);
  }
  const caps: AgentCapability[] =
    params.get("caps") === "write" ? WRITE_CAPS : [...DEFAULT_CAPABILITIES];
  const { code } = await deps.registry.putCode({
    principal: session.principal,
    email: session.email,
    caps,
    clientId,
    redirectUri,
    codeChallenge,
  });
  return redirectWith(redirectUri, { code }, state);
}

async function mintTokens(
  deps: OAuthDeps,
  grant: { principal: string; email: string; caps: AgentCapability[]; clientId: string },
): Promise<Response> {
  const accessToken = await mintSessionToken(
    { principal: grant.principal, email: grant.email, caps: grant.caps } as Omit<
      SessionClaims,
      "iat" | "exp"
    >,
    deps.secret,
    ACCESS_TTL_SECONDS,
  );
  const { token: refreshToken } = await deps.registry.putRefresh({
    principal: grant.principal,
    email: grant.email,
    caps: grant.caps,
    clientId: grant.clientId,
  });
  return Response.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: "",
  });
}

async function handleUserinfo(request: Request, deps: OAuthDeps): Promise<Response> {
  const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const unauthorized = () =>
    new Response(JSON.stringify({ error: "invalid_token" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer error="invalid_token"' },
    });
  if (!bearer) return unauthorized();
  let identity: { principal: string; email: string } | null = null;
  if (bearer.startsWith("vpt_") && deps.lookupAccessToken) {
    identity = (await deps.lookupAccessToken(bearer)).grant;
  } else {
    const claims = await verifySessionToken(bearer, deps.secret);
    identity = claims ? { principal: claims.principal, email: claims.email } : null;
  }
  if (!identity) return unauthorized();
  const name = deps.displayName ? await deps.displayName(identity.principal) : null;
  return Response.json({
    sub: identity.principal,
    email: identity.email,
    email_verified: true,
    ...(name ? { name } : {}),
  });
}

async function handleToken(request: Request, deps: OAuthDeps): Promise<Response> {
  const params = new URLSearchParams(await request.text());
  const grantType = params.get("grant_type");

  if (grantType === "authorization_code") {
    const code = params.get("code") ?? "";
    const verifier = params.get("code_verifier") ?? "";
    if (!code) return oauthError(400, "invalid_grant", "code is required");
    const verifierHash = verifier ? await sha256Base64Url(verifier) : "";

    // A retry after a dropped response: the same code and verifier from the
    // same client get the same tokens for a minute (#78). Anyone else
    // presenting a spent code is refused like before.
    const replayFor = async (): Promise<Response | null> => {
      const { data: replay } = await deps.registry.getReplay(code);
      if (!replay) return null;
      if (replay.clientId !== params.get("client_id") || verifierHash !== replay.codeChallenge) {
        return oauthError(400, "invalid_grant", "unknown, expired, or already-used code");
      }
      return new Response(replay.body, { headers: { "Content-Type": "application/json" } });
    };
    const replayed = await replayFor();
    if (replayed) return replayed;

    // Validate against the stored code *before* spending it, so a client's
    // slip (wrong client_id, redirect_uri, or verifier) leaves the code
    // usable for a corrected retry rather than sending the person back
    // through the browser (#78).
    const { data } = await deps.registry.peekCode(code);
    if (!data) return oauthError(400, "invalid_grant", "unknown, expired, or already-used code");
    if (data.clientId !== params.get("client_id")) {
      return oauthError(400, "invalid_grant", "code is bound to a different client");
    }
    const redirectUri = params.get("redirect_uri");
    if (redirectUri !== null && !redirectUriMatches(data.redirectUri, redirectUri)) {
      return oauthError(400, "invalid_grant", "code is bound to a different redirect_uri");
    }
    if (!verifier || verifierHash !== data.codeChallenge) {
      return oauthError(400, "invalid_grant", "PKCE verification failed");
    }

    // Spend it. Losing the race to a concurrent exchange of the same code
    // means the other request is minting; hand back its response if it has
    // landed, else the usual refusal.
    const taken = await deps.registry.takeCode(code);
    if (!taken.data) {
      return (await replayFor()) ?? oauthError(400, "invalid_grant", "unknown, expired, or already-used code");
    }
    const response = await mintTokens(deps, taken.data);
    const body = await response.clone().text();
    await deps.registry.putReplay(code, { clientId: taken.data.clientId, codeChallenge: taken.data.codeChallenge, body });
    return response;
  }

  if (grantType === "refresh_token") {
    const token = params.get("refresh_token") ?? "";
    const rotated = token ? await deps.registry.rotateRefresh(token) : null;
    if (!rotated || "error" in rotated) {
      return oauthError(400, "invalid_grant", "refresh token is unknown, expired, or revoked");
    }
    // rotateRefresh already issued the replacement; hand it out with a
    // fresh access token for the same grant.
    const accessToken = await mintSessionToken(
      {
        principal: rotated.data.principal,
        email: rotated.data.email,
        caps: rotated.data.caps,
      } as Omit<SessionClaims, "iat" | "exp">,
      deps.secret,
      ACCESS_TTL_SECONDS,
    );
    return Response.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: rotated.token,
      scope: "",
    });
  }

  return oauthError(400, "unsupported_grant_type", "use authorization_code or refresh_token");
}

async function handleRevoke(request: Request, deps: OAuthDeps): Promise<Response> {
  const params = new URLSearchParams(await request.text());
  const token = params.get("token") ?? "";
  if (token) await deps.registry.revokeRefresh(token);
  return new Response(null, { status: 200 }); // RFC 7009: always succeed
}

// OAuth endpoints and discovery docs are fetched cross-origin by MCP
// clients' web frontends (claude.ai does registration + token exchange from
// the browser) — without CORS the flow fails silently after consent.
export const OAUTH_CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version, mcp-session-id",
  "access-control-max-age": "86400",
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(OAUTH_CORS)) out.headers.set(k, v);
  return out;
}

export async function handleOAuth(request: Request, deps: OAuthDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const origin = url.origin;

  // Discovery is path-aware (RFC 8414 / MCP auth spec): a client connecting
  // to <origin>/mcp asks for /.well-known/oauth-protected-resource/mcp and
  // expects `resource` to equal that exact endpoint URL. Serve the bare
  // documents and any path-suffixed variant of them.
  const wellKnown = path.match(
    /^\/\.well-known\/(oauth-authorization-server|oauth-protected-resource)(\/.*)?$/,
  );
  if (wellKnown) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: OAUTH_CORS });
    const [, doc, suffix] = wellKnown;
    if (doc === "oauth-authorization-server") return withCors(Response.json(serverMetadata(origin)));
    return withCors(
      Response.json({
        resource: origin + (suffix ?? ""),
        authorization_servers: [origin],
        bearer_methods_supported: ["header"],
      }),
    );
  }

  if (path.startsWith("/oauth/")) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: OAUTH_CORS });
    if (path === "/oauth/register" && request.method === "POST") {
      return withCors(await handleRegister(request, deps));
    }
    if (path === "/oauth/authorize" && (request.method === "GET" || request.method === "POST")) {
      return handleAuthorize(request, deps); // top-level navigation, no CORS needed
    }
    if (path === "/oauth/token" && request.method === "POST") {
      return withCors(await handleToken(request, deps));
    }
    // OpenID-style UserInfo (#103): the bearer's identity. `sub` is the
    // principal (an opaque provider-keyed id, never an email), `email` the
    // verified address the provider gave us. Session JWTs and vpt_ tokens both.
    if (path === "/oauth/userinfo" && (request.method === "GET" || request.method === "POST")) {
      return withCors(await handleUserinfo(request, deps));
    }
    if (path === "/oauth/revoke" && request.method === "POST") {
      return withCors(await handleRevoke(request, deps));
    }
  }
  return null;
}
