import { describe, it, expect, vi } from "vitest";
import { TOOLS, validateNewDocumentMarkdown, createDocumentAgentName, createDocumentNote } from "../../../agents/mcp-tools";
import type { AgentIdentity } from "../../../app/shared/agent-protocol";

const ID: AgentIdentity = {
  kind: "principal",
  id: "email:a@x.com",
  name: "scribe",
  owner: "email:a@x.com",
  caps: ["suggest", "comment", "write"],
};

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

  it("every tool carries a title, complete annotations, and at least one security scheme (#103)", () => {
    for (const t of TOOLS) {
      expect(t.title, t.name).toMatch(/\S/);
      for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        expect(typeof t.annotations[key], `${t.name}.${key}`).toBe("boolean");
      }
      expect(t.securitySchemes.length, t.name).toBeGreaterThan(0);
      // A read-only tool never claims to be destructive.
      if (t.annotations.readOnlyHint) expect(t.annotations.destructiveHint, t.name).toBe(false);
    }
  });

  it("marks reads read-only and anything that lands in a public document open-world", () => {
    const by = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
    expect(by.read_document.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(by.events_poll.annotations.readOnlyHint).toBe(true);
    expect(by.replace.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(by.delete_comment.annotations.destructiveHint).toBe(true);
    expect(by.suggest.annotations).toMatchObject({ destructiveHint: false, openWorldHint: true });
  });

  it("only lets anonymous callers reach what the anonymous endpoint grants", () => {
    const anon = (name: string) => TOOLS.find((t) => t.name === name)!.securitySchemes.some((s) => s.type === "noauth");
    for (const n of ["read_document", "suggest", "comment", "reply", "join", "events_poll"]) expect(anon(n), n).toBe(true);
    for (const n of ["insert", "replace", "events_subscribe", "events_unsubscribe"]) expect(anon(n), n).toBe(false);
    const write = TOOLS.find((t) => t.name === "insert")!.securitySchemes.find((s) => s.type === "oauth2");
    expect(write).toMatchObject({ type: "oauth2", scopes: ["write"] });
  });

  it("gives every tool a description and a doc_id in its schema", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.schema).toHaveProperty("doc_id");
    }
  });

  it("routes read_document to the stub with the verified identity", async () => {
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
      { getStub: async () => stub as never, identity: ID },
      { doc_id: "abcd1234" },
    );
    expect(stub.agentRead).toHaveBeenCalledWith(ID);
    expect(out).toMatchObject({ markdown: "# Hi" });
  });

  it("rejects a malformed doc_id before touching a stub", async () => {
    const getStub = vi.fn();
    const tool = TOOLS.find((t) => t.name === "read_document")!;
    const out = await tool.run(
      { getStub: getStub as never, identity: ID },
      { doc_id: "NOT-AN-ID" },
    );
    expect(getStub).not.toHaveBeenCalled();
    expect(out).toMatchObject({ error: { code: "doc_not_found" } });
  });

  it("maps insert args onto agentInsert", async () => {
    const stub = { agentInsert: vi.fn(async () => ({ ok: true })) };
    const tool = TOOLS.find((t) => t.name === "insert")!;
    const out = await tool.run(
      { getStub: async () => stub as never, identity: ID },
      { doc_id: "abcd1234", anchor: "b1-aaaabbbb", where: "after", markdown: "hi", pace: "instant" },
    );
    expect(stub.agentInsert).toHaveBeenCalledWith(ID, {
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
      { getStub: async () => stub as never, identity: ID },
      { doc_id: "abcd1234", from_anchor: "b1-aaaabbbb", to_anchor: "b2-ccccdddd", markdown: "x", anchors: ["b1-aaaabbbb", "b2-ccccdddd"] },
    );
    expect(stub.agentReplace).toHaveBeenCalledWith(ID, {
      from: "b1-aaaabbbb",
      to: "b2-ccccdddd",
      markdown: "x",
      pace: undefined,
      anchors: ["b1-aaaabbbb", "b2-ccccdddd"],
    });
  });

  it("maps suggest args onto agentSuggest", async () => {
    const stub = { agentSuggest: vi.fn(async () => ({ ok: true })) };
    const tool = TOOLS.find((t) => t.name === "suggest")!;
    await tool.run(
      { getStub: async () => stub as never, identity: ID },
      { doc_id: "abcd1234", anchor: "b1-aaaabbbb", find: "old", replacement: "new" },
    );
    expect(stub.agentSuggest).toHaveBeenCalledWith(ID, {
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
    const deps = { getStub: async () => stub as never, identity: ID };

    const comment = await TOOLS.find((t) => t.name === "comment")!.run(deps, {
      doc_id: "abcd1234",
      anchor: "b1-aaaabbbb",
      quote: "here",
      text: "why?",
    });
    expect(stub.agentComment).toHaveBeenCalledWith(ID, {
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
    expect(stub.agentReply).toHaveBeenCalledWith(ID, { threadId: "t1", text: "because" });
  });

  it("maps resolve_thread, edit_comment, and delete_comment onto their RPCs", async () => {
    const stub = {
      agentResolveThread: vi.fn(async () => ({ ok: true, resolved: false })),
      agentEditComment: vi.fn(async () => ({ ok: true })),
      agentDeleteComment: vi.fn(async () => ({ ok: true })),
    };
    const deps = { getStub: async () => stub as never, identity: ID };
    const run = (name: string, args: Record<string, unknown>) =>
      TOOLS.find((t) => t.name === name)!.run(deps, { doc_id: "abcd1234", ...args });

    expect(await run("resolve_thread", { thread_id: "t1", resolved: false })).toEqual({ ok: true, resolved: false });
    expect(stub.agentResolveThread).toHaveBeenCalledWith(ID, { threadId: "t1", resolved: false });
    await run("resolve_thread", { thread_id: "t1" });
    expect(stub.agentResolveThread).toHaveBeenLastCalledWith(ID, { threadId: "t1", resolved: undefined });

    await run("edit_comment", { thread_id: "t1", reply_id: "r1", text: "fixed" });
    expect(stub.agentEditComment).toHaveBeenCalledWith(ID, { threadId: "t1", replyId: "r1", text: "fixed" });
    await run("edit_comment", { thread_id: "t1", text: "fixed" });
    expect(stub.agentEditComment).toHaveBeenLastCalledWith(ID, { threadId: "t1", replyId: undefined, text: "fixed" });

    await run("delete_comment", { thread_id: "t1", reply_id: "r1" });
    expect(stub.agentDeleteComment).toHaveBeenCalledWith(ID, { threadId: "t1", replyId: "r1" });
    await run("delete_comment", { thread_id: "t1" });
    expect(stub.agentDeleteComment).toHaveBeenLastCalledWith(ID, { threadId: "t1", replyId: undefined });
  });

  it("maps join/leave onto presence RPCs", async () => {
    const stub = {
      agentJoin: vi.fn(async () => ({ ok: true })),
      agentLeave: vi.fn(async () => ({ ok: true })),
    };
    const deps = { getStub: async () => stub as never, identity: ID };

    await TOOLS.find((t) => t.name === "join")!.run(deps, {
      doc_id: "abcd1234",
      status: "drafting",
    });
    expect(stub.agentJoin).toHaveBeenCalledWith(ID, "drafting");

    await TOOLS.find((t) => t.name === "leave")!.run(deps, { doc_id: "abcd1234" });
    expect(stub.agentLeave).toHaveBeenCalledWith(ID);
  });

  it("converts await_events since_cursor/timeout_s to RPC args", async () => {
    const stub = { agentAwaitEvents: vi.fn(async () => ({ events: [], cursor: 7 })) };
    const tool = TOOLS.find((t) => t.name === "await_events")!;
    await tool.run(
      { getStub: async () => stub as never, identity: ID },
      { doc_id: "abcd1234", since_cursor: 7, timeout_s: 30 },
    );
    expect(stub.agentAwaitEvents).toHaveBeenCalledWith(ID, {
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
      { getStub: async () => stub as never, identity: ID },
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

describe("createDocumentAgentName", () => {
  it("derives create_document's minted agent name from the client's declared name", () => {
    expect(createDocumentAgentName("Claude Code")).toBe("claude-code");
    expect(createDocumentAgentName("Second Session Client")).toBe("second-session-client");
  });

  it("falls back to agent when the client name is absent or unusable", () => {
    expect(createDocumentAgentName(undefined)).toBe("agent");
    expect(createDocumentAgentName("")).toBe("agent");
    expect(createDocumentAgentName("!!!")).toBe("agent");
  });
});

describe("anonymousAgentLabel", () => {
  it("is a stable Agentic <Animal> per session key", async () => {
    const { anonymousAgentLabel } = await import("../../../agents/mcp-tools");
    const { ANON_ANIMALS } = await import("../../../app/shared/anon-animals");
    const a = anonymousAgentLabel("anon:streamable-http:abc123");
    expect(a).toBe(anonymousAgentLabel("anon:streamable-http:abc123"));
    expect(a).toMatch(/^Agentic /);
    expect(ANON_ANIMALS.map((x) => `Agentic ${x.name}`)).toContain(a);
    expect(anonymousAgentLabel("anon:other-session")).toMatch(/^Agentic /);
  });
});

describe("createDocumentNote", () => {
  it("warns an identity without write, in words for its endpoint, and says nothing to one that can edit (#86)", () => {
    expect(createDocumentNote({ kind: "anonymous", caps: ["suggest", "comment"] })).toMatch(/anonymous endpoint.*suggest and comment but not edit/);
    expect(createDocumentNote({ kind: "principal", caps: ["suggest", "comment"] })).toMatch(/this grant can suggest and comment but not edit/);
    expect(createDocumentNote({ kind: "principal", caps: ["suggest", "comment", "write"] })).toBeNull();
  });
});
