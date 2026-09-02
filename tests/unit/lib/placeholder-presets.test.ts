import { describe, it, expect } from "vitest";
import { PLACEHOLDER_PRESETS, placeholderPreset } from "~/lib/placeholder-presets";

describe("placeholder presets", () => {
  it("every preset has a title and a body", () => {
    for (const p of PLACEHOLDER_PRESETS) {
      expect(p.title.trim().length).toBeGreaterThan(0);
      expect(p.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("is stable per document id and varies across ids", () => {
    expect(placeholderPreset("kdpmr303")).toEqual(placeholderPreset("kdpmr303"));
    const picks = new Set(["a1b2c3d4", "kdpmr303", "xsth95yx", "ru1tayyo", "wnkuot6g", "hhf9yd7n"].map((id) => placeholderPreset(id).title));
    expect(picks.size).toBeGreaterThan(1);
  });
});
