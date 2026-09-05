# Version history with restore

**Issue:** [#35](https://github.com/arfct/vapor/issues/35). **Roadmap:** tier 2 item 4 in the [notes features roadmap](2026-08-31-notes-features-roadmap.md).

**Goal:** Every document keeps a short trail of markdown snapshots for its 99-hour life. A history dialog lists them, attributed to the person or agent whose edits produced them ("Ada" vs "Ada's Agent"), previews any one, and restores it as an ordinary edit that every connected client sees immediately and that can itself be undone by restoring again.

**Relationship to other plans:** independent of attachments (#37). Touches the same `"agent"` transaction origin that [#40](https://github.com/arfct/vapor/issues/40) proposes to restructure; the restore path is written so that refactor only changes one tag.

## What exists already

- `DocumentAgent` (`agents/document.ts`) owns the Y.Doc and persists it to SQLite on a 1s quiet edge (`schedulePersist` / `flushDocState`). Every update passes through `this.doc.on("update", (update, origin) => …)`.
- `yDocToMarkdown(doc)` (`app/shared/rich-markdown.ts`) serializes the whole document, CriticMarkup delimiters included; `buildMarkdownBlocks`, `deleteBlocks`, `insertBlockNodes` are the primitives the agent `replace` mutation already uses to swap block ranges in one transaction.
- Human clients publish `user` (name, color, id, avatar, animal) into Yjs awareness from `useLocalDoc`. Awareness is keyed by the client's `doc.clientID`, which is the same id stamped on every struct in that client's updates.
- Agent RPCs carry a verified `AgentIdentity` (name, label such as "Ada Lovelace's Agent", color).
- `onMessage` has a reserved branch for JSON string control messages ("reserved for future use").
- `onRequest` already serves DO-level HTTP (`POST` create, `GET` exists) via `routeAgentRequest`. The `alarm` wipes every table at expiry.
- UI kit: `app/components/ui/menu.tsx` over Base UI; `HeaderMenu` is a Base UI popover; `Avatar`, `time-ago.ts`, and `format-remaining.ts` exist. There is no dialog primitive yet.

## Design

### Storage

A `versions` table in the document's own DO, created in `ensureInitialised`, dropped in `alarm`:

```
id INTEGER PRIMARY KEY AUTOINCREMENT
created_at INTEGER
reason TEXT        -- 'idle' | 'delta' | 'pre_replace' | 'pre_accept_all' | 'pre_restore' | 'restore'
author_kind TEXT   -- 'human' | 'agent' | 'unknown'
author_id TEXT     -- UserInfo.id or AgentIdentity.id
author_name TEXT   -- display: "Ada", "Quiet Otter", "Ada's Agent"
author_color TEXT
contributors TEXT  -- JSON [{kind,id,name,color}] everyone who edited since the previous version
markdown TEXT
bytes INTEGER
restored_from INTEGER  -- version id, for reason='restore'
```

Snapshots are full markdown, not Yjs state. Markdown is the product's canonical format, it is what the dialog shows, and it is what restore feeds back through the existing block builders. A restored version therefore round-trips exactly like an upload.

Limits: skip the snapshot (and log) when the markdown exceeds 1 MB, comfortably under the 2 MB SQLite value cap. Keep at most 200 versions per document, pruning the oldest `idle`/`delta` rows first so the deliberate `pre_*` checkpoints survive longest. At 99 hours and typical document sizes this is a few megabytes at worst.

### When a snapshot is taken

One entry point, `maybeSnapshot(reason, author)`, which is a no-op when the markdown equals the latest version's markdown.

1. **Idle edge (`idle`).** A 60s timer reset on every content update. Fires once typing stops. Separate from the 1s persist timer so persistence stays cheap.
2. **Large delta (`delta`).** Checked inside `flushDocState` (already at most once per second): if the markdown length differs from the latest version's by more than 20%, snapshot now rather than waiting for idle. Also a 10-minute ceiling: continuous editing never goes longer than that without a version.
3. **Before an agent replace (`pre_replace`).** In `applyMutation`'s `replace` case and in the typed-performance path for `replace` (the `item.mutation.kind === "replace"` branch), before the transaction opens. Author is the agent.
4. **Before Accept all (`pre_accept_all`).** `processAllRanges` in `app/lib/suggestion-actions.ts` is a plain client-side transaction the server cannot distinguish from typing. The client sends a JSON control message on the existing WebSocket first, `{"type":"snapshot","reason":"pre_accept_all"}`, and the server snapshots on receipt. WebSocket ordering per connection guarantees the snapshot lands before the accept-all sync update. Author is the sending connection's awareness user. Reject all uses the same hook with the same reason label.
5. **Before and after restore (`pre_restore`, `restore`).** Restore is undoable by restoring the `pre_restore` row.

### Attribution

- **Agents:** the `AgentIdentity` on the RPC. Name shown is `label ?? name`, so signed-in counterparts read "Ada's Agent" and anonymous ones read their slug.
- **Humans:** in the `update` handler, when `origin !== "agent"`, decode the update (`Y.decodeUpdate(update).structs`) and collect the distinct `id.client` values. Look each up in `awareness.getStates()` and take its `user` field. Record them in an in-memory `contributorsSinceSnapshot` map that `maybeSnapshot` drains into `contributors`. The primary `author_*` is the most recent contributor. A client id with no awareness state yet (reconnect race) is recorded as `unknown` / "Someone".
- Decoding every update is cheap relative to the serialization already done in `flushDocState`, and it only touches struct headers.

### Restore

Server-side RPC on `DocumentAgent`, `restoreVersion(versionId, actor)`:

1. `maybeSnapshot("pre_restore", actor)`.
2. `buildMarkdownBlocks(version.markdown)`; on failure return `unsupported_markup` and change nothing (parse before the transaction, as `replace` does).
3. `doc.transact(() => { deleteBlocks(doc, 0, frag.length - 1); insertBlockNodes(doc, 0, nodes); }, "agent")`. The `"agent"` origin is what makes the existing `update` handler broadcast a DO-originated change to connected browsers, and what keeps the mention/digest observers quiet. When #40 lands, this becomes `{kind: "system", actor}`.
4. Record a `restore` row pointing at `restored_from`.
5. Threads: the `threads` Y.Map is left untouched. Comment and highlight marks inside the restored markdown come back through CriticMarkup parsing, so anchors that existed at snapshot time reappear; threads created after the snapshot keep their metadata but lose their anchors, exactly as they would if the text were deleted by hand. This is an explicit regression surface for testing, not something to engineer around in v1.

Restore is a write like any other human edit. Anonymous users can already edit any document, so restore needs no sign-in, only a light per-connection rate limit (one restore per 5 seconds).

### Transport for the browser

Add path routing to `onRequest`, which today ignores the pathname:

| Method and path (under `/agents/document-agent/:id`) | Purpose |
|---|---|
| `GET /versions` | JSON list: id, created_at, reason, author, contributors, bytes. No markdown. |
| `GET /versions/:vid` | `text/markdown` of one version, `nosniff`. Public by URL like `/:id.md`. |
| `POST /versions/:vid/restore` | Body carries the requesting `user` (same shape as awareness). Same-origin only. |
| `POST /versions` with `{reason}` | Manual "Save version" (reason `manual`) for the menu; small, worth having. |

The existing bare `POST` (create) and `GET` (exists) keep their behaviour at the root path.

### UI

- **Dialog primitive:** add `app/components/ui/dialog.tsx` over `@base-ui/react/dialog`, styled like `MenuContent` (border, `bg-paper`, shadow). Full-height sheet on small screens, centered panel above `sm`.
- **Entry point:** a "History" item in `HeaderMenu`, plus "Save version" beneath it.
- **History dialog:** two panes. Left, the version list grouped by day, each row showing `Avatar` (animal glyph or Google avatar), author name, relative time via `time-ago`, a reason chip ("Before Claude replaced blocks", "Before Accept all", "Restored"), and the size delta versus the previous row. Right, a read-only render of the selected version's markdown (reuse the existing preview rendering path if it accepts a markdown string; otherwise a minimal `markdownParser` to static HTML). A **Restore** button with an inline confirm ("Restore this version? The current text is saved first.").
- Current state is the implicit top row ("Now"), not a stored version.
- Versions list refreshes on open and after restore; no live subscription.

### Agents

Out of scope for v1, but the shape is ready: `versions_list` and `version_read` tools would forward to the same RPCs. Left out to keep this plan to one surface.

## Tasks

1. **Policy module** (`app/shared/version-policy.ts`, pure): `shouldSnapshotOnDelta(prevBytes, nextBytes)`, `pruneOrder(rows)`, `primaryAuthor(contributors)`, reason labels. Unit tests in `tests/unit/shared/`.
2. **DocumentAgent storage and triggers:** `versions` table, `maybeSnapshot`, idle timer, delta check in `flushDocState`, `pre_replace` hooks in both replace paths, contributor tracking in the `update` handler, wipe in `alarm`. Ensure the idle timer is cleared when the last connection closes (same block that clears `agentIdleTimers`) so nothing pins the DO.
3. **Control message:** handle `{"type":"snapshot"}` in `onMessage`'s string branch. Client side, `processAllRanges` callers send it first (thread through `DocumentContext` so the action has the socket).
4. **Restore RPC and HTTP routing** in `onRequest`, with same-origin check and rate limit. Handlers written as pure functions taking a stub, in the `workers/routes.ts` style, so they are unit-testable without `cloudflare:` imports.
5. **Dialog primitive, History dialog, HeaderMenu items.** Component tests alongside `header-menu.test.tsx`.
6. **Regression checks:** suggest-mode document with open threads, snapshot, edit, restore; agent `replace` produces a `pre_replace` row attributed to the agent's label; two humans editing yields both in `contributors`; a document with no edits after creation has zero versions; expiry drops the table.
7. **Docs:** a short "Version history" section in `docs/markdown-and-criticmarkup.md` (versions are markdown, same round-trip guarantee) and a line in `CLAUDE.md`'s architecture notes.

## Out of scope

Diff view between versions; per-block history; agent-facing version tools; restoring threads; version retention beyond the document's 99 hours; export of the history as a bundle.
