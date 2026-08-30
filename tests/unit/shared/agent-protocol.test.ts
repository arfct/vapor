import { describe, it, expect } from "vitest";
import {
  blockHash, formatAnchor, parseAnchor, findMentions, AGENT_NAME_RE,
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
