import { describe, it, expect } from "vitest";
import { generateAgentToken, hashToken } from "~/lib/agent-tokens";

describe("agent tokens", () => {
  it("generates prefixed unique tokens", () => {
    const t = generateAgentToken();
    expect(t).toMatch(/^vpr_[A-Za-z0-9_-]{43}$/);
    expect(generateAgentToken()).not.toBe(t);
  });
  it("hashes stably to 64 hex chars", async () => {
    expect(await hashToken("vpr_x")).toBe(await hashToken("vpr_x"));
    expect(await hashToken("vpr_x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
