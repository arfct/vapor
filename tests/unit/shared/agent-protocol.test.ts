import { describe, it, expect } from "vitest";
import {
  blockHash, formatAnchor, parseAnchor, findMentions, findMentionTokens, parseMentionToken, formatMention, personMention,
  agentMention, stripMentionIds, isEmailQuery, slugifyName, rankMentionItems, AGENT_NAME_RE,
  RESERVED_SLUGS, isReservedSlug, slugifyAgentName,
  type AgentIdentity,
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
  it("matches a token by tag and short id, ignoring the slug", () => {
    const roster = [{ name: "nicholas-jitkoff", mention: "nicholas-jitkoff+agent~k3f0a9x2" }];
    expect(findMentions("ask @nick+agent~k3f0a9x2 please", roster)).toEqual(["nicholas-jitkoff"]);
    expect(findMentions("ask @nicholas-jitkoff~k3f0a9x2 please", roster)).toEqual([]);
    expect(findMentions("ask @nicholas-jitkoff+agent~zzzzzzzz please", roster)).toEqual([]);
  });
  it("still matches a bare slug for agents named before tokens", () => {
    const roster = [{ name: "scribe", mention: "scribe~c41d7e90" }];
    expect(findMentions("@scribe do it", roster)).toEqual(["scribe"]);
    expect(findMentions("@scribe~c41d7e90 do it", roster)).toEqual(["scribe"]);
  });
});

describe("mention tokens", () => {
  it("round-trips through parse and format", () => {
    const token = { slug: "nicholas-jitkoff", tag: "agent", sid: "k3f0a9x2" };
    expect(formatMention(token)).toBe("nicholas-jitkoff+agent~k3f0a9x2");
    expect(parseMentionToken("nicholas-jitkoff+agent~k3f0a9x2")).toEqual(token);
    expect(parseMentionToken("quiet-otter~3b9e02d7")).toEqual({ slug: "quiet-otter", tag: null, sid: "3b9e02d7" });
    expect(parseMentionToken("quiet-otter")).toBeNull();
    expect(parseMentionToken("quiet-otter~short")).toBeNull();
  });
  it("finds tokens in prose and not in addresses or unfinished ids", () => {
    const found = findMentionTokens("cc @ada~k3f0a9x2, @bob+agent~d02e77b4. not me@ada~k3f0a9x2 nor @x~k3f0a9x2z");
    expect(found.map(formatMention)).toEqual(["ada~k3f0a9x2", "bob+agent~d02e77b4"]);
  });
  it("derives a person's and an agent's token from name and id", () => {
    expect(personMention("Nicholas Jitkoff", "k3f0a9x2")).toBe("nicholas-jitkoff~k3f0a9x2");
    expect(personMention("Quiet Otter", "3b9e02d7-1c4e-4f6a-9a1b-0c2d3e4f5a6b")).toBe("quiet-otter~3b9e02d7");
    expect(personMention("Quiet Otter", undefined)).toBeNull();
    expect(agentMention("Nicholas Jitkoff", "k3f0a9x2")).toBe("nicholas-jitkoff+agent~k3f0a9x2");
  });
  it("strips ids for plain-text display", () => {
    expect(stripMentionIds("hi @nicholas-jitkoff+agent~k3f0a9x2 and @ada~d02e77b4!")).toBe("hi @nicholas-jitkoff and @ada!");
    expect(stripMentionIds("no mentions here")).toBe("no mentions here");
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
        "auth", "oauth", "settings",
      ]),
    );
  });

  it("matches reserved names case-insensitively", () => {
    expect(isReservedSlug("new")).toBe(true);
    expect(isReservedSlug(".well-known")).toBe(true);
    expect(isReservedSlug("Robots.txt")).toBe(true);
  });

  it("reserves the identity-phase routes (auth, oauth, settings)", () => {
    expect(isReservedSlug("auth")).toBe(true);
    expect(isReservedSlug("oauth")).toBe(true);
    expect(isReservedSlug("settings")).toBe(true);
  });

  it("does not match ordinary document ids", () => {
    expect(isReservedSlug("abcd1234")).toBe(false);
    expect(isReservedSlug("newx1234")).toBe(false);
  });
});

