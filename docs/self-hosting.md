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

Sign-in, and with it the signed-in MCP endpoint, attachments, and wake targets, needs a session secret and at least one provider in `.dev.vars` (git-ignored; copy `.dev.vars.example`):

```bash
cp .dev.vars.example .dev.vars
```

- `SESSION_SECRET` — any long random string. `openssl rand -base64 32` works.
- `GOOGLE_CLIENT_ID` — a Google OAuth client id whose authorized JavaScript origins include `http://localhost:5173`. Creating one is described under [Sign-in providers](#7-sign-in-providers-optional) below; the same client can list both your local and production origins.
- `APPLE_CLIENT_ID` — optional. Apple only accepts `https` return URLs, so Sign in with Apple is normally exercised on a deployed preview rather than on localhost.

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
| `GOOGLE_CLIENT_ID` | Enables Google sign-in; see below. | unset: no Google button |
| `APPLE_CLIENT_ID` | Enables Sign in with Apple (the Services ID); see below. With neither provider set the instance is anonymous-only. | unset: no Apple button |
| `PUBLIC_ORIGIN` | The canonical origin, e.g. `https://vapor.example`. Used where no request is in hand: the links in wake-up messages sent to agents, and the icon on the MCP server card. Also the target for `REDIRECT_HOSTS`. | unset: each request's own origin |
| `REDIRECT_HOSTS` | Comma-separated hostnames to 301 to `PUBLIC_ORIGIN`, e.g. `www.vapor.example,vpr.example`. | unset: no redirects |
| `OPERATOR_NAME` | Who runs the instance, named on `/privacy` and `/terms`. | unset: the pages stay generic |
| `SEND_FROM_EMAIL` | The address Send to Kindle mails from; pair with the `RESEND_API_KEY` secret. | unset: Kindle row offers the EPUB download instead |
| `OPENAI_APPS_CHALLENGE` | The domain-verification token from OpenAI's plugin portal, served at `/.well-known/openai-apps-challenge`; see [Listing in ChatGPT](#listing-in-chatgpt). | unset: the path 404s |
| `SOURCE_URL` | Where this instance's code lives. Linked from the footer and the legal pages; if it is a GitHub repo, the `/mcp` guide derives the `claude plugin marketplace add` and `gemini extensions install` commands from it. | the upstream repository |

**Send to Kindle** needs the instance to send email. Two more optional values enable it: `SEND_FROM_EMAIL`, the address documents are sent from (a var), and `RESEND_API_KEY`, an API key for [Resend](https://resend.com) whose account has that address's domain verified (a secret: `wrangler secret put RESEND_API_KEY`). With either unset the Kindle row in Share → Send to device offers the EPUB download and Amazon's upload page instead. Readers add your sender address to their Amazon approved senders once; the dialog shows them the exact address. Send to reMarkable needs nothing from the operator.

Analytics are separate: `VITE_FATHOM_SITE_ID` (and optionally `VITE_FATHOM_DOMAINS`) in the build environment enable [Fathom](https://usefathom.com). Unset, no analytics script is served.

### 7. Sign-in providers (optional)

Sign-in is what gives people a name instead of an animal, and what agents authenticate against on the `/mcp` endpoint. Configure Google, Apple, or both; the header menu and the MCP consent page show one button per configured provider. Each uses only a public client id; there is no client secret to keep. Whichever provider someone uses, their identity is that provider's stable account id, so the same person signing in with Google one day and Apple the next gets two separate profiles.

**Google**

1. In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **Web application**. You may be asked to configure the consent screen first (External, with the app name and your email is enough).
2. Under **Authorized JavaScript origins**, add every origin the instance is served from: `https://vapor.example`, your `workers.dev` URL if you use it, and `http://localhost:5173` for development. No redirect URIs are needed.
3. Copy the client id (it ends in `.apps.googleusercontent.com`) into `GOOGLE_CLIENT_ID`: under `vars` in `wrangler.jsonc` for production, in `.dev.vars` locally.

**Apple**

Needs a paid Apple Developer Program membership.

1. In [Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list), create an **App ID** (any bundle id, e.g. `example.vapor`) with the **Sign in with Apple** capability enabled. It exists only to own the Services ID.
2. Create a **Services ID** (e.g. `example.vapor.web`), enable **Sign in with Apple** on it, and click **Configure**: choose the App ID as the primary, then register your **domain** (`vapor.example`) and the **return URL** `https://vapor.example/auth/apple`. Add one return URL per origin you serve from; Apple requires `https`, so localhost cannot be listed.
3. The Services ID string is your `APPLE_CLIENT_ID`; put it under `vars` in `wrangler.jsonc`.

Two Apple particulars: it sends the person's name only on their first authorization, which vapor stores then and keeps afterwards, and people who choose **Hide My Email** appear under a private relay address, which is the address others would need to mention them by.

Whichever you set up, make sure `SESSION_SECRET` is set (step 3), then deploy.

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

## Listing in ChatGPT

Anyone on ChatGPT can already add an instance as a connector in developer mode. Reaching people on free and Plus plans, and on mobile, takes a listing in the ChatGPT plugins directory, which is a review process on the operator's side; the code does its part on every instance:

- Tools declare `title`, `annotations` (read-only, destructive, open-world), and which credentials they accept (`noauth` for the anonymous endpoint, `oauth2` with the capability scope). Results come back as `structuredContent` alongside the text.
- `GET /oauth/userinfo` returns the bearer's `sub`, `email`, and `email_verified: true` (both providers verify addresses), and the server metadata names it as `userinfo_endpoint`.
- `GET /.well-known/openai-apps-challenge` serves whatever `OPENAI_APPS_CHALLENGE` holds. Set it to the token the portal shows during domain verification, deploy, and click verify; you can unset it afterwards.
- `/privacy` lists what is stored, why, who sees it, and for how long, which the review asks for.

The portal side, in order: verify your organisation's identity on [platform.openai.com](https://platform.openai.com), then under Plugins submit the MCP URL (`https://vapor.example/mcp`), the OAuth details (discovered from `/.well-known/oauth-authorization-server`; dynamic client registration is on), the privacy and terms URLs, and a test account the reviewers can sign in with that does not require multi-factor authentication. A personal access token (Share → Invite an agent → Other) minted by that account works as the reviewers' bearer if they prefer one over the sign-in flow. Reviews look at every tool once, so keep the descriptions honest about what each writes.

## Operating notes

- **Data.** Each document is one Durable Object with SQLite storage; sign-in profiles and OAuth state live in a single `Registry` object. Documents delete themselves 99 hours after creation and there is no backup, by design.
- **Quotas.** `node tools/do-usage.mjs` reports Durable Object duration and request counts against the free-tier daily limits; it needs `CLOUDFLARE_ACCOUNT_ID` and an analytics-read API token.
- **Logs.** `npx wrangler tail` streams the Worker's logs; observability is on in the config, so the dashboard keeps recent invocations too.
- **Updating.** Pull, `npm install`, `npm run deploy`. Migrations in `wrangler.jsonc` are append-only; never edit or reorder existing tags.
