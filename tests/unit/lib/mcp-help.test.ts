import { describe, it, expect } from "vitest";
import { mcpHelpHtml, mcpHelpMarkdown } from "~/lib/mcp-help";

describe("mcpHelpHtml", () => {
  it("embeds a normal origin into the connection snippets", () => {
    const html = mcpHelpHtml("https://vapor.fyi");
    expect(html).toContain("https://vapor.fyi/mcp");
    expect(html).toContain("claude mcp add");
  });

  it("offers both the signed-in and anonymous doors", () => {
    const html = mcpHelpHtml("https://vapor.fyi");
    expect(html).toContain("claude mcp add --transport http vapor https://vapor.fyi/mcp</pre>");
    expect(html).toContain(
      "claude mcp add --transport http vapor https://vapor.fyi/mcp/anonymous</pre>",
    );
  });

  it("never lets a hostile origin break out of its HTML context", () => {
    const hostile = 'https://evil.example</pre><script>alert(1)</script>"';
    const html = mcpHelpHtml(hostile);

    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain(hostile);
    // Falls back to the known-good default origin instead.
    expect(html).toContain("https://vapor.fyi/mcp");
  });

  it("falls back to the default origin for a non-http(s) or malformed value", () => {
    const html = mcpHelpHtml("javascript:alert(1)");
    expect(html).toContain("https://vapor.fyi/mcp");
    expect(html).not.toContain("javascript:alert(1)");
  });

  it("carries one-click install links and the skill install lines", () => {
    const html = mcpHelpHtml("https://vapor.fyi");
    expect(html).toContain(
      `cursor://anysphere.cursor-deeplink/mcp/install?name=vapor&config=${btoa(JSON.stringify({ url: "https://vapor.fyi/mcp" }))}`,
    );
    expect(html).toContain(
      `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "vapor", type: "http", url: "https://vapor.fyi/mcp" }))}`,
    );
    expect(html).toContain("-o ~/.agents/skills/vapor/SKILL.md");
    expect(html).toContain("gemini extensions install https://github.com/arfct/vapor");
  });

  it("the markdown guide carries the same doors and installs as the page, safely", () => {
    const md = mcpHelpMarkdown("https://vapor.fyi");
    for (const needle of [
      "claude mcp add --transport http vapor https://vapor.fyi/mcp",
      "https://vapor.fyi/mcp/anonymous",
      "codex mcp add vapor --url https://vapor.fyi/mcp",
      "gemini extensions install https://github.com/arfct/vapor",
      "~/.agents/skills/vapor/SKILL.md",
      "https://vapor.fyi/skill.md",
    ]) {
      expect(md).toContain(needle);
    }
    const hostile = mcpHelpMarkdown("https://evil<script>alert(1)</script>");
    expect(hostile).not.toContain("<script");
    expect(hostile).toContain("https://vapor.fyi/mcp");
  });
});
