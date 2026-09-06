import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleAttachmentUpload,
  handleAttachmentServe,
  storeAttachment,
  peekStream,
  type AttachmentDeps,
  type AttachmentDocStub,
  type BudgetStub,
} from "../../../workers/attachments";
import { mintSessionToken, SESSION_COOKIE } from "../../../app/lib/auth.server";

const SECRET = "test-secret";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    store,
    put: vi.fn(async (key: string, body: ReadableStream<Uint8Array> | Uint8Array, _len: number, contentType: string) => {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      store.set(key, { bytes, contentType });
    }),
    get: vi.fn(async (key: string) => {
      const o = store.get(key);
      return o ? { body: new Response(o.bytes).body!, size: o.bytes.byteLength } : null;
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function fakeDoc(overrides: Partial<AttachmentDocStub> = {}): AttachmentDocStub {
  return {
    reserveAttachment: vi.fn(async ({ filename }) => ({ id: "abcdefghijklmnop", filename })),
    commitAttachment: vi.fn(async () => ({ ok: true as const })),
    releaseAttachment: vi.fn(async () => ({ ok: true as const })),
    attachmentInfo: vi.fn(async () => ({ filename: "cat.png", contentType: "image/png", bytes: 12 })),
    remainingLifetimeMs: vi.fn(async () => 3_600_000),
    ...overrides,
  };
}

function fakeRegistry(overrides: Partial<BudgetStub> = {}): BudgetStub {
  return {
    reserveUploadBudget: vi.fn(async () => ({ ok: true as const, ledgerId: 1 })),
    releaseUploadBudget: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

async function cookieFor(principal: string, email: string) {
  const token = await mintSessionToken({ principal, email, caps: ["suggest", "comment", "write"] }, SECRET, 3600);
  return `${SESSION_COOKIE}=${token}`;
}

let bucket: ReturnType<typeof fakeBucket>;
let doc: AttachmentDocStub;
let registry: BudgetStub;
let deps: AttachmentDeps;

beforeEach(() => {
  bucket = fakeBucket();
  doc = fakeDoc();
  registry = fakeRegistry();
  deps = { bucket, getDocStub: async () => doc, registry, secret: SECRET, displayName: async () => "Ada Lovelace" };
});

const upload = (init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request("https://vapor.fyi/abcd1234/attachments", {
    method: "POST",
    body: PNG,
    ...init,
    headers: { "Content-Length": String(PNG.byteLength), "X-Filename": "cat.png", Origin: "https://vapor.fyi", ...init.headers },
  });

describe("handleAttachmentUpload", () => {
  it("stores a signed-in user's file and answers with its address and markdown", async () => {
    const res = await handleAttachmentUpload(upload({ headers: { Cookie: await cookieFor("email:ada@x.com", "ada@x.com") } }), deps);
    expect(res!.status).toBe(201);
    const body = (await res!.json()) as { url: string; markdown: string; contentType: string };
    expect(body.url).toBe("/abcd1234/attachments/abcdefghijklmnop/cat.png");
    expect(body.markdown).toBe("![cat.png](/abcd1234/attachments/abcdefghijklmnop/cat.png)");
    expect(body.contentType).toBe("image/png");
    expect(bucket.store.get("abcd1234/abcdefghijklmnop")?.contentType).toBe("image/png");
    expect(doc.reserveAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ uploader: "email:ada@x.com", uploaderName: "Ada Lovelace", bytes: 12 }),
    );
    expect(registry.reserveUploadBudget).toHaveBeenCalledWith("email:ada@x.com", 12);
  });

  it("refuses anonymous visitors with a sign-in error", async () => {
    const res = await handleAttachmentUpload(upload(), deps);
    expect(res!.status).toBe(401);
    expect(await res!.json()).toEqual({ error: "sign_in_required" });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("refuses a cookie from another origin", async () => {
    const res = await handleAttachmentUpload(
      upload({ headers: { Cookie: await cookieFor("email:ada@x.com", "ada@x.com"), Origin: "https://evil.example" } }),
      deps,
    );
    expect(res!.status).toBe(401);
  });

  it("takes an agent's Bearer token with write, attributed as its owner's agent", async () => {
    const token = await mintSessionToken({ principal: "email:ada@x.com", email: "ada@x.com", caps: ["write"] }, SECRET, 3600);
    const res = await handleAttachmentUpload(upload({ headers: { Authorization: `Bearer ${token}`, Origin: "" } }), deps);
    expect(res!.status).toBe(201);
    expect(doc.reserveAttachment).toHaveBeenCalledWith(expect.objectContaining({ uploaderName: "Ada's Agent" }));
  });

  it("refuses a Bearer token without write", async () => {
    const token = await mintSessionToken({ principal: "email:ada@x.com", email: "ada@x.com", caps: ["suggest"] }, SECRET, 3600);
    const res = await handleAttachmentUpload(upload({ headers: { Authorization: `Bearer ${token}` } }), deps);
    expect(res!.status).toBe(403);
  });

  it("requires a Content-Length", async () => {
    const res = await handleAttachmentUpload(
      upload({ headers: { Cookie: await cookieFor("email:ada@x.com", "ada@x.com"), "Content-Length": "" } }),
      deps,
    );
    expect(res!.status).toBe(411);
  });

  it("refuses a type whose bytes don't match and gives both budgets back", async () => {
    const text = new TextEncoder().encode("not a png");
    const res = await handleAttachmentUpload(
      upload({
        body: text,
        headers: { Cookie: await cookieFor("email:ada@x.com", "ada@x.com"), "Content-Length": String(text.byteLength) },
      }),
      deps,
    );
    expect(res!.status).toBe(415);
    expect(registry.releaseUploadBudget).toHaveBeenCalledWith(1);
    expect(doc.releaseAttachment).toHaveBeenCalledWith("abcdefghijklmnop");
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("stops before touching the document when the principal is over budget", async () => {
    registry = fakeRegistry({ reserveUploadBudget: vi.fn(async () => ({ error: "principal_budget" as const })) });
    deps = { ...deps, registry };
    const res = await handleAttachmentUpload(upload({ headers: { Cookie: await cookieFor("email:ada@x.com", "ada@x.com") } }), deps);
    expect(res!.status).toBe(429);
    expect(doc.reserveAttachment).not.toHaveBeenCalled();
  });

  it("returns null for other paths", async () => {
    expect(await handleAttachmentUpload(new Request("https://vapor.fyi/abcd1234", { method: "POST" }), deps)).toBeNull();
  });
});

describe("handleAttachmentServe", () => {
  it("streams a ready object with a server-chosen type, sandboxed and cached for the document's life", async () => {
    bucket.store.set("abcd1234/abcdefghijklmnop", { bytes: PNG, contentType: "image/png" });
    const res = await handleAttachmentServe(
      new Request("https://vapor.fyi/abcd1234/attachments/abcdefghijklmnop/cat.png"),
      deps,
    );
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toBe("image/png");
    expect(res!.headers.get("Content-Disposition")).toBe('inline; filename="cat.png"');
    expect(res!.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res!.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(res!.headers.get("Cache-Control")).toBe("public, max-age=3600, immutable");
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(PNG);
  });

  it("serves non-images as downloads", async () => {
    doc = fakeDoc({
      attachmentInfo: vi.fn(async () => ({ filename: "report.pdf", contentType: "application/pdf", bytes: 3 })),
    });
    deps = { ...deps, getDocStub: async () => doc };
    bucket.store.set("abcd1234/abcdefghijklmnop", { bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf" });
    const res = await handleAttachmentServe(
      new Request("https://vapor.fyi/abcd1234/attachments/abcdefghijklmnop/report.pdf"),
      deps,
    );
    expect(res!.headers.get("Content-Disposition")).toBe('attachment; filename="report.pdf"');
  });

  it("404s an unknown or unfinished attachment", async () => {
    doc = fakeDoc({ attachmentInfo: vi.fn(async () => null) });
    deps = { ...deps, getDocStub: async () => doc };
    const res = await handleAttachmentServe(
      new Request("https://vapor.fyi/abcd1234/attachments/abcdefghijklmnop/cat.png"),
      deps,
    );
    expect(res!.status).toBe(404);
  });
});

describe("storeAttachment and peekStream", () => {
  it("peeks the head without losing the rest of the stream", async () => {
    const { head, stream } = await peekStream(new Response(PNG).body!, 4);
    expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(PNG);
  });

  it("deletes the object and releases both budgets when the commit fails", async () => {
    doc = fakeDoc({ commitAttachment: vi.fn(async () => ({ error: "attachment_not_found" as const })) });
    deps = { ...deps, getDocStub: async () => doc };
    const out = await storeAttachment(deps, {
      docId: "abcd1234",
      filename: "cat.png",
      bytes: PNG.byteLength,
      head: PNG,
      body: PNG,
      who: { principal: "email:a@x.com", name: "Ada", via: "cookie" },
    });
    expect(out).toEqual({ error: "attachment_not_found" });
    expect(bucket.delete).toHaveBeenCalledWith("abcd1234/abcdefghijklmnop");
    expect(registry.releaseUploadBudget).toHaveBeenCalled();
  });
});
