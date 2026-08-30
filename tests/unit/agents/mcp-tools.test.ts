import { describe, it, expect, vi } from "vitest";
import { TOOLS, validateNewDocumentMarkdown } from "../../../agents/mcp-tools";

const SPEC_TOOLS = [
  "read_document",
  "insert",
  "replace",
  "suggest",
  "comment",
  "reply",
  "join",
  "leave",
  "await_events",
];

describe("mcp tool table", () => {
  const names = TOOLS.map((t) => t.name);

  it("exposes the spec surface", () => {
    for (const n of SPEC_TOOLS) expect(names).toContain(n);
  });

  it("gives every tool a description and a doc_id in its schema", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.schema).toHaveProperty("doc_id");
    }
  });

  it("routes read_document to the stub with the bearer token", async () => {
    const stub = {
      agentRead: vi.fn(async () => ({
        markdown: "# Hi",
        blocks: [],
        presence: [],
        threads: [],
      })),
    };
    const tool = TOOLS.find((t) => t.name === "read_document")!;
    const out = await tool.run(
      { getStub: async () => stub as never, token: "vpr_t" },
      { doc_id: "abcd1234" },
    );
    expect(stub.agentRead).toHaveBeenCalledWith("vpr_t");
    expect(out).toMatchObject({ markdown: "# Hi" });
  });

  it("rejects a malformed doc_id before touching a stub", async () => {
    const getStub = vi.fn();
    const tool = TOOLS.find((t) => t.name === "read_document")!;
    const out = await tool.run(
      { getStub: getStub as never, token: "vpr_t" },
      { doc_id: "NOT-AN-ID" },
    );
    expect(getStub).not.toHaveBeenCalled();
    expect(out).toMatchObject({ error: { code: "doc_not_found" } });
  });

  it("maps insert args onto agentInsert", async () => {
    const stub = { agentInsert: vi.fn(async () => ({ ok: true })) };
    const tool = TOOLS.find((t) => t.name === "insert")!;
    const out = await tool.run(
      { getStub: async () => stub as never, token: "vpr_t" },
      { doc_id: "abcd1234", anchor: "b1-aaaabbbb", where: "after", markdown: "hi", pace: "instant" },
    );
    expect(stub.agentInsert).toHaveBeenCalledWith("vpr_t", {
      anchor: "b1-aaaabbbb",
      where: "after",
      markdown: "hi",
      pace: "instant",
    });
    expect(out).toEqual({ ok: true });
  });

  it("maps replace's from_anchor/to_anchor onto agentReplace", async () => {
    const stub = { agentReplace: vi.fn(async () => ({ ok: true })) };
    const tool = TOOLS.find((t) => t.name === "replace")!;
    await tool.run(
      { getStub: async () => stub as never, token: "vpr_t" },
      { doc_id: "abcd1234", from_anchor: "b1-aaaabbbb", to_anchor: "b2-ccccdddd", markdown: "x" },
    );
    expect(stub.agentReplace).toHaveBeenCalledWith("vpr_t", {
      from: "b1-aaaabbbb",
      to: "b2-ccccdddd",
      markdown: "x",
      pace: undefined,
    });
  });

  it("maps suggest args onto agentSuggest", async () => {
    const stub = { agentSuggest: vi.fn(async () => ({ ok: true })) };
    const tool = TOOLS.find((t) => t.name === "suggest")!;
    await tool.run(
      { getStub: async () => stub as never, token: "vpr_t" },
      { doc_id: "abcd1234", anchor: "b1-aaaabbbb", find: "old", replacement: "new" },
    );
    expect(stub.agentSuggest).toHaveBeenCalledWith("vpr_t", {
      anchor: "b1-aaaabbbb",
      find: "old",
      replacement: "new",
      pace: undefined,
    });
  });

  it("maps comment and reply args onto their RPCs", async () => {
    const stub = {
      agentComment: vi.fn(async () => ({ threadId: "t1" })),
      agentReply: vi.fn(async () => ({ ok: true })),
    };
    const deps = { getStub: async () => stub as never, token: "vpr_t" };

    const comment = await TOOLS.find((t) => t.name === "comment")!.run(deps, {
      doc_id: "abcd1234",
      anchor: "b1-aaaabbbb",
      quote: "here",
      text: "why?",
    });
    expect(stub.agentComment).toHaveBeenCalledWith("vpr_t", {
      anchor: "b1-aaaabbbb",
      quote: "here",
      text: "why?",
    });
    expect(comment).toEqual({ threadId: "t1" });

    await TOOLS.find((t) => t.name === "reply")!.run(deps, {
      doc_id: "abcd1234",
      thread_id: "t1",
      text: "because",
    });
    expect(stub.agentReply).toHaveBeenCalledWith("vpr_t", { threadId: "t1", text: "because" });
  });

  it("maps join/leave onto presence RPCs", async () => {
    const stub = {
      agentJoin: vi.fn(async () => ({ ok: true })),
      agentLeave: vi.fn(async () => ({ ok: true })),
    };
    const deps = { getStub: async () => stub as never, token: "vpr_t" };

    await TOOLS.find((t) => t.name === "join")!.run(deps, {
      doc_id: "abcd1234",
      status: "drafting",
    });
    expect(stub.agentJoin).toHaveBeenCalledWith("vpr_t", "drafting");

    await TOOLS.find((t) => t.name === "leave")!.run(deps, { doc_id: "abcd1234" });
    expect(stub.agentLeave).toHaveBeenCalledWith("vpr_t");
  });

  it("converts await_events since_cursor/timeout_s to RPC args", async () => {
    const stub = { agentAwaitEvents: vi.fn(async () => ({ events: [], cursor: 7 })) };
    const tool = TOOLS.find((t) => t.name === "await_events")!;
    await tool.run(
      { getStub: async () => stub as never, token: "vpr_t" },
      { doc_id: "abcd1234", since_cursor: 7, timeout_s: 30 },
    );
    expect(stub.agentAwaitEvents).toHaveBeenCalledWith("vpr_t", {
      cursor: 7,
      timeoutMs: 30_000,
    });
  });

  it("passes error results through untouched", async () => {
    const stub = {
      agentRead: vi.fn(async () => ({
        error: { code: "invalid_token", message: "Invalid or unknown agent token" },
      })),
    };
    const tool = TOOLS.find((t) => t.name === "read_document")!;
    const out = await tool.run(
      { getStub: async () => stub as never, token: "nope" },
      { doc_id: "abcd1234" },
    );
    expect(out).toMatchObject({ error: { code: "invalid_token" } });
  });
});

describe("validateNewDocumentMarkdown", () => {
  it("accepts absent and ordinary markdown", () => {
    expect(validateNewDocumentMarkdown(undefined)).toBeNull();
    expect(validateNewDocumentMarkdown("# Hello\n\nWorld")).toBeNull();
  });

  it("rejects markdown over the 1MB cap", () => {
    expect(validateNewDocumentMarkdown("a".repeat(1_000_001))).toMatchObject({
      error: { code: "rate_limited", message: expect.stringContaining("1MB") },
    });
    expect(validateNewDocumentMarkdown("a".repeat(1_000_000))).toBeNull();
  });

  it("rejects content containing a NUL byte as binary", () => {
    expect(validateNewDocumentMarkdown("text\0more")).toMatchObject({
      error: { code: "unsupported_markup", message: expect.stringContaining("binary") },
    });
  });
});
