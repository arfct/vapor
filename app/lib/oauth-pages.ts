/**
 * The OAuth consent page: a signed-in user approves an MCP client and
 * chooses its capability grant; a signed-out visitor gets inline sign-in
 * first — Google (same GSI flow the header uses) and Sign in with Apple,
 * whichever the instance has configured. Styling matches the /mcp help
 * page. Ported from subpixel server/oauth.ts's consentPage.
 */

const APPLE_JS_URL = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

// The Apple mark, from Simple Icons (CC0). Duplicated from HeaderMenu on
// purpose: this file is a string template with no React.
const APPLE_MARK =
  "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701";

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
    <button id="signin-apple" class="apple" hidden type="button">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="${APPLE_MARK}"/></svg>
      Sign in with Apple
    </button>
    <p id="signin-none" class="muted" hidden>This instance has no sign-in provider configured.</p>
    <script>
      (async () => {
        const config = await (await fetch("/auth/config")).json();
        if (!config.googleClientId && !config.appleClientId) {
          document.getElementById("signin-none").hidden = false;
          return;
        }
        if (config.googleClientId) {
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
        }
        if (config.appleClientId) {
          const button = document.getElementById("signin-apple");
          button.hidden = false;
          button.onclick = async () => {
            button.disabled = true;
            try {
              if (!window.AppleID) {
                await new Promise((resolve, reject) => {
                  const s = document.createElement("script");
                  s.src = "${APPLE_JS_URL}";
                  s.onload = resolve;
                  s.onerror = reject;
                  document.head.appendChild(s);
                });
              }
              AppleID.auth.init({ clientId: config.appleClientId, scope: "name email", redirectURI: location.origin + "/auth/apple", usePopup: true });
              const result = await AppleID.auth.signIn();
              const res = await fetch("/auth/apple", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ id_token: result.authorization.id_token, user: result.user }),
              });
              if (res.ok) location.reload();
            } catch {
              // Popup closed or blocked; the button is usable again.
            } finally {
              button.disabled = false;
            }
          };
        }
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
  button.apple { display: inline-flex; align-items: center; gap: .5rem; margin-top: .75rem; height: 40px; }
  .muted { color: #999; }
  .err { color: #e8564a; }
</style>
<main>
  <h1>vapor</h1>
  ${body}
</main>`;
}
