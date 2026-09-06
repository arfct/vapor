import { describe, it, expect } from "vitest";
import {
  blockHash, formatAnchor, parseAnchor, findMentions, findEmailMentions, isEmailQuery, slugifyName, rankMentionItems, AGENT_NAME_RE,
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

describe("findMentions and email mentions", () => {
  it("does not read the local part of an email mention as an agent", () => {
    expect(findMentions("ping @ada@example.com", ["ada"])).toEqual([]);
    expect(findMentions("ping @ada@example.com and @ada", ["ada"])).toEqual(["ada"]);
  });
  it("allows a sentence-ending period but not a domain", () => {
    expect(findMentions("thanks @scribe.", ["scribe"])).toEqual(["scribe"]);
    expect(findMentions("see @scribe.com", ["scribe"])).toEqual([]);
    expect(findMentions("@scribe-x is not @scribe", ["scribe"])).toEqual(["scribe"]);
  });
  it("finds email mentions, lowercased and once each", () => {
    expect(findEmailMentions("cc @Ada@Example.com, @ada@example.com; not ada@example.com"))
      .toEqual(["ada@example.com"]);
    expect(findEmailMentions("@a.b+c@sub.example.co.uk done")).toEqual(["a.b+c@sub.example.co.uk"]);
    expect(findEmailMentions("@scribe only")).toEqual([]);
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
    agents: [{ name: "scribe", label: "Ada's Agent", color: "#111" }],
    people: [
      { name: "Ada Lovelace", color: "#222", id: "email:Ada@Example.com", avatar: "a.png" },
      { name: "Quiet Otter", color: "#333", id: "anon-1", animal: "🦦" },
      { name: "Scribe", color: "#444" },
      { name: "Bot", color: "#555", isAgent: true },
    ],
  };

  it("lists agents first, signed-in people by email, anonymous people by slug", () => {
    const items = rankMentionItems("", sources);
    expect(items.map((i) => [i.kind, i.handle])).toEqual([
      ["agent", "scribe"],
      ["person", "ada@example.com"],
      ["person", "quiet-otter"],
      ["person", "scribe-2"],
    ]);
    expect(items[0].label).toBe("Ada's Agent");
    expect(items[1].detail).toBe("ada@example.com");
  });

  it("filters by handle, label, and any word of the name", () => {
    expect(rankMentionItems("love", sources).map((i) => i.handle)).toEqual(["ada@example.com"]);
    expect(rankMentionItems("ott", sources).map((i) => i.handle)).toEqual(["quiet-otter"]);
    expect(rankMentionItems("scr", sources).map((i) => i.handle)).toEqual(["scribe", "scribe-2"]);
  });

  it("adds a typed email as its own row unless it is already listed", () => {
    const typed = rankMentionItems("bob@example.org", sources);
    expect(typed).toEqual([{ kind: "email", handle: "bob@example.org", label: "Mention bob@example.org" }]);
    const known = rankMentionItems("ada@example.com", sources);
    expect(known.map((i) => i.kind)).toEqual(["person"]);
  });

  it("caps the list", () => {
    const many = { agents: [], people: Array.from({ length: 20 }, (_, i) => ({ name: `Person ${i}`, color: "#000" })) };
    expect(rankMentionItems("", many, 5)).toHaveLength(5);
  });
});
