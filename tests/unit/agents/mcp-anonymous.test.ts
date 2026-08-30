import { describe, it, expect, vi } from "vitest";
import { runAnonymousTool, type AnonymousAgentState } from "../../../agents/mcp-anonymous";
import { TOOLS } from "../../../agents/mcp-tools";

const readTool = TOOLS.find((t) => t.name === "read_document")!;

function makeStub(overrides: Record<string, unknown> = {}) {
  return {
    agentRead: vi.fn(async () => ({ markdown: "# Hi", blocks: [], presence: [], threads: [] })),
    enrollAnonymousAgent: vi.fn(async () => ({
      token: "vpr_anon1",
      entry: {
        name: "claude-code",
        color: "coral",
        owner: null,
        capabilities: ["suggest", "comment"],
        createdAt: 1,
        lastSeenAt: null,
      },
    })),
    ...overrides,
  };
}

describe("runAnonymousTool", () => {
  it("enrolls once on the first call for a doc and persists the identity", async () => {
    const stub = makeStub();
    let state: AnonymousAgentState = {};
    const setState = vi.fn((next: AnonymousAgentState) => {
      state = next;
    });

    const out = await runAnonymousTool({
      tool: readTool,
      args: { doc_id: "abcd1234" },
      getStub: async () => stub as never,
      baseName: "claude-code",
      state,
      setState,
    });

    expect(stub.enrollAnonymousAgent).toHaveBeenCalledWith("claude-code");
    expect(stub.agentRead).toHaveBeenCalledWith("vpr_anon1");
    expect(setState).toHaveBeenCalledWith({
      abcd1234: { token: "vpr_anon1", name: "claude-code" },
    });
    expect(out).toMatchObject({ markdown: "# Hi" });
  });

  it("reuses a held token on a second call instead of enrolling again", async () => {
    const stub = makeStub();
    const state: AnonymousAgentState = { abcd1234: { token: "vpr_held", name: "claude-code" } };
    const setState = vi.fn();

    const out = await runAnonymousTool({
      tool: readTool,
      args: { doc_id: "abcd1234" },
      getStub: async () => stub as never,
      baseName: "claude-code",
      state,
      setState,
    });

    expect(stub.enrollAnonymousAgent).not.toHaveBeenCalled();
    expect(stub.agentRead).toHaveBeenCalledWith("vpr_held");
    expect(setState).not.toHaveBeenCalled();
    expect(out).toMatchObject({ markdown: "# Hi" });
  });

  it("keeps separate identities per doc_id in the same session", async () => {
    const stub = makeStub();
    let state: AnonymousAgentState = { abcd1234: { token: "vpr_held", name: "claude-code" } };
    const setState = vi.fn((next: AnonymousAgentState) => {
      state = next;
    });

    await runAnonymousTool({
      tool: readTool,
      args: { doc_id: "wxyz5678" },
      getStub: async () => stub as never,
      baseName: "claude-code",
      state,
      setState,
    });

    expect(state).toEqual({
      abcd1234: { token: "vpr_held", name: "claude-code" },
      wxyz5678: { token: "vpr_anon1", name: "claude-code" },
    });
  });

  it("surfaces an enrollment failure as error content, without persisting state", async () => {
    const stub = makeStub({
      enrollAnonymousAgent: vi.fn(async () => ({
        error: { code: "rate_limited", message: "This document already has the maximum of 16 agents." },
      })),
    });
    const setState = vi.fn();

    const out = await runAnonymousTool({
      tool: readTool,
      args: { doc_id: "abcd1234" },
      getStub: async () => stub as never,
      baseName: "claude-code",
      state: {},
      setState,
    });

    expect(stub.agentRead).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
    expect(out).toMatchObject({ error: { code: "rate_limited" } });
  });

  it("skips enrollment and defers to the tool's own validation for a malformed doc_id", async () => {
    const getStub = vi.fn();
    const setState = vi.fn();

    const out = await runAnonymousTool({
      tool: readTool,
      args: { doc_id: "NOT-AN-ID" },
      getStub: getStub as never,
      baseName: "claude-code",
      state: {},
      setState,
    });

    expect(getStub).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
    expect(out).toMatchObject({ error: { code: "doc_not_found" } });
  });
});
