import { describe, it, expect, vi } from "vitest";
import { handleRawMarkdown, handleMcpHelp } from "../../../workers/routes";

describe("handleRawMarkdown", () => {
  it("returns 200 with text/markdown for an existing doc", async () => {
    const stub = {
      exportMarkdown: vi.fn(async () => ({ markdown: "# Hello\n\nWorld" })),
    };
    const getStub = vi.fn(async () => stub);

    const res = await handleRawMarkdown(
      new Request("https://vapor.fyi/abcd1234.md"),
      getStub,
    );

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res!.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res!.text()).toBe("# Hello\n\nWorld");
    expect(getStub).toHaveBeenCalledWith("abcd1234");
  });

  it("returns 404 for a valid-format id whose document doesn't exist", async () => {
    const stub = {
      exportMarkdown: vi.fn(async () => ({
        error: { code: "doc_not_found" as const, message: "Document does not exist" },
      })),
    };
    const getStub = vi.fn(async () => stub);

    const res = await handleRawMarkdown(
      new Request("https://vapor.fyi/zzzz9999.md"),
      getStub,
    );

    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it("returns null for an invalid document id", async () => {
    const getStub = vi.fn();

    const res = await handleRawMarkdown(new Request("https://vapor.fyi/foo.md"), getStub);

    expect(res).toBeNull();
    expect(getStub).not.toHaveBeenCalled();
  });

  it("returns null for a non-.md path", async () => {
    const getStub = vi.fn();

    const res = await handleRawMarkdown(new Request("https://vapor.fyi/abcd1234"), getStub);

    expect(res).toBeNull();
    expect(getStub).not.toHaveBeenCalled();
  });

  it("returns null for non-GET requests", async () => {
    const getStub = vi.fn();

    const res = await handleRawMarkdown(
      new Request("https://vapor.fyi/abcd1234.md", { method: "POST" }),
      getStub,
    );

    expect(res).toBeNull();
    expect(getStub).not.toHaveBeenCalled();
  });
});

describe("handleMcpHelp", () => {
  it("returns an HTML help page for a browser GET", async () => {
    const res = handleMcpHelp(
      new Request("https://vapor.fyi/mcp", { headers: { Accept: "text/html" } }),
    );

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toContain("text/html");
    const body = await res!.text();
    expect(body).toContain("claude mcp add");
  });

  it("returns null when Accept is application/json (MCP clients)", () => {
    const res = handleMcpHelp(
      new Request("https://vapor.fyi/mcp", { headers: { Accept: "application/json" } }),
    );

    expect(res).toBeNull();
  });

  it("returns null for a non-/mcp path", () => {
    const res = handleMcpHelp(
      new Request("https://vapor.fyi/other", { headers: { Accept: "text/html" } }),
    );

    expect(res).toBeNull();
  });

  it("returns null for non-GET requests", () => {
    const res = handleMcpHelp(
      new Request("https://vapor.fyi/mcp", { method: "POST", headers: { Accept: "text/html" } }),
    );

    expect(res).toBeNull();
  });
});
