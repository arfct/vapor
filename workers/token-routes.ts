/**
 * `/me/tokens` — a signed-in person's personal access tokens (#85): list,
 * mint (the token is shown once), revoke. Same-origin, cookie session.
 * Pure: the Registry is behind `deps`, so this unit-tests without
 * `cloudflare:` imports.
 */
import { sameOrigin, sessionFromRequest } from "../app/lib/auth.server";
import { validateTokenRequest, type AccessTokenView } from "../app/shared/token-policy";
import type { AgentCapability } from "../app/shared/agent-protocol";

export interface TokenRouteDeps {
  /** SESSION_SECRET, for the cookie. */
  secret: string;
  list(principal: string): Promise<{ tokens: AccessTokenView[] }>;
  create(input: {
    principal: string;
    email: string;
    caps: AgentCapability[];
    label: string;
  }): Promise<{ token: string; view: AccessTokenView } | { error: { code: string; message: string } }>;
  revoke(principal: string, id: string): Promise<{ ok: true }>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function handleTokenRoutes(request: Request, deps: TokenRouteDeps): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/me/tokens") return null;

  const session = await sessionFromRequest(request, deps.secret);
  if (!session) return json({ error: "sign_in_required" }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) {
    return json({ error: "cross-origin request rejected" }, 403);
  }
  const principal = session.principal;

  if (request.method === "GET") return json(await deps.list(principal));

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    const checked = validateTokenRequest(body);
    if ("error" in checked) return json({ error: checked.error }, 400);
    const result = await deps.create({ principal, email: session.email, caps: checked.caps, label: checked.label });
    if ("error" in result) return json({ error: result.error.message }, 429);
    return json(result, 201);
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id") ?? "";
    if (!/^[0-9a-f]{12}$/.test(id)) return json({ error: "id required" }, 400);
    return json(await deps.revoke(principal, id));
  }

  return json({ error: "method not allowed" }, 405);
}
