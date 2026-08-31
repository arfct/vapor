// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getAnonIdentity, retireAnonId, formerAnonId } from "~/lib/anon-identity";
import { ANON_ANIMALS } from "~/shared/anon-animals";
import { USER_COLOURS } from "~/shared/constants";

describe("anon identity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates and persists a stable identity", () => {
    const first = getAnonIdentity();
    const second = getAnonIdentity();
    expect(second.id).toBe(first.id);
    expect(second.animal.glyph).toBe(first.animal.glyph);
    expect(second.colorIndex).toBe(first.colorIndex);
    expect(ANON_ANIMALS.map((a) => a.glyph)).toContain(first.animal.glyph);
    expect(first.colorIndex).toBeGreaterThanOrEqual(0);
    expect(first.colorIndex).toBeLessThan(USER_COLOURS.length);
  });

  it("survives corrupt storage by regenerating", () => {
    localStorage.setItem("vapor-anon", "{not json");
    const identity = getAnonIdentity();
    expect(identity.id).toBeTruthy();
  });

  it("retire moves the id to formerAnonId and clears the identity", () => {
    const identity = getAnonIdentity();
    const retired = retireAnonId();
    expect(retired).toBe(identity.id);
    expect(formerAnonId()).toBe(identity.id);
    const next = getAnonIdentity();
    expect(next.id).not.toBe(identity.id);
  });

  it("retire with no identity returns null", () => {
    expect(retireAnonId()).toBeNull();
  });
});
