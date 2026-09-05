# Attachments

**Issue:** [#37](https://github.com/arfct/vapor/issues/37). **Roadmap:** tier 2 item 5 in the [notes features roadmap](2026-08-31-notes-features-roadmap.md), scheduled last because it needs infrastructure decisions.

**Goal:** A signed-in person drops, pastes, or picks a file and it lands in the document as an inline attachment: images render as previews, everything else as a file chip. An authenticated agent can do the same through a tool. Files live in R2, are addressed by document-scoped URLs, and disappear with the document at 99 hours. Markdown stays complete: every attachment has a GFM form, so `/:id.md`, agents, and upload/download round-trip without loss.

**Relationship to other plans:** independent of version history (#35). Extends the schema in `app/shared/rich-markdown.ts`, which currently disables markdown-it's `image` rule because images were not representable. The formatting toolbar plan reserved an "Attach file" slot in the Insert menu. Reuses the identity stack from the [identity design](2026-08-30-identity-design.md): the `vp_session` cookie for humans, the OAuth door for agents.

## Decisions

The issue listed three blockers. All three were decided on 2026-09-05. Decisions 1 and 2 still need dashboard work by the account owner, hence the `user-action` label.

### 1. R2 binding

**Decided:** one bucket, `vapor-attachments`, bound as `ATTACHMENTS` in `wrangler.jsonc`. Objects keyed `<docId>/<attachmentId>` so expiry can list-and-delete by prefix. Add an R2 lifecycle rule deleting objects older than 5 days as a backstop for any DO that never fires its alarm.

User actions: enable R2 on the account if it is not already, `wrangler r2 bucket create vapor-attachments`, add the lifecycle rule, and record the bucket in `arfct/internal`'s `accounts.md` per the deployment primer. Local development needs nothing: wrangler simulates R2.

### 2. Size and type limits

**Decided,** one tier, since every uploader is identified:

| Limit | Value |
|---|---|
| Per file | 20 MB |
| Per document | 100 MB |
| Files per document | 100 |
| Per principal, rolling 24 h | 500 MB and 200 uploads, across all documents |
| Agent `attach` tool payload | 4 MB decoded (base64 inflates it to about 5.5 MB of JSON) |

Types: allow images (`png`, `jpeg`, `gif`, `webp`), `pdf`, plain text and markdown, `csv`, `json`, `zip`, and common office formats. Refuse `html`, `svg`, `js`, executables, and anything whose sniffed magic bytes disagree with the claimed image type. The server sets `Content-Type` from sniffing, never from the client.

### 3. Who can upload (decided)

**Uploads require a principal.** That is a human with a `vp_session` cookie from Google sign-in, or an agent on the OAuth `/mcp` door holding the `write` capability. Anonymous humans and the tokenless `/mcp/anonymous` door cannot upload.

This is the one place vapor puts a feature behind sign-in. Reading, editing, commenting, and viewing attachments stay open to everyone by URL. The rationale is that storage is the only part of the product where an anonymous visitor can impose a durable, metered cost on the account, and Google accounts are the cheapest identity we already have.

What this buys:

- Every byte in the bucket is attributable to a principal, so abuse has a name and a per-principal budget can be enforced in one place.
- The per-IP rate-limiting rule becomes optional rather than load-bearing.
- No CAPTCHA, no Turnstile, no new service.

What it costs: an anonymous visitor who drops an image sees a sign-in prompt instead of an upload. The UI must make that a one-click Google sign-in and then complete the drop, not lose it.

## Design

### Data model

An `attachments` table in the document's DO:

```
id TEXT PRIMARY KEY      -- 16 random base32 chars
filename TEXT            -- sanitized original name
content_type TEXT        -- sniffed
bytes INTEGER
uploader TEXT            -- principal ("email:…")
uploader_name TEXT       -- "Ada" or "Ada's Agent"
created_at INTEGER
state TEXT               -- 'reserved' | 'ready'
```

The document budget is `SUM(bytes) WHERE state = 'ready'` plus outstanding reservations. Reservations older than five minutes are treated as abandoned and reclaimed on the next reserve.

The per-principal budget lives in the `Registry` DO, which already holds profiles keyed by principal: an `upload_ledger` table of `(principal, created_at, bytes)` rows, summed over the trailing 24 hours and pruned on write. One extra DO RPC per upload.

### Upload flow

`POST /:docId/attachments` is a pure handler in `workers/routes.ts`, wired in `workers/app.ts` before `routeAgentRequest`, with R2, the document stub, and the Registry stub injected so it stays unit-testable like `handleRawMarkdown`.

1. Validate the id with `isValidDocumentId`. Resolve the principal: `sessionFromRequest` for the cookie, or `verifySessionToken` on an `Authorization: Bearer` OAuth token carrying `write`. Cookie requests must be same-origin. No principal is a 401 with a JSON body the client turns into the sign-in prompt.
2. Require `Content-Length`; refuse chunked uploads. R2's `put` with a stream needs a known length, and the length is also what the budget check uses.
3. `registry.reserveUploadBudget(principal, bytes)` then `stub.reserveAttachment({filename, claimedType, bytes, uploader})`. Either can refuse: `doc_not_found`, `doc_expired`, `attachment_too_large`, `attachment_budget`, `principal_budget`, `attachment_type`.
4. Sniff the first bytes of the body, then stream to `ATTACHMENTS.put("<docId>/<id>", body)` through a counting `TransformStream` that aborts if the stream exceeds the declared length. The body is never buffered in the Worker.
5. `stub.commitAttachment(id, {contentType, bytes})` flips the row to `ready`. On any failure, delete the object (free in R2), release both reservations.
6. Respond `{id, url, filename, contentType, bytes}` where `url` is the relative path below.

No presigned direct-to-R2 uploads: they need an R2 API token as a Worker secret and bypass both budget checks. Proxying through the Worker costs a request, not egress, and keeps one enforcement point.

### Agent upload

Two paths, both through the same reserve/commit code:

- **`attach` MCP tool** (`agents/mcp-tools.ts`): `{doc_id, filename, content_base64, anchor?, where?}`. Decodes, sniffs, enforces the 4 MB cap, uploads, then inserts the attachment block at the anchor like `insert` does. Requires `write`; refused with `capability_denied` on the anonymous door. Convenient for screenshots, small diagrams, generated CSVs.
- **HTTP route with a Bearer token** for anything larger, up to 20 MB. The tool description tells agents this path exists; the response includes the markdown to `insert`.

Fetching an image from a URL on the agent's behalf is deliberately absent: a server-side fetch of arbitrary URLs is an SSRF primitive. An agent that wants a web image downloads it itself and attaches the bytes.

### Serving

`GET /:docId/attachments/:id/:filename` streams from R2 with:

- `Content-Type` from the row, `X-Content-Type-Options: nosniff`.
- `Content-Disposition: inline` for allowed image types, `attachment` for everything else.
- `Content-Security-Policy: default-src 'none'; sandbox` so even a mis-sniffed file cannot script against the origin.
- `Cache-Control: public, max-age=<remaining document lifetime>, immutable`, and the response is put in `caches.default` so repeat views in a colo never reach R2.

The URL contains both the document id and a 16-character attachment id, so guessing requires both. Documents are public by URL already, so this is the same exposure model as the text. Viewing needs no sign-in.

### Markdown form

Two node shapes, both block-level atoms in `richSchema`, both with a canonical GFM form:

| Node | Attrs | Markdown |
|---|---|---|
| `attachment` kind `image` | `src`, `alt`, `bytes` | `![alt](/abc12345/attachments/<id>/<filename>)` alone in a paragraph |
| `attachment` kind `file` | `src`, `filename`, `bytes` | `[filename](/abc12345/attachments/<id>/<filename>)` alone in a paragraph |

Parsing: re-enable markdown-it's `image` rule. An image whose URL matches the attachment path pattern becomes an image attachment; an image pointing anywhere else stays as literal text, exactly as today (no hotlinking or tracking pixels in a public document). A paragraph consisting solely of a link whose href matches the pattern becomes a file attachment; any other link is still a link.

Serialization stores the relative path. `exportMarkdown` and `/:id.md` rewrite it to an absolute URL on the request's origin at serialization time, which is the "URLs resolved per request" in the issue. Round-trip tests in `tests/unit/shared/rich-markdown.test.ts` cover both node kinds and both failure modes (foreign image, ordinary link).

### Editor

- `app/lib/attachment.ts`: a TipTap node with a React node view (`NodeViewWrapper`). Image kind renders the `<img>` with a caption row (filename, size); file kind renders a chip with a type icon, filename, size, and a download link. Selected state matches the code-block chrome.
- **Insert paths:** file drop and paste in `editorProps` (`handleDrop`, `handlePaste`, alongside the existing markdown paste handler); an "Attach file" item in the Insert menu; the `+` sheet on mobile opens the native picker.
- **Signed-out flow:** the drop or menu action is held in memory, the Google sign-in prompt from `HeaderMenu` opens, and on success the held upload proceeds. If the user dismisses, the drop is discarded with a short notice. The menu item stays visible when signed out so the feature is discoverable.
- **Upload before insert.** The node is inserted only after the server responds, so the CRDT never holds a half-uploaded placeholder that another client could see or an agent could read. Progress shows as a small pill decoration at the drop position, cleared on success or failure. Failure shows the server's reason (too large, over budget, type not allowed).
- **Suggest mode:** attaching is a structural change, so it is refused in suggest mode with the same notice `SuggestStructureGuard` shows for other blocked structure edits.
- **Deleting the node** does not delete the object. Undo, other clients, and version history may still reference it; expiry cleans up.

### Expiry

The DO `alarm` gains `ATTACHMENTS.list({prefix: docId + "/"})` and a `delete` of the returned keys, then drops the `attachments` table. The lifecycle rule covers a DO that is deleted without its alarm running.

### Documents copied from the homepage sandbox

"New document" POSTs the sandbox's markdown to a fresh DO. Attachment URLs inside it still point at the sandbox document and stop working when that document expires. Acceptable for v1; noted in the code where the copy happens.

## Costs and scale

Prices below are from Cloudflare's pricing pages on 2026-09-05. Egress from R2 is free, which is the single fact that makes a public, share-by-URL image host affordable at all.

### Unit prices

| Resource | Included | Overage |
|---|---|---|
| R2 storage | 10 GB-month per month | $0.015 per GB-month |
| R2 Class A (PutObject, ListObjects) | 1 million per month | $4.50 per million |
| R2 Class B (GetObject) | 10 million per month | $0.36 per million |
| R2 DeleteObject | free | free |
| R2 egress | free | free |
| Workers requests (paid plan, $5 per month) | 10 million per month | $0.30 per million |
| DO requests (paid) | 1 million per month | $0.15 per million |
| DO SQLite rows written | 50 million per month | $1.00 per million |

### What one upload costs

One PutObject, three or four DO requests (reserve budget, reserve attachment, commit, ledger prune), about four SQLite row writes, two Worker requests (upload, first view). At the unit prices above that is roughly $0.000006 per upload before any free tier. The dominant term at scale is not uploads but GetObject calls from viewers, and the edge cache absorbs most of those.

### Storage is transient

Nothing lives longer than 99 hours, so steady-state storage is small relative to monthly upload volume:

```
GB-month stored  ≈  GB uploaded per month  ×  (99 h / 720 h)  ≈  0.14 × monthly upload volume
```

Uploading 100 GB a month keeps only about 14 GB resident on average.

### Three scenarios, monthly

Assumptions: average attachment 1.5 MB, each attachment viewed 50 times at origin after the edge cache (a conservative cache hit rate), every upload is one Class A op.

| | Quiet | Busy | Viral or abused |
|---|---|---|---|
| Uploads per month | 1,500 | 20,000 | 200,000 |
| Uploaded volume | 2.3 GB | 30 GB | 300 GB |
| Resident storage | 0.3 GB-month | 4.1 GB-month | 41 GB-month |
| Origin GETs | 75,000 | 1,000,000 | 10,000,000 |
| R2 storage cost | $0 | $0 | $0.47 |
| R2 operations cost | $0 | $0 | $0 (Class A) + $0 (Class B at the 10 M line) |
| Workers request overage | $0 | $0 | about $3 |
| DO request overage | $0 | $0 | about $0.10 |
| **Total beyond the $5 Workers plan** | **$0** | **$0** | **under $5** |

The viral column moves about 15 TB out of R2 to viewers. On S3 or GCS that egress alone would be several hundred dollars; on R2 it is nothing. If Class B ops climb past the included 10 million, each further 10 million viewer requests costs $3.60.

### Worst case per principal

The 24 hour ledger caps one Google account at 500 MB a day, so about 15 GB a month and 2 GB-month resident: three cents of storage. A determined abuser needs many Google accounts to become visible on the bill, and every object they store names the account that put it there.

### Platform limits that shape the design

- **Worker memory is 128 MB per isolate**, shared across concurrent requests. Uploads and downloads stream through `TransformStream` and never buffer. The `attach` tool is the exception because JSON-RPC delivers the whole payload at once, hence its 4 MB cap.
- **Request body limit is 100 MB** on Free and Pro zone plans. The 20 MB file cap sits well under it with no plan change.
- **R2 `put` with a stream requires a known length**, which is why `Content-Length` is mandatory and chunked uploads are refused.
- **DO SQLite** stores attachment metadata only, never bytes. The 2 MB per-value cap is irrelevant here.
- **The Registry is one global DO.** Adding a ledger RPC per upload is fine at any volume in the table above (200,000 uploads a month is under one request every ten seconds). If uploads ever approach hundreds per second, shard the ledger by principal hash into its own DO class; the RPC signature does not change.
- **Expiry cleanup** is one ListObjects per 1,000 keys plus free deletes, run inside the alarm that already exists. A 100-file document costs one Class A op to clean.
- **Edge cache** makes viewer cost scale with the number of colos that see a document times its attachments, not with viewer count. A document with 10 images read from 50 colos is about 500 GetObjects regardless of whether 100 or 100,000 people open it.

## Tasks

1. **Infrastructure (user action):** create the bucket and lifecycle rule; add the `ATTACHMENTS` binding to `wrangler.jsonc` and `workers/env.d.ts`; run `npm run cf-typegen`. Optional: a per-IP rate-limiting rule on `POST */attachments` as belt-and-braces.
2. **Policy module** (`app/shared/attachment-policy.ts`, pure): caps, allowed types, magic-byte sniffing, filename sanitization, URL pattern and builder, ledger arithmetic. Unit tests.
3. **Schema and markdown:** `attachment` node in `richSchema`, parser rules, serializer rules, origin-absolute rewriting in export. Round-trip tests.
4. **Registry:** `upload_ledger` table, `reserveUploadBudget` and `releaseUploadBudget` RPCs with 24 hour pruning.
5. **DocumentAgent:** `attachments` table, `reserveAttachment`, `commitAttachment`, `releaseAttachment`, budget arithmetic, R2 cleanup in `alarm`.
6. **Worker routes:** upload and serve handlers in `workers/routes.ts` with injected deps, cookie and Bearer principal resolution; wiring in `workers/app.ts`. Tests in `tests/unit/agents/worker-routes.test.ts` with a fake R2 and fake stubs.
7. **Agent `attach` tool** in `agents/mcp-tools.ts` and its `DocumentAgent` RPC, sharing the reserve/commit path; tool description documents the Bearer route for larger files. Tests alongside `mcp-tools.test.ts`.
8. **Editor:** node view, drop and paste handlers, Insert menu item, mobile picker, signed-out hold-and-resume flow, progress pill, suggest-mode refusal. Component tests for the node view and the toolbar item.
9. **Docs:** attachment section in `docs/markdown-and-criticmarkup.md` (the two canonical forms and the same-origin rule), `/mcp` help page and server instructions mention `attach`, the sign-in requirement stated on the help page, and the bucket entry in `accounts.md`.

## Sequencing

Task 1 is the only external dependency and can happen in parallel with tasks 2 and 3, which are pure and testable with no bucket. Tasks 4 to 8 need the binding to run end to end locally, but wrangler's local R2 means no deploy is required until the final verification on vapor.fyi.

## Out of scope

Anonymous uploads; fetching images by URL on an agent's behalf; external image embedding; image resizing or thumbnails; galleries or multi-file layouts; copying attachments when a document is duplicated; attachment-level comments; virus scanning.
