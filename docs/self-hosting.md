# Running your own vapor

vapor is one Cloudflare Worker plus three Durable Object classes and an R2 bucket. Nothing in it assumes a particular domain: an instance describes itself from the URL it is served at, and the few things a request can't tell it (who operates it, where its source lives) are optional variables. This page goes from a clone to a running instance, locally and on Cloudflare.

## Running locally

You need Node 22 or newer (there is an `.nvmrc`; `nvm use` picks it up) and npm.

```bash
git clone https://github.com/arfct/vapor   # or your fork
cd vapor
npm install
npm run dev
```

The dev server listens on <http://localhost:5173>. It runs the real Worker under Cloudflare's local runtime, so Durable Objects, SQLite storage, and the R2 bucket are all emulated on disk under `.wrangler/` — documents you create locally survive a restart, and the 99-hour expiry runs the same way it does in production. The server binds every interface, so a phone on the same network (or a tailnet hostname ending in `.ts.net`) can open it too.

Everything works anonymously out of the box:

- Open <http://localhost:5173> for the tour document, or <http://localhost:5173/new> for a blank one.
- `curl http://localhost:5173/new -T notes.md` creates a document from a file; `curl http://localhost:5173/<id>.md` reads it back.
- Connect an agent with `claude mcp add --transport http vapor http://localhost:5173/mcp/anonymous`. The guide at <http://localhost:5173/mcp> lists the snippet for every client, and <http://localhost:5173/skill.md> is the drafting skill, both addressed to your local instance.

Sign-in, and with it the signed-in MCP endpoint, attachments, and wake targets, needs two values in `.dev.vars` (git-ignored; copy `.dev.vars.example`):

```bash
cp .dev.vars.example .dev.vars
```

