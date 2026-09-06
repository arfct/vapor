import { describe, it, expect } from "vitest";
import { readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { handleSkill, skillMarkdown } from "../../workers/routes";

const root = join(__dirname, "..", "..");
const canonical = readFileSync(join(root, "plugin", "skills", "vapor", "SKILL.md"), "utf8");

describe("plugin skill", () => {
  it("is served at /skill.md with every URL pointed at the serving instance", async () => {
    const res = handleSkill(new Request("https://vapor.example/skill.md"));
    expect(res).not.toBeNull();
    expect(res!.headers.get("Content-Type")).toContain("text/markdown");
    const body = await res!.text();
    expect(body).not.toContain("vapor.fyi");
    expect(body).toContain("curl https://vapor.example/new -T draft.md");
    expect(body).toContain("claude mcp add --transport http vapor https://vapor.example/mcp");
    expect(body).toContain("curl https://vapor.example/<id>.md -o draft.md");
    // Only the host changes: the text is otherwise the plugin's canonical skill.
    expect(body).toBe(canonical.split("https://vapor.fyi").join("https://vapor.example"));
  });

  it("the canonical skill is written against the reference instance, which the rewrite relies on", () => {
    expect(canonical).toContain("https://vapor.fyi/new");
    expect(canonical).toContain("https://vapor.fyi/mcp");
    expect(skillMarkdown("https://vapor.fyi")).toBe(canonical);
  });

  it("falls through for anything that is not GET /skill.md", () => {
    expect(handleSkill(new Request("https://vapor.example/skill.md", { method: "POST" }))).toBeNull();
    expect(handleSkill(new Request("https://vapor.example/skills.md"))).toBeNull();
  });

  it("the Codex/Cursor/Copilot and Gemini skill folders are links to the canonical file", () => {
    for (const link of [
      join(root, ".agents", "skills", "vapor", "SKILL.md"),
      join(root, "skills", "vapor", "SKILL.md"),
    ]) {
      expect(readlinkSync(link)).toMatch(/plugin\/skills\/vapor\/SKILL\.md$/);
      expect(readFileSync(link, "utf8")).toBe(canonical);
    }
  });

  it("the plugin bundle and the Gemini extension point at one signed-in MCP endpoint", () => {
    const manifest = JSON.parse(readFileSync(join(root, "gemini-extension.json"), "utf8"));
    const mcp = JSON.parse(readFileSync(join(root, "plugin", ".mcp.json"), "utf8"));
    expect(manifest.name).toBe("vapor");
    expect(manifest.mcpServers.vapor.oauth).toEqual({ enabled: true });
    expect(manifest.mcpServers.vapor.httpUrl).toBe(mcp.mcpServers.vapor.url);
    expect(manifest.mcpServers.vapor.httpUrl).toMatch(/^https:\/\/[^/]+\/mcp$/);
    // The skill's own URLs match the bundled connection, so an installed
    // plugin drafts on the instance it connects to.
    const origin = manifest.mcpServers.vapor.httpUrl.replace(/\/mcp$/, "");
    expect(canonical).toContain(`${origin}/new`);
  });
});
