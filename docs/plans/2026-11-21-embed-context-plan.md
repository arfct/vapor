# Embed context: framed by an approved host, telling it what is on screen

_Issue #121. Status: **built** (branch `feat/121-embed-context`)._

**Goal:** an approved embedding host can show a vapor page in a panel beside its own UI (an assistant's chat, or its phone app's WebView). The host's page API asks four things of the page: let it frame the page, make sign-in work inside a third-party frame, make every view a URL, and post an `embed:context` message describing what is on screen. This plan does all four for an instance that names its hosts, and changes nothing for one that doesn't.

## What exists

- No `Content-Security-Policy` or `X-Frame-Options` on any HTML response (checked against the reference instance: `curl -I /` returns neither). Any site may frame vapor today, but the session cookie is `SameSite=Lax`, so a framed page is always signed out.
- One cookie: `vp_session` (`app/lib/auth.server.ts`, `HttpOnly; SameSite=Lax`, `Secure` over https). Theme and anonymous identity live in `localStorage`.
- Cookie-authenticated writes: `/auth/google`, `/auth/apple`, `/me/wake`, `/me/tokens`, `/me/devices`, `/:id/send`, attachment uploads and `/:id/agents` (join) all check `sameOrigin` (the `Origin` header). Two don't: `POST /auth/logout`, and the OAuth consent `POST /oauth/authorize`, whose comment says the same-origin form plus the `SameSite` cookie makes forgery a non-starter. With a `None` cookie that stops being true.
- Sign-in is in the page: the Sign in dialog runs Google's GSI button and Apple's popup, then `fetch`es `/auth/google` or `/auth/apple` same-origin. There is no sign-in page to navigate to; `/auth/*` is JSON.
- `DocumentAgent` never reads the cookie: the Yjs WebSocket's identity is whatever the client puts in awareness, and agents authenticate over MCP with bearer tokens.
- The layout rewrites the visible URL with `history.replaceState` as the title changes (the slug).

## Design

### 1. Who may frame: `EMBED_HOSTS`

A new optional instance var, resolved in `app/shared/site.ts` beside `PUBLIC_ORIGIN`: a space-separated list of CSP host sources (`https://host.example`, `https://*.preview.host.example`, `http://localhost:*`). Each entry must parse as `scheme://[*.]host[:port|:*]`; anything else (a path, a quote, a semicolon that would end the directive) is dropped, so the var can't inject into the header. The reference instance sets it in `deploy/vapor.fyi.jsonc`; the generic `wrangler.jsonc` doesn't, and `tests/unit/deploy-config.test.ts` learns the new var.

- **Set:** every HTML response the Worker sends gets `Content-Security-Policy: frame-ancestors 'self' <hosts>`, unless it already carries a CSP (attachments keep their `sandbox` one). No `X-Frame-Options`.
- **Unset:** no header, exactly as today. Decision: an instance that hasn't opted in keeps today's behaviour rather than gaining `frame-ancestors 'self'`, because some existing page may frame vapor documents (they render signed out, as they always have), and an instance with no hosts has no reason to change who may frame it. The cookie stays `Lax` too (2), so an open frame never carries a session.
- The OAuth consent page gets `frame-ancestors 'none'` always. It is the one page where a click grants something, so it is never framed, set or unset.

Setting the var does narrow framing for that instance to itself and its hosts: any other site that frames its documents today stops being able to. That is the point of naming hosts, and is recorded here because it is a change for the reference instance.

### 2. Cookies a frame needs

With hosts set, `vp_session` is `SameSite=None; Secure` over https; on plain http (local dev) it stays `Lax`, since browsers refuse `None` without `Secure`. Unset, it stays `Lax`. No other cookie exists.

