/**
 * buildAttachmentDeps: the real R2 / Durable Object / cache bindings
 * behind the attachment handlers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getAgentByName = vi.hoisted(() => vi.fn());
vi.mock("agents", () => ({ getAgentByName }));

const { buildAttachmentDeps } = await import("../../../workers/attachment-deps");

/** Workers' FixedLengthStream: an identity stream that enforces a byte count. */
class FakeFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(public expectedLength: number) {
    super();
  }
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const ATTACHMENTS = {
    put: vi.fn(async (key: string, body: Uint8Array | ReadableStream<Uint8Array>, opts: { httpMetadata: { contentType: string } }) => {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      store.set(key, { bytes, contentType: opts.httpMetadata.contentType });
    }),
    get: vi.fn(async (key: string) => {
      const o = store.get(key);
      return o ? { body: new Response(o.bytes as unknown as BodyInit).body, size: o.bytes.byteLength } : null;
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  return { env: { ATTACHMENTS, DocumentAgent: { binding: "doc" }, SESSION_SECRET: "s", ...overrides }, store, ATTACHMENTS };
}

const registry = { getProfile: vi.fn() };
const edgeCache = { match: vi.fn(), put: vi.fn() };

function build(env: unknown) {
  return buildAttachmentDeps(env as Parameters<typeof buildAttachmentDeps>[0], registry as never);
}

beforeEach(() => {
  vi.stubGlobal("FixedLengthStream", FakeFixedLengthStream);
  vi.stubGlobal("caches", { default: edgeCache });
  registry.getProfile.mockReset();
  getAgentByName.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("buildAttachmentDeps", () => {
  it("puts byte arrays straight into R2 with their content type", async () => {
    const { env, store, ATTACHMENTS } = makeEnv();
    const deps = build(env);
    await deps.bucket.put("doc/a", new Uint8Array([1, 2]), 2, "image/png");
    expect(ATTACHMENTS.put).toHaveBeenCalledWith("doc/a", new Uint8Array([1, 2]), {
      httpMetadata: { contentType: "image/png" },
    });
    expect(store.get("doc/a")).toEqual({ bytes: new Uint8Array([1, 2]), contentType: "image/png" });
  });

  it("pipes streams through a FixedLengthStream of the declared length", async () => {
    const { env, store, ATTACHMENTS } = makeEnv();
    const deps = build(env);
    const body = new Response(new Uint8Array([7, 8, 9])).body!;
    await deps.bucket.put("doc/b", body, 3, "application/pdf");
    const putBody = ATTACHMENTS.put.mock.calls[0][1];
    expect(putBody).toBeInstanceOf(ReadableStream);
    expect(store.get("doc/b")).toEqual({ bytes: new Uint8Array([7, 8, 9]), contentType: "application/pdf" });
  });

  it("gets objects with body and size, or null when missing, and deletes", async () => {
    const { env } = makeEnv();
    const deps = build(env);
    await deps.bucket.put("doc/c", new Uint8Array([1, 2, 3, 4]), 4, "text/plain");
    const got = await deps.bucket.get("doc/c");
    expect(got?.size).toBe(4);
    expect(new Uint8Array(await new Response(got!.body).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(await deps.bucket.get("doc/missing")).toBeNull();
    await deps.bucket.delete("doc/c");
    expect(await deps.bucket.get("doc/c")).toBeNull();
  });

  it("resolves document stubs by id and exposes registry, secret and cache", async () => {
    const { env } = makeEnv();
    getAgentByName.mockResolvedValue({ stub: true });
    const deps = build(env);
    expect(await deps.getDocStub("abcd1234")).toEqual({ stub: true });
    expect(getAgentByName).toHaveBeenCalledWith(env.DocumentAgent, "abcd1234");
    expect(deps.registry).toBe(registry);
    expect(deps.secret).toBe("s");
    expect(deps.cache).toBe(edgeCache);
  });

  it("defaults the secret to empty", () => {
    const { env } = makeEnv({ SESSION_SECRET: undefined });
    expect(build(env).secret).toBe("");
  });

  it("names principals from their profile, or null", async () => {
    const { env } = makeEnv();
    const deps = build(env);
    registry.getProfile.mockResolvedValueOnce({ profile: { displayName: "Ada" } });
    expect(await deps.displayName!("p1")).toBe("Ada");
    registry.getProfile.mockResolvedValueOnce({ profile: null });
    expect(await deps.displayName!("p2")).toBeNull();
  });
});
