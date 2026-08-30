import { describe, it, expect } from "vitest";
import { mcpHelpHtml } from "~/lib/mcp-help";

describe("mcpHelpHtml", () => {
  it("embeds a normal origin into the connection snippets", () => {
    const html = mcpHelpHtml("https://vapor.fyi");
    expect(html).toContain("https://vapor.fyi/mcp");
    expect(html).toContain("claude mcp add");
  });

  it("leads with a tokenless connection snippet, and keeps the token instructions too", () => {
    const html = mcpHelpHtml("https://vapor.fyi");
    expect(html).toContain("claude mcp add --transport http vapor https://vapor.fyi/mcp</pre>");
    expect(html).toContain(
      'claude mcp add --transport http vapor https://vapor.fyi/mcp --header "Authorization: Bearer &lt;token&gt;"',
    );
    expect(html).toContain("Invite agent");
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
});
