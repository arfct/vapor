import { describe, it, expect, vi } from "vitest";
import { handleDeviceRoutes, type DeviceRouteDeps } from "../../../workers/device-routes";
import { mintSessionToken } from "~/lib/auth.server";

const SECRET = "test-session-secret";
const ORIGIN = "https://vapor.example";
const none = { kindleEmail: null, remarkable: null };
const both = { kindleEmail: "ada@kindle.com", remarkable: { pairedAt: 1 } };

function deps(over: Partial<DeviceRouteDeps> = {}): DeviceRouteDeps {
  return {
    secret: SECRET,
    getDevices: vi.fn(async () => ({ devices: both })),
    setKindleEmail: vi.fn(async (_p, email) => ({ devices: { ...both, kindleEmail: email } })),
    pairRemarkable: vi.fn(async () => ({ deviceToken: "dev" })),
    setRemarkableToken: vi.fn(async () => ({ devices: both })),
    clearRemarkable: vi.fn(async () => ({ devices: { ...both, remarkable: null } })),
    openRemarkableToken: vi.fn(async () => ({ deviceToken: "dev" })),
    allowSend: vi.fn(async () => ({ allowed: true })),
    mailer: { apiKey: "k", from: "kindle@vapor.example" },
    buildEpub: vi.fn(async () => ({ bytes: new Uint8Array([1]), filename: "a-plan-abcd1234.epub", title: "A plan" })),
    sendKindle: vi.fn(async () => ({ ok: true as const, id: "e1" })),
    remarkableUserToken: vi.fn(async () => ({ userToken: "user" })),
    uploadRemarkable: vi.fn(async () => ({ ok: true as const, id: "d1" })),
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
const post = (path: string, body: unknown) => signedIn(path, { method: "POST", body: JSON.stringify(body) });

describe("device routes (#100)", () => {
  it("ignores other paths, requires a session, and refuses cross-origin writes", async () => {
    expect(await handleDeviceRoutes(new Request(`${ORIGIN}/me/other`), deps())).toBeNull();
    expect((await handleDeviceRoutes(new Request(`${ORIGIN}/me/devices`), deps()))!.status).toBe(401);
    expect((await handleDeviceRoutes(await signedIn("/me/devices", { method: "PUT", body: "{}" }, false), deps()))!.status).toBe(403);
  });

  it("reports settings and whether the instance can mail", async () => {
    const res = await handleDeviceRoutes(await signedIn("/me/devices"), deps());
    expect(await res!.json()).toEqual({ devices: both, kindleMail: { from: "kindle@vapor.example" } });
    const noMail = await handleDeviceRoutes(await signedIn("/me/devices"), deps({ mailer: null }));
    expect(((await noMail!.json()) as { kindleMail: unknown }).kindleMail).toBeNull();
  });

  it("saves a Kindle address after checking it, pairs a reMarkable through the code exchange, and forgets either", async () => {
    const d = deps();
    const bad = await handleDeviceRoutes(await signedIn("/me/devices", { method: "PUT", body: JSON.stringify({ kindle: "ada@gmail.com" }) }), d);
    expect(bad!.status).toBe(400);
    const ok = await handleDeviceRoutes(await signedIn("/me/devices", { method: "PUT", body: JSON.stringify({ kindle: " Ada@Kindle.com " }) }), d);
    expect(ok!.status).toBe(200);
    expect(d.setKindleEmail).toHaveBeenCalledWith("google:1", "ada@kindle.com");

    const badCode = await handleDeviceRoutes(await post("/me/devices", { remarkable: { code: "abc" } }), d);
    expect(badCode!.status).toBe(400);
    const paired = await handleDeviceRoutes(await post("/me/devices", { remarkable: { code: "ABCD1234" } }), d);
    expect(paired!.status).toBe(200);
    expect(d.pairRemarkable).toHaveBeenCalledWith("abcd1234");
    expect(d.setRemarkableToken).toHaveBeenCalledWith("google:1", "dev");
    const refused = await handleDeviceRoutes(await post("/me/devices", { remarkable: { code: "abcd1234" } }), deps({ pairRemarkable: vi.fn(async () => ({ error: "nope" })) }));
    expect(refused!.status).toBe(502);

    await handleDeviceRoutes(await signedIn("/me/devices?target=remarkable", { method: "DELETE" }), d);
    expect(d.clearRemarkable).toHaveBeenCalledWith("google:1");
    await handleDeviceRoutes(await signedIn("/me/devices?target=kindle", { method: "DELETE" }), d);
    expect(d.setKindleEmail).toHaveBeenLastCalledWith("google:1", null);
  });

  it("sends to Kindle by mail with the built EPUB, and refuses when nothing is set up", async () => {
    const d = deps();
    const res = await handleDeviceRoutes(await post("/abcd1234/send", { target: "kindle" }), d);
    expect(await res!.json()).toEqual({ ok: true, target: "kindle", to: "ada@kindle.com", title: "A plan" });
    expect(d.buildEpub).toHaveBeenCalledWith("abcd1234", ORIGIN);
    expect(d.sendKindle).toHaveBeenCalledWith(d.mailer, expect.objectContaining({ to: "ada@kindle.com", title: "A plan", filename: "a-plan-abcd1234.epub", sourceUrl: `${ORIGIN}/abcd1234` }));

    expect((await handleDeviceRoutes(await post("/abcd1234/send", { target: "kindle" }), deps({ mailer: null })))!.status).toBe(409);
    expect((await handleDeviceRoutes(await post("/abcd1234/send", { target: "kindle" }), deps({ getDevices: vi.fn(async () => ({ devices: none })) })))!.status).toBe(409);
    expect((await handleDeviceRoutes(await post("/abcd1234/send", { target: "fax" }), d))!.status).toBe(400);
    expect((await handleDeviceRoutes(await post("/abcd1234/send", { target: "kindle" }), deps({ allowSend: vi.fn(async () => ({ allowed: false })) })))!.status).toBe(429);
    expect((await handleDeviceRoutes(await post("/abcd1234/send", { target: "kindle" }), deps({ sendKindle: vi.fn(async () => ({ error: "refused" })) })))!.status).toBe(502);
    expect((await handleDeviceRoutes(await post("/abcd1234/send", { target: "kindle" }), deps({ buildEpub: vi.fn(async () => null) })))!.status).toBe(404);
  });

  it("sends to reMarkable through the token exchange and upload", async () => {
    const d = deps();
    const res = await handleDeviceRoutes(await post("/abcd1234/send", { target: "remarkable" }), d);
    expect(await res!.json()).toEqual({ ok: true, target: "remarkable", title: "A plan" });
    expect(d.openRemarkableToken).toHaveBeenCalledWith("google:1");
    expect(d.remarkableUserToken).toHaveBeenCalledWith("dev");
    expect(d.uploadRemarkable).toHaveBeenCalledWith("user", expect.objectContaining({ filename: "a-plan-abcd1234.epub", contentType: "application/epub+zip" }));

    expect((await handleDeviceRoutes(await post("/abcd1234/send", { target: "remarkable" }), deps({ getDevices: vi.fn(async () => ({ devices: none })) })))!.status).toBe(409);
    expect((await handleDeviceRoutes(await post("/abcd1234/send", { target: "remarkable" }), deps({ openRemarkableToken: vi.fn(async () => ({ deviceToken: null })) })))!.status).toBe(409);
    expect((await handleDeviceRoutes(await post("/abcd1234/send", { target: "remarkable" }), deps({ remarkableUserToken: vi.fn(async () => ({ error: "pair again" })) })))!.status).toBe(502);
  });
});
