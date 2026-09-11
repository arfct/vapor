import { describe, it, expect, vi } from "vitest";
import { pairRemarkable, remarkableUserToken, uploadToRemarkable } from "../../../workers/remarkable";
import { kindleMailerFromEnv, sendToKindle } from "../../../workers/kindle";

function fetchReturning(status: number, body: string) {
  return vi.fn(async () => new Response(body, { status }));
}

describe("reMarkable client (#100)", () => {
  it("pairs with a one-time code and reports a rejected code plainly", async () => {
    const ok = fetchReturning(200, "device-token-123");
    const paired = await pairRemarkable("abcd1234", ok);
    expect(paired).toEqual({ deviceToken: "device-token-123" });
    const [url, init] = ok.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://webapp-prod.cloud.remarkable.engineering/token/json/2/device/new");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ code: "abcd1234", deviceDesc: "browser-chrome" });
    expect(body.deviceID).toMatch(/^[0-9a-f-]{36}$/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ");

    expect(await pairRemarkable("abcd1234", fetchReturning(401, ""))).toMatchObject({ error: expect.stringContaining("did not accept that code") });
  });

  it("exchanges the device token for a user token", async () => {
    const f = fetchReturning(200, "user-token");
    expect(await remarkableUserToken("device-token", f)).toEqual({ userToken: "user-token" });
    const [, init] = f.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer device-token");
    expect(await remarkableUserToken("device-token", fetchReturning(401, ""))).toMatchObject({ error: expect.stringContaining("pair again") });
  });

  it("uploads with the extension's metadata headers", async () => {
    const f = fetchReturning(200, JSON.stringify({ docID: "doc-1" }));
    const result = await uploadToRemarkable("user-token", { filename: "a-plan-abcd1234.epub", bytes: new Uint8Array([1, 2]), contentType: "application/epub+zip" }, f);
    expect(result).toEqual({ ok: true, id: "doc-1" });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://internal.cloud.remarkable.com/doc/v2/files");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer user-token");
    expect(headers["Content-Type"]).toBe("application/epub+zip");
    expect(headers["rm-source"]).toBe("RoR-Browser");
    expect(JSON.parse(atob(headers["rm-meta"]))).toEqual({ file_name: "a-plan-abcd1234", parent: "" });
    expect(await uploadToRemarkable("t", { filename: "x.epub", bytes: new Uint8Array(), contentType: "application/epub+zip" }, fetchReturning(500, ""))).toMatchObject({ error: expect.stringContaining("500") });
  });
});

describe("Kindle mailer (#100)", () => {
  it("is configured only when both the key and the sender are set", () => {
    expect(kindleMailerFromEnv({})).toBeNull();
    expect(kindleMailerFromEnv({ RESEND_API_KEY: "re_x" })).toBeNull();
    expect(kindleMailerFromEnv({ RESEND_API_KEY: "re_x", SEND_FROM_EMAIL: " kindle@vapor.example " })).toEqual({ apiKey: "re_x", from: "kindle@vapor.example" });
  });

  it("mails the EPUB as an attachment through Resend", async () => {
    const f = fetchReturning(200, JSON.stringify({ id: "email-1" }));
    const result = await sendToKindle(
      { apiKey: "re_x", from: "kindle@vapor.example" },
      { to: "ada@kindle.com", title: "A plan", filename: "a-plan-abcd1234.epub", bytes: new Uint8Array([104, 105]), sourceUrl: "https://vapor.example/abcd1234" },
      f,
    );
    expect(result).toEqual({ ok: true, id: "email-1" });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_x");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: "kindle@vapor.example", to: ["ada@kindle.com"], subject: "A plan" });
    expect(body.attachments).toEqual([{ filename: "a-plan-abcd1234.epub", content: btoa("hi"), content_type: "application/epub+zip" }]);
    expect(await sendToKindle({ apiKey: "k", from: "f" }, { to: "a@kindle.com", title: "t", filename: "f.epub", bytes: new Uint8Array(), sourceUrl: "u" }, fetchReturning(422, "bad from"))).toMatchObject({ error: expect.stringContaining("422") });
  });
});