- **Old sessions.** A `Lax` cookie set before this change is invisible to a frame. A first-party document load (`GET`, `Sec-Fetch-Dest: document`, `Sec-Fetch-Site` `same-origin` or `none`, https, hosts set) that carries `vp_session` and no `vp_session_none` marker re-sets the session as `None` and sets the marker, once. Sign-in sets both; sign-out clears both. The cookie's lifetime only bounds when it is sent; the JWT's `exp` still ends the session.
- **Writes from other sites.** `Lax` had kept another site's form from posting with the person's session. The Worker now strips `vp_session` from any `POST`, `PUT`, `PATCH` or `DELETE` whose `Sec-Fetch-Site` is `cross-site` or `same-site`, or, without that header, whose `Origin` is present and not the request's own. The request goes on signed out. Always on, hosts or not: with `Lax` it changes nothing, and it closes the consent page and logout without relying on the cookie attribute. A framed vapor page's own requests are same-origin and keep the session; requests with neither header (MCP clients, agents, servers) carry bearer tokens or nothing and are unaffected.
  - The consent `POST` is a same-origin form, so it passes. Apple's flow is a popup that hands the result back to the page, which `fetch`es `/auth/apple` same-origin: no cross-site post to keep.
- **WebSocket.** A cross-site page can open the document socket (`GET` upgrade at `/agents/*`) and, with a `None` cookie, the browser would send the session. Judged harmless: documents are public by URL, the socket is read/write for anyone with the link already, and `DocumentAgent` never reads the cookie, so the session buys an attacker no identity or attribution. No `Origin` check is added; recorded so a future change that makes the socket trust the cookie adds one.

### 3. `embed:context`

`app/lib/embed-context.ts` posts `{ type: "embed:context", url, title?, selection?, items? }` 250 ms after the last change, each message replacing the one before.

- **Who hears it.** The framing page's origin from `location.ancestorOrigins[0]`, else `document.referrer` (unless it is our own origin, as after a reload inside the frame), else the origin remembered for this tab in `sessionStorage`. It must match `EMBED_HOSTS` under CSP's rules: `*.` is any subdomain (not the bare domain), `:*` any port, no port means the scheme's default. Posted to that exact origin, never `"*"`. The client gets the host list from the root loader (`useSite().embedHosts`); nothing is hardcoded.
- **Not framed.** A normal browser tab posts nothing. An app's embedded WebView (Android's `; wv)`, or an iOS WebKit user agent without `Safari/`) posts to its own window at `location.origin`, which is where such a host listens; only the page's own scripts can hear it. Only when hosts are set.
- **When.** React Router navigations (the root watches `useLocation()`), `popstate`, `hashchange`, `selectionchange`, a page reporting new context, and every URL rewrite the app makes itself (the slug, view params), which go through one `replaceUrl` helper that schedules a send. History isn't monkeypatched.
- **What.** Pages report `{ title, items }` with `useEmbedContext`; the deepest mounted report wins, and without one the document title without ` · vapor`.
  - A document: title is the document's title (its first heading, as the tab title shows it), else `Untitled`. Items: the document (`{ id: <doc id>, type: "document", name: title }`), then, when a comment thread is open, the thread (`{ id: <thread id>, type: "thread", name: <comment, one line> }`). Both ids are the ones the MCP tools take (`doc_id`, `thread_id`).
  - The homepage tour: title `vapor`, no items (it is a local document with no id the API knows).
  - Selection: the DOM selection's text (ProseMirror keeps it in sync with the editor's), plain text, at most 2,000 characters, left out when blank.
- **Limits.** `title` and `name`: one line (breaks, tabs and control characters become spaces, runs collapse), at most 200 code points. `id` and `type` must match `[A-Za-z0-9_.:-]{1,100}`; an item that doesn't is dropped, not mangled. At most 20 items, duplicates dropped. Fields carry data only.

### 4. Every view a URL

Already URLs: a document (`/:slug-:id`), the homepage. Added, written with `replaceState` (so Back still leaves the document) and read on load:

- `?thread=<id>`: the comment thread that is open. Opening one (a click on a highlight, the cursor entering it, the rail) writes it; closing drops it. On load, once threads have loaded, the thread opens and its highlight scrolls into view. An id that no longer exists is dropped from the URL.
- `?dialog=history|send|invite|new|signin`: the open dialog. One at a time, as in the UI. `signin` is also how sign-in opens in a new tab from a frame (5).
- `?view=markdown`: the markdown preview.

