// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAnonIdentity, retireAnonId, formerAnonId } from "~/lib/anon-identity";
import { ANON_ANIMALS, ANON_ADJECTIVES } from "~/shared/anon-animals";
import { USER_COLOURS } from "~/shared/constants";

describe("anon identity", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates and persists a stable identity", () => {
    const first = getAnonIdentity();
    const second = getAnonIdentity();
    expect(second.id).toBe(first.id);
    expect(second.animal.glyph).toBe(first.animal.glyph);
    expect(second.colorIndex).toBe(first.colorIndex);
    expect(second.adjective).toBe(first.adjective);
    expect(ANON_ADJECTIVES).toContain(first.adjective);
    expect(ANON_ANIMALS.map((a) => a.glyph)).toContain(first.animal.glyph);
    expect(first.colorIndex).toBeGreaterThanOrEqual(0);
    expect(first.colorIndex).toBeLessThan(USER_COLOURS.length);
  });

  it("assigns an adjective to a pre-adjective stored identity, once", () => {
    localStorage.setItem(
      "vapor-anon",
      JSON.stringify({ id: "legacy-id", animalIndex: 1, colorIndex: 2 }),
    );
    const first = getAnonIdentity();
    expect(first.id).toBe("legacy-id");
    expect(ANON_ADJECTIVES).toContain(first.adjective);
    const second = getAnonIdentity();
    expect(second.adjective).toBe(first.adjective);
  });

  it("survives corrupt storage by regenerating", () => {
    localStorage.setItem("vapor-anon", "{not json");
    const identity = getAnonIdentity();
    expect(identity.id).toBeTruthy();
  });

  it("returns an ephemeral identity when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const identity = getAnonIdentity();
    expect(identity.id).toBeTruthy();
    expect(ANON_ADJECTIVES).toContain(identity.adjective);
    expect(retireAnonId()).toBeNull();
    expect(formerAnonId()).toBeNull();
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
