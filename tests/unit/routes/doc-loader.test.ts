/**
 * The `/:id` document loader. Documents share the root namespace with a
 * reserved-slug list, so the loader has to refuse those before it ever
 * resolves a Durable Object stub.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetAgentByName, mockFetch } = vi.hoisted(() => ({
  mockGetAgentByName: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("agents", () => ({
  getAgentByName: mockGetAgentByName,
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({ env: { DocumentAgent: {} } }),
}));

import { loader } from "~/routes/doc.$id";

const context = {} as Parameters<typeof loader>[0]["context"];

function loaderArgs(id: string) {
  return {
    params: { id },
    context,
    request: new Request(`https://vapor.fyi/${id}`),
  } as unknown as Parameters<typeof loader>[0];
}

/** The loader signals a 404 by throwing a react-router data Response. */
async function statusOfThrow(id: string): Promise<number> {
  try {
    await loader(loaderArgs(id));
  } catch (thrown) {
    return (thrown as { init?: { status?: number } }).init?.status ?? 0;
  }
  throw new Error(`loader did not throw for id: ${id}`);
}

describe("doc.$id loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentByName.mockResolvedValue({ fetch: mockFetch });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ exists: true, createdAt: 1000 })),
    );
  });

  it("404s reserved slugs without touching a Durable Object", async () => {
    for (const slug of ["new", "mcp", "agents", ".well-known", "robots.txt"]) {
      expect(await statusOfThrow(slug)).toBe(404);
    }
    expect(mockGetAgentByName).not.toHaveBeenCalled();
  });

  it("404s a malformed document id", async () => {
    expect(await statusOfThrow("nope")).toBe(404);
    expect(mockGetAgentByName).not.toHaveBeenCalled();
  });

  it("404s a well-formed id whose document doesn't exist", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ exists: false, createdAt: null })),
    );
    expect(await statusOfThrow("abcd1234")).toBe(404);
  });

  it("loads an existing document", async () => {
    const result = await loader(loaderArgs("abcd1234"));
    expect(result).toEqual({ id: "abcd1234", createdAt: 1000 });
  });
});
