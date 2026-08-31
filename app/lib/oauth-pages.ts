/**
 * The OAuth consent page: a signed-in user approves an MCP client and
 * chooses its capability grant; a signed-out visitor gets inline Google
 * sign-in first (same GSI flow the header uses). Styling matches the /mcp
 * help page. Ported from subpixel server/oauth.ts's consentPage.
 */

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

export function consentPageHtml(opts: {
  clientName: string;
  email: string | null;
  params: Record<string, string>;
  error?: string;
}): string {
  const { clientName, email, params, error } = opts;
  const hidden = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("\n      ");

  const body = error
    ? `<p class="err">${escapeHtml(error)}</p>`
    : email
      ? `<p><b>${escapeHtml(clientName)}</b> wants to join vapor documents as your agent, acting as <b>${escapeHtml(email)}</b>.</p>
    <form method="POST" action="/oauth/authorize">
      ${hidden}
      <label class="cap"><input type="radio" name="caps" value="suggest" checked>
        <span><b>Suggest &amp; comment</b><br><small>Tracked changes and comments only — you accept or reject.</small></span></label>
      <label class="cap"><input type="radio" name="caps" value="write">
        <span><b>Full write</b><br><small>Direct edits, no review step.</small></span></label>
      <div class="row">
        <button name="decision" value="approve">Approve</button>
        <button name="decision" value="deny" class="deny">Deny</button>
      </div>
    </form>`
      : `<p><b>${escapeHtml(clientName)}</b> wants to connect to vapor. Sign in to continue.</p>
    <div id="signin"></div>
    <script>
      (async () => {
        const config = await (await fetch("/auth/config")).json();
        if (!config.googleClientId) return;
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.onload = () => {
          google.accounts.id.initialize({
            client_id: config.googleClientId,
            callback: async (r) => {
              const res = await fetch("/auth/google", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ credential: r.credential }),
              });
              if (res.ok) location.reload();
            },
          });
          google.accounts.id.renderButton(document.getElementById("signin"), { theme: "outline" });
        };
        document.head.appendChild(s);
      })();
    </script>`;

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vapor — connect</title>
<style>
  body { background: #fafafa; color: #1a1a1a; font: 16px/1.5 system-ui, sans-serif;
         display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { max-width: 26rem; padding: 2rem; }
  h1 { font-size: 1.1rem; letter-spacing: .02em; font-weight: 700; }
  .cap { display: flex; gap: .6rem; align-items: flex-start; padding: .6rem .7rem;
         border: 1px solid #e5e5e5; border-radius: .4rem; margin: .5rem 0; cursor: pointer; }
  .cap small { color: #999; }
  .row { margin-top: 1rem; }
  button { font: inherit; padding: .5rem 1.4rem; margin-right: .75rem; cursor: pointer;
           background: #1a1a1a; color: #fafafa; border: 0; border-radius: .35rem; }
  button.deny { background: #eee; color: #555; }
  .err { color: #e8564a; }
</style>
<main>
  <h1>vapor</h1>
  ${body}
</main>`;
}
