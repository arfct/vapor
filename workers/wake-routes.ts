/**
 * `/me/wake` — a signed-in person's wake target: how vapor wakes their agent
 * when it is mentioned or replied to (docs/plans/2026-09-06-agent-wake-plan.md).
 * Same-origin, cookie session. Pure: the Registry is behind `deps`, so this
 * is unit-testable without `cloudflare:` imports.
 */
import { sameOrigin, sessionFromRequest } from "../app/lib/auth.server";
import type { WakeEvent, WakeTargetView } from "../app/shared/wake-policy";

export type WakeOutcome =
  | { fired: true; status: number }
  | { fired: false; reason: "no_target" | "throttled" | "daily_cap" | "unsealable" | "delivery"; status?: number; error?: string };

export interface WakeRouteDeps {
  /** SESSION_SECRET, for the cookie. */
  secret: string;
  /** The principal's counterpart agent slug, as it appears in rosters. */
  agentNameFor(principal: string): Promise<string>;
  getTarget(principal: string): Promise<{ target: WakeTargetView | null }>;
  setTarget(
    principal: string,
    input: unknown,
  ): Promise<{ target: WakeTargetView } | { error: { code: string; message: string } }>;
  deleteTarget(principal: string): Promise<{ ok: true }>;
  wake(args: { principal: string; event: WakeEvent; origin?: string }): Promise<WakeOutcome>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function handleWakeRoutes(request: Request, deps: WakeRouteDeps): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/me/wake" && url.pathname !== "/me/wake/test") return null;

  const session = await sessionFromRequest(request, deps.secret);
  if (!session) return json({ error: "sign_in_required" }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) {
    return json({ error: "cross-origin request rejected" }, 403);
  }
  const principal = session.principal;

  if (url.pathname === "/me/wake") {
    if (request.method === "GET") return json(await deps.getTarget(principal));

    if (request.method === "PUT") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      const result = await deps.setTarget(principal, body);
      if ("error" in result) return json({ error: result.error.message }, 400);
      return json(result);
    }

    if (request.method === "DELETE") return json(await deps.deleteTarget(principal));
    return json({ error: "method not allowed" }, 405);
  }

  // /me/wake/test
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const agent = await deps.agentNameFor(principal);
  const now = Date.now();
  const outcome = await deps.wake({
    principal,
    origin: url.origin,
    event: {
      name: "test",
      docId: "test",
      agent,
      timestamp: new Date(now).toISOString(),
      eventId: `test:${now}`,
    },
  });
  return json({ ...outcome, target: (await deps.getTarget(principal)).target });
}
