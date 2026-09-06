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
  const mcpServersJson = JSON.stringify({ mcpServers: { vapor: { url: mcpUrl } } }, null, 2);
  const cursorJson = mcpServersJson;
  const vscodeJson = JSON.stringify({ servers: { vapor: { type: "http", url: mcpUrl } } }, null, 2);
  const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=vapor&config=${btoa(JSON.stringify({ url: mcpUrl }))}`;
  const vscodeLink = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "vapor", type: "http", url: mcpUrl }))}`;
  const skillUrl = `${safeOrigin}/skill.md`;

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
  h3 {
    font-size: 0.95rem;
    margin-top: 1.5rem;
    margin-bottom: 0.25rem;
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
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9rem;
  }
  td, th {
    text-align: left;
    vertical-align: top;
    padding: 0.35rem 0.6rem 0.35rem 0;
    border-bottom: 1px solid #e5e5e5;
  }
  th {
    color: #999;
    font-weight: normal;
  }
</style>
</head>
<body>
<h1>vapor MCP</h1>
<p class="muted">A Model Context Protocol server for editing vapor documents.</p>

<p>
  Every vapor document is a live, multiplayer markdown file. This MCP server lets an
  agent read a document, insert or replace text, attach files, suggest tracked changes,
  comment, and watch for mentions — the same document a person has open in their
  browser, edited alongside them in real time.
</p>

<p>
  <strong>${mcpUrl}</strong> is the main door: signing in gives your agent a
  stable identity ("Ada's Agent") and, if you grant it at consent, write access.
  Adding it in a client pops a browser sign-in the first time. Prefer no account?
  <strong>${anonUrl}</strong> connects with zero setup and can suggest and
  comment as an anonymous animal.
</p>

<h2>Connect a client</h2>
<p>
  Every client below takes the same URL. Use the main door to sign in, or the
  anonymous door to skip it. Swap the URL to switch.
</p>

<h3>Claude Code</h3>
<pre>claude mcp add --transport http vapor ${mcpUrl}</pre>
<p class="muted">Your client walks you through Google sign-in in the browser, then remembers it. Anonymous:</p>
<pre>claude mcp add --transport http vapor ${anonUrl}</pre>
<p>
  The <a href="https://github.com/arfct/vapor">vapor plugin</a> bundles this
  connection with a skill that drafts plans on vapor and answers comments:
  <code>claude plugin marketplace add arfct/vapor</code>, then
  <code>claude plugin install vapor@vapor</code>.
</p>

<h3>claude.ai and Claude Desktop</h3>
<p>
  <strong>Settings → Connectors → Add custom connector</strong>, paste the main URL.
  Sign-in happens in the consent popup.
</p>
<pre>${mcpUrl}</pre>

<h3>ChatGPT</h3>
<p>
  <strong>Settings → Connectors → Advanced</strong>, turn on Developer mode
  (custom connectors need a paid plan). Choose Create, name it <code>vapor</code>,
  paste the URL, and pick OAuth to sign in or No authentication for the anonymous
  door. In a chat, enable the connector from the tools menu and paste a document link.
</p>

<h3>Codex CLI</h3>
<pre>codex mcp add vapor --url ${mcpUrl}
codex mcp login vapor</pre>

<h3>Cursor</h3>
<p><a href="${cursorLink}">Add to Cursor</a>, or put this in <code>.cursor/mcp.json</code> in the project (<code>~/.cursor/mcp.json</code> for every project), then sign in from Settings → MCP:</p>
<pre>${cursorJson}</pre>

<h3>Gemini CLI</h3>
<p>The extension bundles the connection and the skill below in one install:</p>
<pre>gemini extensions install https://github.com/arfct/vapor</pre>
<p class="muted">Or add the server alone:</p>
<pre>gemini mcp add --transport http vapor ${mcpUrl}</pre>

<h3>VS Code and GitHub Copilot</h3>
<p><a href="${vscodeLink}">Add to VS Code</a>, or put this in <code>.vscode/mcp.json</code>:</p>
<pre>${vscodeJson}</pre>

<h3>Anything else</h3>
<p>Most clients accept this shape, and follow the OAuth flow they discover automatically:</p>
<pre>${mcpServersJson}</pre>
<p class="muted">
  Building your own agent? The Anthropic and OpenAI APIs both take a remote MCP
  server URL directly; point them at the anonymous door, or at the main door with
  an access token from the OAuth flow.
</p>

<h2>Teach the agent the workflow</h2>
<p>
  The connection gives an agent the tools. A small skill teaches it the habit: draft
  on vapor instead of pasting into chat, share the link, watch for comments, and
  export back to the repo before the document expires. It's one file in the
  <a href="https://agentskills.io">Agent Skills</a> format, served at
  <code>${skillUrl}</code>, and the same file works in every client that reads skills.
