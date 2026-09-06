import { describe, it, expect } from "vitest";
import { mcpHelpHtml, mcpHelpMarkdown } from "~/lib/mcp-help";
import { siteForRequest, type SiteConfig } from "~/shared/site";

const site: SiteConfig = {
  origin: "https://vapor.example",
  operatorName: null,
  sourceUrl: "https://github.com/someone/vapor",
};

describe("mcpHelpHtml", () => {
  it("embeds the instance origin into the connection snippets", () => {
    const html = mcpHelpHtml(site);
    expect(html).toContain("https://vapor.example/mcp");
    expect(html).toContain("claude mcp add");
  });

  it("offers both the signed-in and anonymous URLs", () => {
    const html = mcpHelpHtml(site);
    expect(html).toContain("claude mcp add --transport http vapor https://vapor.example/mcp</pre>");
    expect(html).toContain("claude mcp add --transport http vapor https://vapor.example/mcp/anonymous</pre>");
  });

  it("never lets a hostile Host header reach the page", () => {
    // siteForRequest is the gate the worker runs every request origin through.
    const hostile = 'https://evil.example</pre><script>alert(1)</script>"';
    const html = mcpHelpHtml(siteForRequest({ PUBLIC_ORIGIN: "https://vapor.example" }, hostile));

    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain(hostile);
    expect(html).toContain("https://vapor.example/mcp");
  });

  it("carries one-click install links and the skill install lines", () => {
    const html = mcpHelpHtml(site);
    expect(html).toContain(
      `cursor://anysphere.cursor-deeplink/mcp/install?name=vapor&config=${btoa(JSON.stringify({ url: "https://vapor.example/mcp" }))}`,
    );
    expect(html).toContain(
      `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "vapor", type: "http", url: "https://vapor.example/mcp" }))}`,
    );
    expect(html).toContain("-o ~/.agents/skills/vapor/SKILL.md");
  });

  it("derives the plugin and extension installs from SOURCE_URL when it is a GitHub repo", () => {
    const html = mcpHelpHtml(site);
    expect(html).toContain("claude plugin marketplace add someone/vapor");
    expect(html).toContain("gemini extensions install https://github.com/someone/vapor");
    expect(html).not.toContain("arfct/vapor");
  });

  it("omits the plugin and extension installs when the source is not on GitHub", () => {
    const html = mcpHelpHtml({ ...site, sourceUrl: "https://git.example/vapor" });
    expect(html).not.toContain("claude plugin marketplace add");
    expect(html).not.toContain("gemini extensions install");
    expect(html).toContain("gemini mcp add --transport http vapor https://vapor.example/mcp");
  });

  it("the markdown guide carries the same URLs and installs as the page", () => {
    const md = mcpHelpMarkdown(site);
    for (const needle of [
      "claude mcp add --transport http vapor https://vapor.example/mcp",
      "https://vapor.example/mcp/anonymous",
      "codex mcp add vapor --url https://vapor.example/mcp",
      "gemini extensions install https://github.com/someone/vapor",
      "claude plugin marketplace add someone/vapor",
      "~/.agents/skills/vapor/SKILL.md",
      "https://vapor.example/skill.md",
      "Source and plugin: https://github.com/someone/vapor",
    ]) {
      expect(md).toContain(needle);
    }
    const generic = mcpHelpMarkdown({ ...site, sourceUrl: "https://git.example/vapor" });
    expect(generic).not.toContain("gemini extensions install");
    expect(generic).toContain("~/.gemini/skills/vapor/SKILL.md");
  });
});