describe("AgentIdentity", () => {
  it("accepts the verified-identity shape from both endpoints", () => {
    const identity: AgentIdentity = {
      kind: "principal",
      id: "email:foo@bar.com",
      name: "foo-bar",
      owner: "email:foo@bar.com",
      caps: ["comment", "suggest"],
    };
    expect(identity.kind).toBe("principal");
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

describe("findMentions boundaries", () => {
  it("does not read the local part of an email mention as an agent", () => {
    expect(findMentions("ping @ada@example.com", ["ada"])).toEqual([]);
    expect(findMentions("ping @ada@example.com and @ada", ["ada"])).toEqual(["ada"]);
  });
  it("allows a sentence-ending period but not a domain", () => {
    expect(findMentions("thanks @scribe.", ["scribe"])).toEqual(["scribe"]);
    expect(findMentions("see @scribe.com", ["scribe"])).toEqual([]);
    expect(findMentions("@scribe-x is not @scribe", ["scribe"])).toEqual(["scribe"]);
  });
  it("isEmailQuery recognises a complete address only", () => {
    expect(isEmailQuery("ada@example.com")).toBe(true);
    expect(isEmailQuery("ada@example")).toBe(false);
    expect(isEmailQuery("ada")).toBe(false);
  });
});

describe("slugifyName", () => {
  it("slugs display names and rejects the unsluggable", () => {
    expect(slugifyName("Quiet Otter")).toBe("quiet-otter");
    expect(slugifyName("Ada Lovelace")).toBe("ada-lovelace");
    expect(slugifyName("!!!")).toBeNull();
  });
});

describe("rankMentionItems", () => {
  const sources = {
    agents: [{ name: "ada-lovelace", label: "Ada's Claude", color: "#111", mention: "ada-lovelace+agent~k3f0a9x2", client: "Claude" }],
    people: [
      { name: "Ada Lovelace", color: "#222", id: "k3f0a9x2", avatar: "a.png" },
      { name: "Quiet Otter", color: "#333", id: "3b9e02d7-1c4e-4f6a-9a1b-0c2d3e4f5a6b", animal: "🦦" },
      { name: "Scribe", color: "#444" },
      { name: "Bot", color: "#555", isAgent: true },
    ],
  };

  it("lists agents first, then people, each as a token; a person with no id gets a slug", () => {
    const items = rankMentionItems("", sources);
    expect(items.map((i) => [i.kind, i.handle])).toEqual([
      ["agent", "ada-lovelace+agent~k3f0a9x2"],
      ["person", "ada-lovelace~k3f0a9x2"],
      ["person", "quiet-otter~3b9e02d7"],
      ["person", "scribe"],
    ]);
    expect(items[0].label).toBe("Ada's Claude");
    expect(items[0].detail).toBe("@ada-lovelace+agent");
    expect(items[0].client).toBe("Claude");
    expect(items[1].detail).toBe("@ada-lovelace");
    expect(items.every((i) => !i.handle.includes("@"))).toBe(true);
  });

  it("filters by handle, label, and any word of the name", () => {
    expect(rankMentionItems("love", sources).map((i) => i.handle)).toEqual(["ada-lovelace~k3f0a9x2"]);
    expect(rankMentionItems("ott", sources).map((i) => i.handle)).toEqual(["quiet-otter~3b9e02d7"]);
    expect(rankMentionItems("scr", sources).map((i) => i.handle)).toEqual(["scribe"]);
  });

  it("adds a typed email as a row to resolve, never as a handle to insert", () => {
    const typed = rankMentionItems("bob@example.org", sources);
    expect(typed).toEqual([{ kind: "email", handle: "bob@example.org", label: "Mention bob@example.org" }]);
  });

  it("caps the list", () => {
    const many = { agents: [], people: Array.from({ length: 20 }, (_, i) => ({ name: `Person ${i}`, color: "#000" })) };
    expect(rankMentionItems("", many, 5)).toHaveLength(5);
  });
});
