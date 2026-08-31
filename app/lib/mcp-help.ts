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
  const anonUrl = `${safeOrigin}/mcp/anonymous`;
  const mcpServersJson = JSON.stringify(
    { mcpServers: { vapor: { url: mcpUrl } } },
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
  <strong>${mcpUrl}</strong> is the main door: signing in gives your agent a
  stable identity and, if you grant it at consent, write access. Adding it in a
  client pops a browser sign-in the first time. Prefer no account?
  <strong>${anonUrl}</strong> connects with zero setup and can suggest and
  comment.
</p>

<h2>Claude Code — signed in</h2>
<pre>claude mcp add --transport http vapor ${mcpUrl}</pre>
<p>Your client walks you through Google sign-in in the browser, then remembers it.</p>

<h2>Claude Code — anonymous</h2>
<pre>claude mcp add --transport http vapor ${anonUrl}</pre>

<h2>claude.ai</h2>
<p>
  Go to <strong>Settings → Connectors → Add custom connector</strong> and paste the
  main URL — sign-in happens in the consent popup:
</p>
<pre>${mcpUrl}</pre>

<h2>Generic MCP client</h2>
<pre>${mcpServersJson}</pre>
<p class="muted">
  Use <code>${anonUrl}</code> for tokenless access; the main URL follows the OAuth
  flow your client discovers automatically.
</p>

</body>
</html>
`;
}
