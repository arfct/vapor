import { describe, it, expect } from "vitest";
import { readFileSync, readlinkSync } from "node:fs";
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

  it("the Codex/Cursor/Copilot and Gemini skill folders are links to the canonical file", () => {
    const canonical = readFileSync(join(root, "plugin", "skills", "vapor", "SKILL.md"), "utf8");
    for (const link of [
      join(root, ".agents", "skills", "vapor", "SKILL.md"),
      join(root, "skills", "vapor", "SKILL.md"),
    ]) {
      expect(readlinkSync(link)).toMatch(/plugin\/skills\/vapor\/SKILL\.md$/);
      expect(readFileSync(link, "utf8")).toBe(canonical);
    }
  });

  it("the Gemini extension manifest points at the signed-in MCP door", () => {
    const manifest = JSON.parse(readFileSync(join(root, "gemini-extension.json"), "utf8"));
    expect(manifest.name).toBe("vapor");
    expect(manifest.mcpServers.vapor.httpUrl).toBe("https://vapor.fyi/mcp");
    expect(manifest.mcpServers.vapor.oauth).toEqual({ enabled: true });
  });
});
