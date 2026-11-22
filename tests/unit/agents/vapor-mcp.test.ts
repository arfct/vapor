/**
 * VaporMcp (agents/mcp.ts): the MCP server itself, driven by a real MCP
 * client over an in-memory transport. Covers identity (principal vs
 * anonymous), the table tools' wiring, list_documents, attach,
 * create_document, and the draft events JSON-RPC methods. The Durable
 * Object / Registry stubs and attachment storage are fakes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";

const h = vi.hoisted(() => ({
  getAgentByName: vi.fn(),
  storeAttachment: vi.fn(),
  buildAttachmentDeps: vi.fn(() => ({ kind: "deps" })),
}));

vi.mock("agents", () => ({ getAgentByName: h.getAgentByName }));
vi.mock("agents/mcp", () => ({
  McpAgent: class {
    constructor(
      public env: Record<string, unknown>,
      public props: unknown,
      public name: string,
    ) {}
  },
}));
vi.mock("../../../workers/attachments", () => ({ storeAttachment: h.storeAttachment }));
vi.mock("../../../workers/attachment-deps", () => ({ buildAttachmentDeps: h.buildAttachmentDeps }));

const { VaporMcp } = await import("../../../agents/mcp");

type Props = ConstructorParameters<typeof VaporMcp>[1];

const registry = {
  getProfile: vi.fn(),
  listEnrollments: vi.fn(),
  removeEnrollment: vi.fn(),
};

function makeDocStub(overrides: Record<string, unknown> = {}) {
  return {
    agentRead: vi.fn(async () => ({ markdown: "# Hi" })),
    agentJoin: vi.fn(async () => ({ ok: true })),
    agentInsert: vi.fn(async () => ({ ok: true })),
    documentSummary: vi.fn(async () => ({
      exists: true,
      title: "Hello world",
      createdAt: "2026-11-01T00:00:00.000Z",
      expiresAt: "2026-11-05T03:00:00.000Z",
    })),
    fetch: vi.fn(async () => new Response("ok")),
    eventsPoll: vi.fn(async () => ({ events: [], cursor: "c1" })),
    eventsSubscribe: vi.fn(async () => ({ id: "sub1" })),
    eventsUnsubscribe: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

let docStubs: Map<string, ReturnType<typeof makeDocStub>>;
function docStub(id: string) {
  if (!docStubs.has(id)) docStubs.set(id, makeDocStub());
  return docStubs.get(id)!;
}

const ENV = { Registry: { ns: "Registry" }, DocumentAgent: { ns: "DocumentAgent" }, PUBLIC_ORIGIN: "https://vapor.example" };

async function connect(props: Props, opts: { env?: Record<string, unknown>; clientName?: string } = {}) {
  const agent = new VaporMcp(
    (opts.env ?? ENV) as unknown as ConstructorParameters<typeof VaporMcp>[0],
    props,
    "session-1" as never,
  );
  await agent.init();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await agent.server.connect(serverTransport);
  const client = new Client({ name: opts.clientName ?? "claude-code", version: "1.0.0" });
  await client.connect(clientTransport);
  return { agent, client };
}

async function callJson(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return JSON.parse(res.content[0].text);
}

const signedIn: Props = { auth: { principal: "p-ada", email: "ada@example.com", caps: ["suggest", "comment", "write"] }, origin: "https://vapor.test" };

beforeEach(() => {
  vi.clearAllMocks();
  docStubs = new Map();
  h.getAgentByName.mockImplementation(async (ns: { ns: string }, name: string) =>
    ns.ns === "Registry" ? registry : docStub(name),
  );
  registry.getProfile.mockResolvedValue({ profile: { uid: "ada12345", displayName: "Ada" } });
  registry.listEnrollments.mockResolvedValue({ docs: [] });
});

describe("server identity", () => {
  it("advertises website and icons from PUBLIC_ORIGIN", async () => {
    const { client } = await connect(signedIn);
    expect(client.getServerVersion()).toMatchObject({
      name: "vapor",
      websiteUrl: "https://vapor.example",
      icons: [{ src: "https://vapor.example/logo-512.png" }, { src: "https://vapor.example/logo.png" }],
    });
    expect(client.getInstructions()).toMatch(/vapor hosts live collaborative markdown documents/);
  });

  it("has no website or icons without PUBLIC_ORIGIN", async () => {
    const { client } = await connect(signedIn, { env: { ...ENV, PUBLIC_ORIGIN: undefined } });
    const info = client.getServerVersion()!;
    expect(info.name).toBe("vapor");
    expect(info).not.toHaveProperty("websiteUrl");
    expect(info).not.toHaveProperty("icons");
  });

  it("lists the table tools plus list_documents, attach, create_document", async () => {
    const { client } = await connect(null as unknown as Props);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["read_document", "list_documents", "attach", "create_document"]));
  });
});

describe("table tools run under the caller's identity", () => {
  it("principal: owner profile from the Registry, cached per session", async () => {
    const { client } = await connect(signedIn);
    await callJson(client, "read_document", { doc_id: "abcd1234" });
    await callJson(client, "read_document", { doc_id: "abcd1234" });
    const identity = docStub("abcd1234").agentRead.mock.calls[0][0] as Record<string, unknown>;
    expect(identity).toMatchObject({
      kind: "principal",
      id: "p-ada",
      owner: "p-ada",
      ownerUid: "ada12345",
      ownerName: "Ada",
      caps: ["suggest", "comment", "write"],
    });
    expect(identity.client).toBeTruthy();
    expect(registry.getProfile).toHaveBeenCalledTimes(1);
  });

  it("principal without a profile falls back to a hashed uid, the email name and default caps", async () => {
    registry.getProfile.mockResolvedValue({ profile: null });
    const { client } = await connect({ auth: { principal: "p-bob", email: "bob@example.com" }, origin: "https://x" });
    await callJson(client, "read_document", { doc_id: "abcd1234" });
    const identity = docStub("abcd1234").agentRead.mock.calls[0][0] as Record<string, unknown>;
    expect(identity.ownerName).toBe("bob");
    expect(identity.ownerUid).toMatch(/^[0-9a-f]+$/);
    expect(identity.caps).not.toContain("write");
  });

  it("anonymous: per-session id and an animal label", async () => {
    const { client } = await connect({ auth: null });
    await callJson(client, "read_document", { doc_id: "abcd1234" });
    const identity = docStub("abcd1234").agentRead.mock.calls[0][0] as Record<string, unknown>;
    expect(identity).toMatchObject({ kind: "anonymous", id: "anon:session-1", owner: null });
    expect(identity.label).toMatch(/^Agentic /);
    expect(identity.caps).not.toContain("write");
  });
});

describe("list_documents", () => {
  it("refuses anonymous sessions", async () => {
    const { client } = await connect({ auth: null });
    expect(await callJson(client, "list_documents")).toEqual({
      error: { code: "capability_denied", message: "list_documents needs the signed-in endpoint (/mcp)." },
    });
  });

  it("lists live enrollments newest first and forgets expired ones", async () => {
    registry.listEnrollments.mockResolvedValue({
      docs: [
        { docId: "aaaa1111", enrolledAt: Date.parse("2026-11-01T00:00:00Z") },
        { docId: "bbbb2222", enrolledAt: Date.parse("2026-11-03T00:00:00Z") },
        { docId: "dead0000", enrolledAt: Date.parse("2026-11-02T00:00:00Z") },
      ],
    });
    docStub("dead0000").documentSummary.mockResolvedValue({ exists: false } as never);
    const { client } = await connect(signedIn);
    const { documents } = await callJson(client, "list_documents");
    expect(documents.map((d: { id: string }) => d.id)).toEqual(["bbbb2222", "aaaa1111"]);
    expect(documents[0]).toMatchObject({
      title: "Hello world",
      created_at: "2026-11-01T00:00:00.000Z",
      enrolled_at: "2026-11-03T00:00:00.000Z",
    });
    expect(documents[0].url).toBe("https://vapor.test/hello-world-bbbb2222");
    expect(registry.removeEnrollment).toHaveBeenCalledWith("p-ada", "dead0000");
  });

  it("falls back to the configured origin without a request origin", async () => {
    registry.listEnrollments.mockResolvedValue({ docs: [{ docId: "aaaa1111", enrolledAt: 0 }] });
    const { client } = await connect({ auth: signedIn.auth });
    const { documents } = await callJson(client, "list_documents");
    expect(documents[0].url).toBe("https://vapor.example/hello-world-aaaa1111");
  });
});

describe("attach", () => {
  const b64 = (s: string) => btoa(s);

  it("rejects bad document ids before anything else", async () => {
    const { client } = await connect(signedIn);
    expect(await callJson(client, "attach", { doc_id: "BAD", filename: "a.txt", content_base64: b64("x") })).toEqual({
      error: { code: "invalid_params", message: "Invalid document id" },
    });
  });

  it("refuses anonymous sessions and principals without write", async () => {
    const anon = await connect({ auth: null });
    expect((await callJson(anon.client, "attach", { doc_id: "abcd1234", filename: "a.txt", content_base64: b64("x") })).error.code).toBe(
      "capability_denied",
    );
    const readOnly = await connect({ auth: { principal: "p", email: "p@x.y", caps: ["suggest"] } });
    expect(
      await callJson(readOnly.client, "attach", { doc_id: "abcd1234", filename: "a.txt", content_base64: b64("x") }),
    ).toEqual({ error: { code: "capability_denied", message: "Agent lacks capability: write" } });
  });

  it("rejects invalid base64 and empty files", async () => {
    const { client } = await connect(signedIn);
    expect((await callJson(client, "attach", { doc_id: "abcd1234", filename: "a.txt", content_base64: "%%%" })).error.message).toBe(
      "content_base64 is not valid base64",
    );
    expect((await callJson(client, "attach", { doc_id: "abcd1234", filename: "a.txt", content_base64: "" })).error.code).toBe(
      "invalid_params",
    );
  });

  it("reports storage refusals", async () => {
    h.storeAttachment.mockResolvedValue({ error: "budget_exceeded" });
    const { client } = await connect(signedIn);
    expect(await callJson(client, "attach", { doc_id: "abcd1234", filename: "a.txt", content_base64: b64("hi") })).toEqual({
      error: { code: "budget_exceeded", message: "Attachment refused: budget_exceeded" },
    });
  });

  it("stores the bytes as the owner and inserts the block", async () => {
    const stored = {
      id: "abcdefghijklmnop",
      url: "https://vapor.test/abcd1234/attachments/abcdefghijklmnop",
      filename: "a.txt",
      contentType: "text/plain",
      bytes: 2,
      markdown: "[a.txt](https://vapor.test/abcd1234/attachments/abcdefghijklmnop)",
    };
    h.storeAttachment.mockResolvedValue(stored);
    const { client } = await connect(signedIn);
    const result = await callJson(client, "attach", {
      doc_id: "abcd1234",
      filename: "a.txt",
      content_base64: b64("hi"),
      anchor: "k3f0a9x2-a91f0c2d",
      where: "after",
    });
    expect(result).toEqual({ ...stored, inserted: { ok: true } });
    expect(h.buildAttachmentDeps).toHaveBeenCalledWith(ENV, registry);
    const [, input] = h.storeAttachment.mock.calls[0];
    expect(input).toMatchObject({ docId: "abcd1234", filename: "a.txt", bytes: 2, who: { principal: "p-ada", via: "bearer" } });
    expect(docStub("abcd1234").agentInsert).toHaveBeenCalledWith(expect.objectContaining({ id: "p-ada" }), {
      anchor: "k3f0a9x2-a91f0c2d",
      where: "after",
      markdown: stored.markdown,
    });

    await callJson(client, "attach", { doc_id: "abcd1234", filename: "a.txt", content_base64: b64("hi") });
    expect(docStub("abcd1234").agentInsert.mock.calls[1][1]).toMatchObject({ anchor: undefined, where: "append" });
  });
});

describe("create_document", () => {
  it("rejects binary markdown", async () => {
    const { client } = await connect(signedIn);
    expect((await callJson(client, "create_document", { markdown: "a\0b" })).error.code).toBe("unsupported_markup");
  });

  it("creates an empty document and enrolls a signed-in writer without a note", async () => {
    const { client } = await connect(signedIn);
    const result = await callJson(client, "create_document", {});
    expect(result.id).toMatch(/^[a-z0-9]{8}$/);
    expect(result.url).toBe(`https://vapor.test/${result.id}`);
    expect(result).toMatchObject({
      created_at: "2026-11-01T00:00:00.000Z",
      expires_at: "2026-11-05T03:00:00.000Z",
      capabilities: ["suggest", "comment", "write"],
    });
    expect(result).not.toHaveProperty("note");
    const stub = docStub(result.id);
    const req = stub.fetch.mock.calls[0][0] as unknown as Request;
    expect(req.method).toBe("POST");
    expect(req.headers.get("Content-Type")).toBeNull();
    expect(stub.agentJoin).toHaveBeenCalledWith(expect.objectContaining({ kind: "principal", id: "p-ada" }));
  });

  it("seeds content, names the anonymous creator after its client, and notes it cannot edit", async () => {
    const { client } = await connect({ auth: null }, { clientName: "Cursor" });
    const result = await callJson(client, "create_document", { markdown: "# My Title\n\nBody" });
    expect(result.url).toBe(`https://vapor.example/my-title-${result.id}`);
    expect(result.note).toMatch(/anonymous endpoint/);
    const stub = docStub(result.id);
    const req = stub.fetch.mock.calls[0][0] as unknown as Request;
    expect(req.headers.get("Content-Type")).toBe("application/json");
    expect((await req.json()).content).toContain("# My Title");
    expect(stub.agentJoin.mock.calls[0][0]).toMatchObject({ kind: "anonymous", name: "cursor" });
  });

  it("reports a failed document init", async () => {
    h.getAgentByName.mockImplementation(async (ns: { ns: string }) =>
      ns.ns === "Registry" ? registry : makeDocStub({ fetch: vi.fn(async () => new Response("no", { status: 500 })) }),
    );
    const { client } = await connect(signedIn);
    expect(await callJson(client, "create_document", { markdown: "x" })).toEqual({
      error: { code: "doc_not_found", message: "Failed to create document" },
    });
  });
});

describe("events JSON-RPC methods", () => {
  const any = z.object({}).passthrough();

  it("events/list returns the catalog tagged with the draft version", async () => {
    const { client } = await connect(signedIn);
    const res = await client.request({ method: "events/list", params: {} } as never, any);
    expect(Array.isArray(res.events)).toBe(true);
    expect(Object.keys(res._meta as object)).toHaveLength(1);
  });

  it("events/poll, subscribe and unsubscribe forward to the document", async () => {
    const { client } = await connect(signedIn);
    const poll = await client.request(
      { method: "events/poll", params: { name: "mention", arguments: { doc_id: "abcd1234" }, cursor: null, maxEvents: 5 } } as never,
      any,
    );
    expect(poll).toEqual({ events: [], cursor: "c1" });
    expect(docStub("abcd1234").eventsPoll).toHaveBeenCalledWith(expect.objectContaining({ id: "p-ada" }), {
      name: "mention",
      cursor: null,
      maxEvents: 5,
    });

    const sub = await client.request(
      {
        method: "events/subscribe",
        params: {
          name: "mention",
          arguments: { doc_id: "abcd1234" },
          delivery: { mode: "webhook", url: "https://hook", secret: "whsec_x" },
          ttlMs: 1000,
        },
      } as never,
      any,
    );
    expect(sub).toEqual({ id: "sub1" });
    expect(docStub("abcd1234").eventsSubscribe.mock.calls[0][1]).toEqual({
      name: "mention",
      url: "https://hook",
      secret: "whsec_x",
      ttlMs: 1000,
    });

    const unsub = await client.request(
      {
        method: "events/unsubscribe",
        params: { name: "mention", arguments: { doc_id: "abcd1234" }, delivery: { url: "https://hook" } },
      } as never,
      any,
    );
    expect(unsub).toEqual({});
    expect(docStub("abcd1234").eventsUnsubscribe.mock.calls[0][1]).toEqual({ name: "mention", url: "https://hook" });
  });

  it("maps document errors onto the extension's JSON-RPC codes", async () => {
    const { client } = await connect(signedIn);
    docStub("abcd1234").eventsPoll.mockResolvedValue({ error: { code: "rate_limited", message: "slow down" } } as never);
    await expect(
      client.request({ method: "events/poll", params: { name: "mention", arguments: { doc_id: "abcd1234" } } } as never, any),
    ).rejects.toMatchObject({ code: -32013 });

    docStub("abcd1234").eventsUnsubscribe.mockResolvedValue({ error: { code: "weird", message: "?" } } as never);
    await expect(
      client.request(
        {
          method: "events/unsubscribe",
          params: { name: "mention", arguments: { doc_id: "abcd1234" }, delivery: { url: "https://hook" } },
        } as never,
        any,
      ),
    ).rejects.toMatchObject({ code: -32603 });
  });
});
