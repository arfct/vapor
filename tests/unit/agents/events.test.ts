import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  eventCatalog,
  eventTypeByName,
  encodeCursor,
  decodeCursor,
  eventId,
  buildOccurrence,
  isValidWebhookSecret,
  webhookUrlError,
  subscriptionId,
  signWebhook,
  grantTtlMs,
  SUBSCRIPTION_TTL_FLOOR_MS,
} from "~/../agents/events";

describe("event catalog", () => {
  it("lists the three event types with schemas and delivery modes", () => {
    const catalog = eventCatalog();
    expect(catalog.map((e) => e.name)).toEqual(["document.changed", "mention", "thread.reply"]);
    for (const e of catalog) {
      expect(e.delivery).toContain("poll");
      expect(e.delivery).toContain("webhook");
      expect(e.inputSchema).toMatchObject({ required: ["doc_id"] });
    }
  });

  it("maps names to internal types", () => {
    expect(eventTypeByName("mention")?.internalType).toBe("mention");
    expect(eventTypeByName("thread.reply")?.internalType).toBe("thread_reply");
    expect(eventTypeByName("document.changed")?.internalType).toBe("doc_changed");
    expect(eventTypeByName("nope")).toBeNull();
  });
});

describe("cursors and occurrences", () => {
  it("round-trips cursors and treats null as the log start", () => {
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    expect(decodeCursor(null)).toBe(0);
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor("garbage")).toBeNull();
  });

  it("builds occurrences with stable ids and doc_id merged into data", () => {
    const occ = buildOccurrence({
      docId: "abcd1234",
      seq: 7,
      internalType: "mention",
      payload: { agent: "scribe", text: "hi @scribe" },
      createdAt: 1_700_000_000_000,
    });
    expect(occ).toMatchObject({
      eventId: eventId("abcd1234", 7),
      name: "mention",
      cursor: "s7",
      data: { doc_id: "abcd1234", agent: "scribe" },
    });
    expect(buildOccurrence({ docId: "x", seq: 1, internalType: "internal_only", payload: {}, createdAt: 0 })).toBeNull();
  });
});

describe("webhook secrets and URLs", () => {
  it("accepts whsec_ + base64 of 24-64 bytes and rejects everything else", () => {
    const good = "whsec_" + btoa("a".repeat(32));
    expect(isValidWebhookSecret(good)).toBe(true);
    expect(isValidWebhookSecret("whsec_" + btoa("short"))).toBe(false);
    expect(isValidWebhookSecret("whsec_" + btoa("a".repeat(65)))).toBe(false);
    expect(isValidWebhookSecret("nope_" + btoa("a".repeat(32)))).toBe(false);
    expect(isValidWebhookSecret("whsec_%%%")).toBe(false);
  });

  it("requires https and rejects private-network literals", () => {
    expect(webhookUrlError("https://relay.example.com/hook")).toBeNull();
    expect(webhookUrlError("http://relay.example.com/hook")).toMatch(/https/);
    expect(webhookUrlError("not a url")).toMatch(/valid URL/);
    for (const host of [
      "localhost",
      "sub.localhost",
      "box.internal",
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.9",
      "172.16.5.5",
      "169.254.1.1",
      "100.77.101.103",
    ]) {
      expect(webhookUrlError(`https://${host}/hook`), host).toMatch(/private network/);
    }
  });
});

describe("subscription ids", () => {
  it("is deterministic over the subscription key and distinct across keys", async () => {
    const a = await subscriptionId("email:a@x.com", "https://r.example/h", "mention", '{"doc_id":"d1"}');
    const b = await subscriptionId("email:a@x.com", "https://r.example/h", "mention", '{"doc_id":"d1"}');
    const c = await subscriptionId("email:b@x.com", "https://r.example/h", "mention", '{"doc_id":"d1"}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^sub_[0-9a-f]{16}$/);
  });
});

describe("Standard Webhooks signing", () => {
  it("produces a signature verifiable with the raw secret bytes", async () => {
    const rawSecret = "0123456789abcdef01234567"; // 24 bytes
    const secret = "whsec_" + btoa(rawSecret);
    const body = '{"eventId":"d:1"}';
    const headers = await signWebhook({
      secret,
      messageId: "d:1",
      timestampSeconds: 1_700_000_000,
      body,
    });

    expect(headers["webhook-id"]).toBe("d:1");
    expect(headers["webhook-timestamp"]).toBe("1700000000");

    const expected = createHmac("sha256", Buffer.from(rawSecret, "binary"))
      .update(`d:1.1700000000.${body}`)
      .digest("base64");
    expect(headers["webhook-signature"]).toBe(`v1,${expected}`);
  });
});

describe("TTL grants", () => {
  const now = 1_000_000;
  const expiry = now + 50 * 60 * 60 * 1000; // doc dies in 50h

  it("defaults (and no-expiry requests) to the document's remaining lifetime", () => {
    expect(grantTtlMs(undefined, expiry, now)).toBe(expiry - now);
    expect(grantTtlMs(null, expiry, now)).toBe(expiry - now);
  });

  it("honours shorter suggestions and floors unreasonably short ones", () => {
    expect(grantTtlMs(60 * 60 * 1000, expiry, now)).toBe(60 * 60 * 1000);
    expect(grantTtlMs(1_000, expiry, now)).toBe(SUBSCRIPTION_TTL_FLOOR_MS);
  });

  it("caps suggestions beyond the document's lifetime", () => {
    expect(grantTtlMs(1000 * 60 * 60 * 1000, expiry, now)).toBe(expiry - now);
  });
});
