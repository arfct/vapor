import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_CLIENTS, agentClient, agentClientFor } from "~/shared/agent-clients";

const root = join(__dirname, "..", "..", "..");

describe("agent clients", () => {
  it("has a mark file for every client, monochrome and untitled", () => {
    for (const client of AGENT_CLIENTS) {
      const file = join(root, "app", "assets", "agents", `${client.id}.svg`);
      expect(existsSync(file), client.id).toBe(true);
      const svg = readFileSync(file, "utf8");
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('fill="currentColor"');
      expect(svg).not.toContain("<title>");
      expect(svg).not.toMatch(/fill="#/);
    }
  });

  it("identifies a client from what it declares, and falls back to other", () => {
    expect(agentClientFor("claude-code")).toBe("claude");
    expect(agentClientFor("Claude Desktop")).toBe("claude");
    expect(agentClientFor("ChatGPT")).toBe("chatgpt");
    expect(agentClientFor("openai-mcp")).toBe("chatgpt");
    expect(agentClientFor("codex-cli")).toBe("chatgpt");
    expect(agentClientFor("Cursor")).toBe("cursor");
    expect(agentClientFor("gemini-cli")).toBe("gemini");
    expect(agentClientFor("Visual Studio Code")).toBe("vscode");
    expect(agentClientFor("GitHub Copilot")).toBe("vscode");
    expect(agentClientFor("lmstudio-mcp-server-session")).toBe("lmstudio");
    expect(agentClientFor("LM Studio")).toBe("lmstudio");
    expect(agentClientFor("mcp-inspector")).toBe("other");
    expect(agentClientFor(undefined)).toBe("other");
    expect(agentClientFor("")).toBe("other");
  });

  it("keeps recognised-only clients out of the invite tabs", () => {
    expect(AGENT_CLIENTS.find((c) => c.id === "lmstudio")?.invite).toBe(false);
    expect(AGENT_CLIENTS.filter((c) => c.invite !== false).map((c) => c.id)).not.toContain("lmstudio");
  });

  it("looks up by id with other as the fallback", () => {
    expect(agentClient("cursor").label).toBe("Cursor");
    expect(agentClient("nope").id).toBe("other");
  });
});
