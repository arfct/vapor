import { describe, it, expect, vi } from "vitest";
import { handleTokenRoutes, type TokenRouteDeps } from "../../../workers/token-routes";
import { mintSessionToken } from "~/lib/auth.server";
import type { AccessTokenView } from "~/shared/token-policy";

const SECRET = "test-session-secret";
const ORIGIN = "https://vapor.example";

const view: AccessTokenView = { id: "abcdef012345", label: "build box", caps: ["suggest", "comment"], createdAt: 1, lastUsedAt: null, hint: "wxyz" };

function deps(over: Partial<TokenRouteDeps> = {}): TokenRouteDeps {
  return {
    secret: SECRET,
    list: vi.fn(async () => ({ tokens: [view] })),
    create: vi.fn(async () => ({ token: "vpt_secret", view })),
    revoke: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
}

async function signedIn(path: string, init: RequestInit = {}, sameOrigin = true): Promise<Request> {
  const token = await mintSessionToken({ principal: "google:1", email: "ada@example.com" }, SECRET);
  const headers = new Headers(init.headers);
  headers.set("Cookie", `vp_session=${token}`);
  if (sameOrigin) headers.set("Origin", ORIGIN);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

describe("handleTokenRoutes", () => {
  it("ignores other paths and requires a session", async () => {
    expect(await handleTokenRoutes(new Request(`${ORIGIN}/me/other`), deps())).toBeNull();
    expect((await handleTokenRoutes(new Request(`${ORIGIN}/me/tokens`), deps()))!.status).toBe(401);
  });

  it("lists the owner's tokens", async () => {
    const d = deps();
    const res = await handleTokenRoutes(await signedIn("/me/tokens"), d);
    expect(await res!.json()).toEqual({ tokens: [view] });
    expect(d.list).toHaveBeenCalledWith("google:1");
  });

  it("mints with a label and grant, returning the token once; rejects bad input and cross-origin", async () => {
    const d = deps();
    const res = await handleTokenRoutes(
      await signedIn("/me/tokens", { method: "POST", body: JSON.stringify({ label: " build box ", grant: "write" }) }),
      d,
    );
    expect(res!.status).toBe(201);
    expect(await res!.json()).toEqual({ token: "vpt_secret", view });
    expect(d.create).toHaveBeenCalledWith({
      principal: "google:1",
      email: "ada@example.com",
      caps: ["suggest", "comment", "write"],
      label: "build box",
    });

    const noLabel = await handleTokenRoutes(await signedIn("/me/tokens", { method: "POST", body: JSON.stringify({ grant: "write" }) }), deps());
    expect(noLabel!.status).toBe(400);
    const badGrant = await handleTokenRoutes(await signedIn("/me/tokens", { method: "POST", body: JSON.stringify({ label: "x", grant: "admin" }) }), deps());
    expect(badGrant!.status).toBe(400);
    const crossOrigin = await handleTokenRoutes(
      await signedIn("/me/tokens", { method: "POST", body: JSON.stringify({ label: "x", grant: "suggest" }) }, false),
      deps(),
    );
    expect(crossOrigin!.status).toBe(403);
    const capped = await handleTokenRoutes(
      await signedIn("/me/tokens", { method: "POST", body: JSON.stringify({ label: "x", grant: "suggest" }) }),
      deps({ create: vi.fn(async () => ({ error: { code: "rate_limited", message: "too many" } })) }),
    );
    expect(capped!.status).toBe(429);
  });

  it("revokes by id", async () => {
    const d = deps();
    const res = await handleTokenRoutes(await signedIn("/me/tokens?id=abcdef012345", { method: "DELETE" }), d);
    expect(await res!.json()).toEqual({ ok: true });
    expect(d.revoke).toHaveBeenCalledWith("google:1", "abcdef012345");
    const bad = await handleTokenRoutes(await signedIn("/me/tokens?id=nope", { method: "DELETE" }), deps());
    expect(bad!.status).toBe(400);
  });
});