Left as they are: the selected version inside History, the client tab and variant inside Invite an agent, the comment sheet's open/closed state on a phone, menus, edit vs. suggest mode (a per-person setting, not a place), and scroll position.

### 5. Inside a frame

- **Links.** A plain click on a link to another origin opens a new tab instead of navigating the frame (the host's sandbox has no top navigation, and most sites refuse to be framed). Text links already open new tabs (#108); this catches the rest (router links in error pages, anything future).
- **Sign in.** The menu's Sign in (and `vapor://signin`, and a drop that needs a session) behaves differently framed and signed out:
  - When `document.hasStorageAccess` exists and says no, a tap calls `document.requestStorageAccess()` from the click; granted, the page reloads with the person's session. Refused, it falls through to the new tab.
  - Otherwise, it opens the same page with `?dialog=signin` in a new tab (Google's and Apple's sign-in refuse to run framed in many browsers, and the frame's sandbox may block their popups), and when the frame gets focus back it re-reads the session, so where third-party cookies reach the frame it turns signed in by itself.
  - Not framed, it opens the dialog as before.

## Not in this plan

- The host's sandbox: `requestStorageAccess()` is refused in a sandboxed frame without `allow-storage-access-by-user-activation`, and a popup inherits the sandbox without `allow-popups-to-escape-sandbox`. Both are asks for the host.
- Items in the viewport, and which block the selection is in.
- An `Origin` check on the document WebSocket (2).

## Tests

`tests/unit/shared/embed-hosts.test.ts` (parsing the var, the directive, the matcher: exact, wildcard subdomain, any port, look-alikes, other schemes and ports); `tests/unit/lib/embed-context.test.ts` (sanitizer, message builder, target selection incl. WebView rule and remembered host, document context builder); `tests/unit/agents/framing.test.ts` (cross-site write detection, cookie stripping, `None`/`Lax`, the upgrade once on a first-party load, the HTML header wrapper, consent `frame-ancestors 'none'`); `tests/unit/lib/framed.test.ts` (which links open outside); view params; the deploy-config test for the new var. In a browser: a harness on `http://localhost:3000` frames the dev server with the host's sandbox and logs each message, for load, a title edit (slug rewrite), a selection, an open thread and dialog; a reload at the reported URL; a top-level tab posting nothing.

## As built

- Server: `app/shared/embed-hosts.ts` (parse, directive, matcher), `workers/framing.ts` (cross-site write guard, `SameSite`, the once-only upgrade, the HTML wrapper), wired at the top of `workers/app.ts`; `/auth/*` takes `framed` and sets or clears the marker with the session; the consent page sends `frame-ancestors 'none'`.
- Client: `app/lib/embed-context.ts` (message, limits, target, `useEmbedContext`, started by `EmbedHost` in `app/root.tsx` with `useSite().embedHosts`), `app/lib/view-url.ts` (`?thread`, `?dialog`, `?view`; `replaceUrl` also carries the slug rewrite), `app/lib/framed.ts` (links, storage access, sign-in tab). The five dialog booleans in `DocumentLayout` became one `dialog` state, since only one is ever open.
- Sign-in from a frame has two entry points: the menu row and `vapor://signin` act from the click; a dropped file that needs a session opens the Sign in dialog, which, framed, shows the one button instead of the providers.
- Verified in headless Chrome with a harness page framing the dev server under the host's sandbox (the harness ran on `localhost:3007`, since 3000 was taken): one debounced message on load, after a title edit (the slug URL), after a mouse selection (`selection` present), after opening a thread (`?thread=`, thread item) and History (`?dialog=history`); reloading the frame at the last reported URL reopened History and the thread; a top-level tab posted nothing; a page on `127.0.0.1:3007` (not a host) was refused by `frame-ancestors`. Over local http the harness and the dev server are the same site, so the storage-access step, the `None` cookie and the upgrade were exercised by unit tests only.

