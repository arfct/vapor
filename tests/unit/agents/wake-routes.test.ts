import { describe, it, expect, vi } from "vitest";
import { handleWakeRoutes, type WakeRouteDeps } from "../../../workers/wake-routes";
import { mintSessionToken } from "~/lib/auth.server";
import type { WakeTargetView } from "~/shared/wake-policy";

const SECRET = "test-session-secret";
const ORIGIN = "https://vapor.fyi";

const view: WakeTargetView = {
  kind: "claude-routine",
  url: "https://api.anthropic.com/v1/claude_code/routines/trig_abc/fire",
  secretHint: "…mnop",
  createdAt: 1,
  updatedAt: 1,
  lastFiredAt: null,
  lastStatus: null,
  lastError: null,
  firesToday: 0,
};

function deps(over: Partial<WakeRouteDeps> = {}): WakeRouteDeps {
  return {
    secret: SECRET,
    agentNameFor: vi.fn(async () => "ada-l"),
    getTarget: vi.fn(async () => ({ target: view })),
    setTarget: vi.fn(async () => ({ target: view })),
    deleteTarget: vi.fn(async () => ({ ok: true as const })),
    wake: vi.fn(async () => ({ fired: true as const, status: 200 })),
    ...over,
  };
}

async function signedIn(path: string, init: RequestInit = {}, sameOrigin = true): Promise<Request> {
  const token = await mintSessionToken({ principal: "email:ada@example.com", email: "ada@example.com" }, SECRET);
  const headers = new Headers(init.headers);
  headers.set("Cookie", `vp_session=${token}`);
  if (sameOrigin) headers.set("Origin", ORIGIN);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

describe("handleWakeRoutes", () => {
  it("ignores other paths", async () => {
    expect(await handleWakeRoutes(new Request(`${ORIGIN}/me/other`), deps())).toBeNull();
  });

  it("requires a session", async () => {
    const res = await handleWakeRoutes(new Request(`${ORIGIN}/me/wake`), deps());
    expect(res!.status).toBe(401);
  });

  it("returns the owner's target on GET", async () => {
    const d = deps();
    const res = await handleWakeRoutes(await signedIn("/me/wake"), d);
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ target: view });
    expect(d.getTarget).toHaveBeenCalledWith("email:ada@example.com");
  });

  it("rejects writes from another origin", async () => {
    const d = deps();
    const res = await handleWakeRoutes(
      await signedIn("/me/wake", { method: "PUT", body: "{}" }, false),
      d,
    );
    expect(res!.status).toBe(403);
    expect(d.setTarget).not.toHaveBeenCalled();
  });

  it("sets a target on PUT and surfaces validation errors as 400", async () => {
    const d = deps();
    const body = JSON.stringify({ kind: "claude-routine", url: view.url, secret: "sk-ant-oat01-abcdefghijklmnop" });
    const ok = await handleWakeRoutes(await signedIn("/me/wake", { method: "PUT", body }), d);
    expect(ok!.status).toBe(200);
    expect(d.setTarget).toHaveBeenCalledWith("email:ada@example.com", JSON.parse(body), ORIGIN);

    const bad = await handleWakeRoutes(
      await signedIn("/me/wake", { method: "PUT", body }),
      deps({ setTarget: vi.fn(async () => ({ error: { code: "invalid_params", message: "Token should start with sk-ant-oat01-" } })) }),
    );
    expect(bad!.status).toBe(400);
    expect(await bad!.json()).toEqual({ error: "Token should start with sk-ant-oat01-" });

    const garbage = await handleWakeRoutes(await signedIn("/me/wake", { method: "PUT", body: "{nope" }), d);
    expect(garbage!.status).toBe(400);
  });

  it("deletes on DELETE", async () => {
    const d = deps();
    const res = await handleWakeRoutes(await signedIn("/me/wake", { method: "DELETE" }), d);
    expect(await res!.json()).toEqual({ ok: true });
    expect(d.deleteTarget).toHaveBeenCalledWith("email:ada@example.com");
  });

  it("fires a test event addressed to the owner's agent and reports the outcome with the target", async () => {
    const d = deps();
    const res = await handleWakeRoutes(await signedIn("/me/wake/test", { method: "POST" }), d);
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ fired: true, status: 200, target: view });
    const call = (d.wake as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.principal).toBe("email:ada@example.com");
    expect(call.origin).toBe(ORIGIN);
    expect(call.event).toMatchObject({ name: "test", agent: "ada-l", docId: "test" });
  });

  it("only POST is allowed on the test route", async () => {
    const res = await handleWakeRoutes(await signedIn("/me/wake/test"), deps());
    expect(res!.status).toBe(405);
  });
});
