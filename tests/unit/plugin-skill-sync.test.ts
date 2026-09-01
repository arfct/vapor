import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");

describe("plugin skill sync", () => {
  it("public/skill.md matches the plugin's canonical SKILL.md", () => {
    const published = readFileSync(join(root, "public", "skill.md"), "utf8");
    const canonical = readFileSync(
      join(root, "plugin", "skills", "vapor", "SKILL.md"),
      "utf8",
    );
    expect(published).toBe(canonical);
  });
});
