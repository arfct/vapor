/**
 * The HTML help page served at `GET /mcp` when a browser asks for it
 * (Accept: text/html) — API/MCP clients POST and never see this. Rendered by
 * `workers/routes.ts`'s `handleMcpHelp`.
 */

/** Fallback used whenever `origin` doesn't look like a plain http(s) origin. */
const DEFAULT_ORIGIN = "https://vapor.fyi";

/**
 * `origin` comes from `url.origin` in workers/routes.ts, which derives from
 * the client-controlled Host header — it is interpolated unescaped into raw
 * HTML below (a `<pre>` block and a JSON literal), so a crafted Host like
 * `https://evil<script>...` must never reach the template. Restricting it to
 * the character set a real http(s) origin can contain (scheme, host,
 * optional port/IPv6 brackets) rules out `<`, `>`, `"`, `'`, and `/` beyond
 * the scheme separator, so nothing here can break out of its context.
 */
const SAFE_ORIGIN_RE = /^https?:\/\/[a-z0-9.:[\]-]+$/i;

export function mcpHelpHtml(origin: string): string {
  const safeOrigin = SAFE_ORIGIN_RE.test(origin) ? origin : DEFAULT_ORIGIN;
  const mcpUrl = `${safeOrigin}/mcp`;
  const mcpServersJson = JSON.stringify(
    {
      mcpServers: {
        vapor: {
          url: mcpUrl,
          headers: {
            Authorization: "Bearer <token>",
          },
        },
      },
    },
    null,
    2,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vapor MCP</title>
<style>
  body {
    background-color: #fafafa;
    color: #1a1a1a;
    font-family: ui-sans-serif, system-ui, sans-serif;
    max-width: 640px;
    margin: 0 auto;
    padding: 3rem 1.5rem 5rem;
    line-height: 1.6;
  }
  h1 {
    font-size: 1.5rem;
    margin-bottom: 0.25rem;
  }
  h2 {
    font-size: 1.05rem;
    margin-top: 2.5rem;
    margin-bottom: 0.5rem;
  }
  p {
    color: #1a1a1a;
  }
  .muted {
    color: #999;
  }
  pre {
    background-color: #fff;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 0.9rem 1rem;
    overflow-x: auto;
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 0.85rem;
  }
  code {
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 0.85em;
  }
  a {
    color: #e8564a;
  }
</style>
</head>
<body>
<h1>vapor MCP</h1>
<p class="muted">A Model Context Protocol server for editing vapor documents.</p>

<p>
  Every vapor document is a live, multiplayer markdown file. This MCP server lets an
  agent read a document, insert or replace text, suggest tracked changes, comment,
  and watch for mentions — the same document a person has open in their browser,
  edited alongside them in real time.
</p>

<p>
  Connecting works with no token at all: the first tool call auto-enrolls an
  anonymous agent (suggest + comment) named after your client. A token is only
  needed for direct-write access or a stable identity across sessions — mint
  one from the document's <strong>Invite agent</strong> dialog, shown once, so
  copy it right away.
</p>

<h2>Claude Code</h2>
<pre>claude mcp add --transport http vapor ${mcpUrl}</pre>
<p>With a token, for write access or a stable identity:</p>
<pre>claude mcp add --transport http vapor ${mcpUrl} --header "Authorization: Bearer &lt;token&gt;"</pre>

<h2>claude.ai</h2>
<p>
  Go to <strong>Settings → Connectors → Add custom connector</strong> and paste this URL:
</p>
<pre>${mcpUrl}</pre>
<p>
  That works tokenless. For write access or a stable identity, claude.ai will also
  take an <code>Authorization</code> header — use <code>Bearer &lt;token&gt;</code>
  with your document's token.
</p>

<h2>Generic MCP client</h2>
<pre>${mcpServersJson}</pre>
<p class="muted">Omit the <code>headers</code> block entirely to connect tokenless.</p>

<p class="muted">
  Tokens are minted per document, from that document's <strong>Invite agent</strong> dialog —
  there's no account or API key to set up separately.
</p>
</body>
</html>
`;
}