- `SESSION_SECRET` — any long random string. `openssl rand -base64 32` works.
- `GOOGLE_CLIENT_ID` — a Google OAuth client id whose authorized JavaScript origins include `http://localhost:5173`. Creating one is described under [Google sign-in](#google-sign-in) below; the same client can list both your local and production origins.

Restart `npm run dev` after editing `.dev.vars`.

Useful while developing:

```bash
npm run test        # vitest with coverage; npm run test:watch to keep it running
npm run typecheck   # wrangler types + react-router typegen + tsc
npm run lint
npx vitest run tests/unit/lib/critic-marks.test.ts   # one file
```

## Deploying to Cloudflare

You need a Cloudflare account. The free Workers plan is enough to run an instance for a small group; Durable Objects on the free plan use SQLite storage, which is what vapor's migrations declare.

### 1. Sign in and pick the account

```bash
npx wrangler login
npx wrangler whoami            # lists your account ids
export CLOUDFLARE_ACCOUNT_ID=…  # or add "account_id" to wrangler.jsonc
```

### 2. Create the attachments bucket

Attachments (images and files dropped into a document) live in R2, keyed by document. The binding in `wrangler.jsonc` expects a bucket named `vapor-attachments`; rename it there if you prefer another name.

```bash
npx wrangler r2 bucket create vapor-attachments
```

Documents delete themselves after 99 hours, and their attachments are deleted with them. As a backstop for anything that slips through, give the bucket a lifecycle rule that expires objects after five days:

```bash
npx wrangler r2 bucket lifecycle add vapor-attachments expire-attachments --expire-days 5
```

### 3. Set the session secret

Session cookies and MCP access tokens are signed with `SESSION_SECRET`. It is a Workers secret, never a var:

```bash
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
```

Without it, the instance runs anonymous-only: no sign-in, no signed-in MCP endpoint, no attachments. That is a fine way to start.

### 4. Deploy

```bash
npm run deploy
```

This builds the app and publishes the Worker as `vapor` on your `workers.dev` subdomain, printing the URL. Open it: the tour page, `/new`, `/mcp`, and `/skill.md` all describe themselves by that URL. Redeploy the same way whenever you pull changes; Durable Object migrations are applied automatically and existing documents are kept.

### 5. Your own domain (optional)

Add the domain, which must be a zone on the same Cloudflare account, under `routes` in `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "vapor.example", "custom_domain": true }],
```

Deploy again. Cloudflare creates the DNS record and certificate. If you also want `www.vapor.example` or a spare domain to land on the canonical one, add them as further routes and set `PUBLIC_ORIGIN` and `REDIRECT_HOSTS` (next section).

### 6. Instance variables (optional)

All of these are plain vars, set under `"vars"` in `wrangler.jsonc` or in the dashboard (`keep_vars` is on, so dashboard values survive deploys). Every one has a working default.

| Var | What it does | Default |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Enables Google sign-in; see below. | unset: anonymous-only |
| `PUBLIC_ORIGIN` | The canonical origin, e.g. `https://vapor.example`. Used where no request is in hand: the links in wake-up messages sent to agents, and the icon on the MCP server card. Also the target for `REDIRECT_HOSTS`. | unset: each request's own origin |
| `REDIRECT_HOSTS` | Comma-separated hostnames to 301 to `PUBLIC_ORIGIN`, e.g. `www.vapor.example,vpr.example`. | unset: no redirects |
| `OPERATOR_NAME` | Who runs the instance, named on `/privacy` and `/terms`. | unset: the pages stay generic |
| `SOURCE_URL` | Where this instance's code lives. Linked from the footer and the legal pages; if it is a GitHub repo, the `/mcp` guide derives the `claude plugin marketplace add` and `gemini extensions install` commands from it. | the upstream repository |

Analytics are separate: `VITE_FATHOM_SITE_ID` (and optionally `VITE_FATHOM_DOMAINS`) in the build environment enable [Fathom](https://usefathom.com). Unset, no analytics script is served.

### 7. Google sign-in (optional)

Sign-in is what gives people a name instead of an animal, and what agents authenticate against on the `/mcp` endpoint. It uses Google Identity Services with only a public client id; there is no client secret.

1. In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**. You may be asked to configure the consent screen first (External, with the app name and your email is enough).
2. Under **Authorized JavaScript origins**, add every origin the instance is served from: `https://vapor.example`, your `workers.dev` URL if you use it, and `http://localhost:5173` for development. No redirect URIs are needed.
3. Copy the client id (it ends in `.apps.googleusercontent.com`) into `GOOGLE_CLIENT_ID`: under `vars` in `wrangler.jsonc` for production, in `.dev.vars` locally.
4. Make sure `SESSION_SECRET` is set (step 3), then deploy.

### 8. Deploying from GitHub (optional)

`.github/workflows/deploy.yml` deploys on every push to `main` once two repository secrets exist (**Settings → Secrets and variables → Actions**):

- `CLOUDFLARE_API_TOKEN` — an API token created from the **Edit Cloudflare Workers** template.
- `CLOUDFLARE_ACCOUNT_ID` — from the Workers overview page.

Until they are set the workflow runs and skips, so a fork stays green. The optional repository variable `WRANGLER_CONFIG` points the build at a different config file (see the next section).

## Keeping a separate production config

`wrangler.jsonc` is the whole story for one instance. If you also want to deploy from the same checkout to a second place, or keep production's domains out of the default file, put a second config in `deploy/` and select it with `WRANGLER_CONFIG` at build time:

```bash
WRANGLER_CONFIG=deploy/vapor.example.jsonc npm run deploy
```

`deploy/vapor.fyi.jsonc` is the reference instance's file and doubles as a template. Paths inside it are relative to the file (`"main": "../workers/app.ts"`). A test (`tests/unit/deploy-config.test.ts`) checks every file in `deploy/` against `wrangler.jsonc` and fails if anything other than `routes`, `vars`, or `account_id` differs, because a changed name or Durable Object layout would deploy a new Worker and leave the live documents behind.

## Shipping a plugin for your instance

Agents on your instance get everything they need from the instance itself: the `/mcp` guide and `/skill.md` are rewritten to its URL on every request. The Claude Code plugin under `plugin/` and the Gemini extension manifest, though, bundle a fixed connection to the reference instance. To publish your own from a fork:

1. Change the URL in `plugin/.mcp.json` and `gemini-extension.json` to `https://vapor.example/mcp`.
2. In `plugin/skills/vapor/SKILL.md`, replace `https://vapor.fyi` with your origin (`tests/unit/plugin-skill-sync.test.ts` checks that the skill and the bundled connection agree).
3. Set `SOURCE_URL` to your fork so the `/mcp` guide advertises `claude plugin marketplace add you/vapor`.

## Operating notes

- **Data.** Each document is one Durable Object with SQLite storage; sign-in profiles and OAuth state live in a single `Registry` object. Documents delete themselves 99 hours after creation and there is no backup, by design.
- **Quotas.** `node tools/do-usage.mjs` reports Durable Object duration and request counts against the free-tier daily limits; it needs `CLOUDFLARE_ACCOUNT_ID` and an analytics-read API token.
- **Logs.** `npx wrangler tail` streams the Worker's logs; observability is on in the config, so the dashboard keeps recent invocations too.
- **Updating.** Pull, `npm install`, `npm run deploy`. Migrations in `wrangler.jsonc` are append-only; never edit or reorder existing tags.
