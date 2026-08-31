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
  type SessionClaims,
} from "../app/lib/auth.server";
import { consentPageHtml } from "../app/lib/oauth-pages";
import { DEFAULT_CAPABILITIES } from "../app/shared/agent-protocol";
import type { AgentCapability } from "../app/shared/agent-protocol";
import type { AuthCode, OAuthClient, RefreshGrant } from "../agents/registry";

export interface OAuthRegistry {
  registerClient(info: { name: string; redirectUris: string[] }): Promise<{ client: OAuthClient }>;
  getClient(clientId: string): Promise<{ client: OAuthClient | null }>;
  putCode(data: Omit<AuthCode, "exp">): Promise<{ code: string }>;
  takeCode(code: string): Promise<{ data: AuthCode | null }>;
  putRefresh(data: Omit<RefreshGrant, "exp">): Promise<{ token: string }>;
  rotateRefresh(
    oldToken: string,
  ): Promise<{ token: string; data: RefreshGrant } | { error: { code: string; message: string } }>;
  revokeRefresh(token: string): Promise<{ ok: true }>;
}

export interface OAuthDeps {
  secret: string;
  registry: OAuthRegistry;
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

// https redirects only; localhost/127.0.0.1 excepted for native + dev clients
function validRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 512) return false;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  return (
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
  );
}

function oauthError(status: number, error: string, description: string): Response {
  return Response.json({ error, error_description: description }, { status });
}

function serverMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [],
    service_documentation: `${origin}/mcp`,
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
  const { client } = clientId
    ? await deps.registry.getClient(clientId)
    : { client: null };
  if (!client) {
    return consentResponse({ clientName: "unknown", email: null, params: {}, error: "unknown client_id" });
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return consentResponse({
      clientName: client.name,
      email: null,
      params: {},
      error: "redirect_uri is not registered for this client",
    });
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

async function handleToken(request: Request, deps: OAuthDeps): Promise<Response> {
  const params = new URLSearchParams(await request.text());
  const grantType = params.get("grant_type");

  if (grantType === "authorization_code") {
    const code = params.get("code") ?? "";
    const verifier = params.get("code_verifier") ?? "";
    const { data } = code ? await deps.registry.takeCode(code) : { data: null };
    if (!data) return oauthError(400, "invalid_grant", "unknown, expired, or already-used code");
    if (data.clientId !== params.get("client_id") || data.redirectUri !== params.get("redirect_uri")) {
      return oauthError(400, "invalid_grant", "code is bound to a different client or redirect_uri");
    }
    if (!verifier || (await sha256Base64Url(verifier)) !== data.codeChallenge) {
      return oauthError(400, "invalid_grant", "PKCE verification failed");
    }
    return mintTokens(deps, data);
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
    if (path === "/oauth/revoke" && request.method === "POST") {
      return withCors(await handleRevoke(request, deps));
    }
  }
  return null;
}
