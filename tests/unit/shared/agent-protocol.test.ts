import { describe, it, expect } from "vitest";
import {
  blockHash, formatAnchor, parseAnchor, findMentions, AGENT_NAME_RE,
  RESERVED_SLUGS, isReservedSlug, slugifyAgentName,
} from "~/shared/agent-protocol";

describe("blockHash", () => {
  it("is deterministic and 8 hex chars", () => {
    expect(blockHash("## Heading")).toBe(blockHash("## Heading"));
    expect(blockHash("## Heading")).toMatch(/^[0-9a-f]{8}$/);
    expect(blockHash("a")).not.toBe(blockHash("b"));
  });
});

describe("anchor round-trip", () => {
  it("formats and parses", () => {
    const a = { index: 3, hash: "1a2b3c4d" };
    expect(formatAnchor(a)).toBe("b3-1a2b3c4d");
    expect(parseAnchor("b3-1a2b3c4d")).toEqual(a);
    expect(parseAnchor("nonsense")).toBeNull();
  });
});

describe("findMentions", () => {
  it("matches roster names only, once each", () => {
    expect(findMentions("hey @scribe and @scribe, not @ghost", ["scribe", "muse"]))
      .toEqual(["scribe"]);
  });
  it("requires word boundary", () => {
    expect(findMentions("email me@scribe.com", ["scribe"])).toEqual([]);
  });
});

describe("AGENT_NAME_RE", () => {
  it("accepts slugs, rejects others", () => {
    expect(AGENT_NAME_RE.test("nicks-agent")).toBe(true);
    expect(AGENT_NAME_RE.test("ab")).toBe(true);
    expect(AGENT_NAME_RE.test("-bad")).toBe(false);
    expect(AGENT_NAME_RE.test("Bad")).toBe(false);
    expect(AGENT_NAME_RE.test("a".repeat(33))).toBe(false);
  });
});

describe("reserved slugs", () => {
  it("covers every root route and well-known path from the spec", () => {
    expect(RESERVED_SLUGS).toEqual(
      expect.arrayContaining([
        "new", "mcp", "agents", "api", "assets", "demo",
        "favicon.ico", "robots.txt", ".well-known",
      ]),
    );
  });

  it("matches reserved names case-insensitively", () => {
    expect(isReservedSlug("new")).toBe(true);
    expect(isReservedSlug(".well-known")).toBe(true);
    expect(isReservedSlug("Robots.txt")).toBe(true);
  });

  it("does not match ordinary document ids", () => {
    expect(isReservedSlug("abcd1234")).toBe(false);
    expect(isReservedSlug("newx1234")).toBe(false);
  });
});

describe("slugifyAgentName", () => {
  it("lowercases and passes through an already-valid slug", () => {
    expect(slugifyAgentName("Claude Code")).toBe("claude-code");
    expect(slugifyAgentName("nicks-agent")).toBe("nicks-agent");
  });

  it("collapses runs of symbols and spaces into single hyphens", () => {
    expect(slugifyAgentName("Test   Client!!")).toBe("test-client");
    expect(slugifyAgentName("my_cool.agent@v2")).toBe("my-cool-agent-v2");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugifyAgentName("--edge--")).toBe("edge");
  });

  it("falls back to agent for empty or symbol-only input", () => {
    expect(slugifyAgentName("")).toBe("agent");
    expect(slugifyAgentName("!!!")).toBe("agent");
    expect(slugifyAgentName("   ")).toBe("agent");
  });

  it("falls back to agent for a single character (below AGENT_NAME_RE's minimum)", () => {
    expect(slugifyAgentName("a")).toBe("agent");
  });

  it("clamps to 32 characters and never leaves a dangling hyphen", () => {
    const long = "a".repeat(40);
    const slug = slugifyAgentName(long);
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(AGENT_NAME_RE.test(slug)).toBe(true);

    const longWithBoundaryHyphen = "b".repeat(31) + "-" + "c".repeat(10);
    const slug2 = slugifyAgentName(longWithBoundaryHyphen);
    expect(slug2.length).toBeLessThanOrEqual(32);
    expect(AGENT_NAME_RE.test(slug2)).toBe(true);
  });

  it("always returns a string matching AGENT_NAME_RE", () => {
    for (const input of ["Claude Code", "", "a", "!!!", "A".repeat(50), "  --  "]) {
      expect(AGENT_NAME_RE.test(slugifyAgentName(input))).toBe(true);
    }
  });
});
