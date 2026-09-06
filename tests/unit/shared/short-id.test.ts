import { describe, it, expect } from "vitest";
import { SHORT_ID_RE, randomShortId, shortIdOf, colorIndexFor, fnv1a32Hex } from "~/shared/short-id";

describe("short ids", () => {
  it("mints eight lowercase alphanumerics", () => {
    for (let i = 0; i < 50; i++) expect(randomShortId()).toMatch(SHORT_ID_RE);
    expect(new Set(Array.from({ length: 50 }, randomShortId)).size).toBeGreaterThan(45);
  });

  it("keeps a short id as it is", () => {
    expect(shortIdOf("k3f0a9x2")).toBe("k3f0a9x2");
  });

  it("reduces a legacy UUID to its first eight hex characters", () => {
    expect(shortIdOf("3b9e02d7-1c4e-4f6a-9a1b-0c2d3e4f5a6b")).toBe("3b9e02d7");
  });

  it("drops a key prefix and rejects anything too short", () => {
    expect(shortIdOf("anon:ab")).toBeNull();
    expect(shortIdOf("")).toBeNull();
    expect(shortIdOf(undefined)).toBeNull();
    expect(shortIdOf("uid:K3F0A9X2")).toBe("k3f0a9x2");
  });

  it("hashes deterministically to a palette index", () => {
    expect(fnv1a32Hex("a")).toMatch(/^[0-9a-f]{8}$/);
    expect(colorIndexFor("k3f0a9x2", 8)).toBe(colorIndexFor("k3f0a9x2", 8));
    expect(colorIndexFor("k3f0a9x2", 8)).toBeLessThan(8);
  });
});