</p>
<p>Claude Code (the plugin above installs it too):</p>
<pre>curl -s ${skillUrl} --create-dirs -o ~/.claude/skills/vapor/SKILL.md</pre>
<p>Codex CLI, Cursor, and GitHub Copilot share one folder:</p>
<pre>curl -s ${skillUrl} --create-dirs -o ~/.agents/skills/vapor/SKILL.md</pre>
<p class="muted">
  Gemini CLI gets it with the extension. In a repository, the same file under
  <code>.agents/skills/vapor/</code> reaches every contributor's agent at once.
  ChatGPT has no equivalent; the connector gives it the tools, and the workflow lives
  in the conversation.
</p>

<h2>What an agent can do</h2>
<table>
<tr><th>Tool</th><th>Needs</th><th></th></tr>
<tr><td><code>read_document</code></td><td>—</td><td>Markdown, block anchors, who is present, open threads, and any standing instructions.</td></tr>
<tr><td><code>suggest</code></td><td>suggest</td><td>A tracked change inside a block, for a person to accept or reject.</td></tr>
<tr><td><code>comment</code>, <code>reply</code></td><td>comment</td><td>Open a thread on a block, or answer in one.</td></tr>
<tr><td><code>insert</code>, <code>replace</code></td><td>write</td><td>Direct edits, typed in at human pace with a visible cursor (<code>pace: "instant"</code> skips the show).</td></tr>
<tr><td><code>attach</code></td><td>write, signed in</td><td>Upload a file (base64, up to 4 MB) and insert it: images render inline, other files as a chip. Images, PDF, text, CSV, JSON, zip, and office formats.</td></tr>
<tr><td><code>create_document</code></td><td>—</td><td>A new document, optionally with starting markdown. Returns its URL.</td></tr>
<tr><td><code>join</code>, <code>leave</code></td><td>—</td><td>Show up in the presence stack with a short status, and step out.</td></tr>
<tr><td><code>events_poll</code>, <code>events_subscribe</code></td><td>—</td><td>Watch the document; see below.</td></tr>
</table>
<p>
  Anonymous agents get suggest and comment. Signed-in agents get the grant chosen on
  the consent screen: suggest and comment, or full write. Every agent shows in the
  document's Agents panel (Share → Invite an agent), where anyone can revoke it.
</p>

<h2>Standing instructions</h2>
<p>
  A document can carry guidance for agents that people don't see in the rendered
  page: a fenced block whose language is <code>agent</code>. Anywhere in the
  document, as many as you like.
</p>
<pre>\`\`\`agent
Keep the tone plain. Suggest, don't edit, in the Decisions section.
Reply to comments in the thread, not in the body.
\`\`\`</pre>
<p>
  <code>read_document</code> returns them joined as <code>instructions</code>, and
  the server tells agents to follow them while working in that document.
</p>

<h2>Watching a document</h2>
<p>
  Documents emit three events: <code>mention</code> when the text says
  <code>@agent-name</code> (the name shown in the Agents panel),
  <code>thread.reply</code> when a person answers in a thread the agent took part in,
  and <code>document.changed</code>, a digest of edits. An agent picks them up in one
  of two ways.
</p>
<p>
  <strong>Poll for a while.</strong> After sharing a link, stay with the document
  for about ten minutes, since the reader is most likely reading right now: call
  <code>events_poll</code> with the cursor from the previous call and wait at least
  <code>retryAfterMs</code> between empty polls. Answer mentions and thread replies as
  they arrive, then go back to what you were doing and return when asked or
  mentioned. (<code>await_events</code>, the older long-poll, still works but is
  deprecated.)
</p>
<p>
  <strong>Subscribe with a webhook.</strong> An agent on the signed-in door with a
  reachable HTTPS receiver can register one with <code>events_subscribe</code>: pass
  the URL and a client-generated secret (<code>whsec_</code> + base64 of 24&ndash;64
  random bytes), and vapor POSTs each occurrence there, signed per
  <a href="https://www.standardwebhooks.com/">Standard Webhooks</a>
  (<code>webhook-id</code> / <code>webhook-timestamp</code> /
  <code>webhook-signature</code> headers). Subscriptions last the document's
  remaining lifetime by default and are refreshed by re-subscribing;
  <code>events_unsubscribe</code> ends one early. This surface mirrors the
  draft MCP Events extension and will track the standard as it ratifies.
</p>
<p>
  To stop an agent for good, revoke it in the Agents panel. Documents and everything
  in them, subscriptions included, expire 99 hours after creation.
</p>

</body>
</html>
`;
}
