# Agents are hexagons, people are circles, and nobody has a handle

**Thesis:** a signed-in person's agent should be addressed, named, and drawn as a derivative of the person, without exposing the person's email and without inventing a global handle system. Identity keys stay private and stable (Google's account id). A mention shows a name and carries a short id the editor hides, so what people read is a name and what the system matches is exact. The visual tie is shape, colour, and name: people are circles, agents are hexagons carrying their client's mark, both in the owner's colour.

Status: implemented 2026-09-06 (this document is the archived design; the vapor draft was revised in place through four versions: v1 put the owner's email in the agent id, v2 introduced global handles, v3 matched mentions by name alone, v4 added the hidden id). Implementation notes at the end record where the code differs from the design.

## The key is Google's account id, and it never leaves the server

Google's ID token carries `sub`: an opaque numeric string, unique per Google account, unchanged if the person renames their address. Sign-in used to discard it and key everything on `email:<addr>`. Two changes:

- **Principal becomes `google:<sub>`.** The email moves onto the profile as private contact data. Identity shipped a week before this plan, so the migration is a re-key of a handful of profiles, grants, and wake targets; it only gets more expensive.
- **The Registry's `uid` becomes the public id, and gets short.** It was a UUID minted per profile with a `u:<uid>` reverse index. Nothing depends on its shape, so it becomes eight lowercase alphanumerics (`[a-z0-9]{8}`, the same alphabet and length as a document id), minted by the Registry and checked against `u:` before it is accepted, so uniqueness is enforced at creation rather than assumed from length. Every client-visible place that carried the principal switches to it: awareness `user.id` (previously the raw principal, broadcast to every collaborator), thread author ids, version authors, `/auth/me`. Anonymous ids take the same shape at generation.

Neither `sub` nor the email is ever sent to another collaborator or returned by an MCP tool. `sub` is not secret, but it is a cross-site correlator, so it stays server-side alongside the email.

## Mentions show a name and carry a hidden id

There is no handle table. A mention token is `@` + a slug of the display name + `~` + the person's **`uid`**: `@nicholas-jitkoff~k3f0a9x2`. The uid is the Registry's eight-character public id, so the token is unambiguous without being an address, and there is one identifier doing one job: the same value is the storage key, the public id, and the mention id. The name part is for reading; the uid is for matching. Anonymous people get the same shape from their localStorage id (`@quiet-otter~3b9e02d7`), so two Quiet Otters in one doc are distinct too.

An agent's token is its owner's name slug, a **`+agent` tag**, and the owner's uid: `@nicholas-jitkoff+agent~k3f0a9x2`. Same uid as the person, so the pair is legible in raw markdown; the tag says which of the two. Anonymous agents carry their client slug and a session id (`@claude-code~c41d7e90`).

**The editor hides the id.** Mentions are an inline atom node rather than a decoration over plain text: the node holds `{ slug, tag, sid }`, renders as `@Nicholas Jitkoff` in the owner's colour, deletes as one unit, and serialises back to the token. The markdown on disk and over MCP is still plain text — `read_document` and `/:id.md` return the full token — only the editor's view of it changes. When the mentioned person or agent is present, the chip shows their *current* name from awareness or the roster; the name in the token is a fallback, so a rename never breaks a mention.

What this buys over matching by name:

- **Exact resolution.** Two Nicholas Jitkoffs are `~k3f0a9x2` and `~d02e77b4`. The popup shows avatars to choose between them; the document remembers the choice.
- **Mentioning the absent.** A uid resolves through the Registry, so a person who has never opened this document can be mentioned, and their agent's wake target can fire on it. Nothing in the doc reveals who they are beyond their display name.
- **Renames are free.** The uid is the identity; the name part is a hint.

**Typing an email still works, but never lands in the document.** When the `@` query is shaped like an address, the popup keeps its final row, but choosing it calls `GET /auth/resolve?email=…` (signed-in callers only, rate-limited). Found: the person's name and public id come back and the token is inserted. Not found: nothing is inserted. The address is a lookup key on the way in and is never written.

*Mechanics:* `MENTION_RE` recognises `@([a-z0-9-]+)(\+[a-z0-9-]+)?~([a-z0-9]{8})`; `SLUG_MENTION_RE` stays for bare `@slug` mentions written before tokens. `findMentions` matches tokens on `sid` and `tag` against the roster (rows gain `mention`, `owner_uid`, `client`) and ignores the name part; a bare slug still matches an agent's internal name. A `mention` node in `richSchema` with a markdown-it inline rule and a serialiser, and the TipTap `Mention` node with a node view that paints the current name. `rankMentionItems` emits tokens and never an address. The Registry gains an `e:<email>` index for the resolve endpoint and loses `ensureAgentSlug` and `a:<slug>`.

## The name is the owner's first name plus the client

Display name: **"Nicholas's Claude"**, falling back to **"Nicholas's Agent"** when the client didn't identify itself. The client is already resolved (`clientDisplayName`), and folding it into the name makes attribution read as a sentence: *Nicholas's Claude suggested…*. The same counterpart connecting from Codex tomorrow is labelled "Nicholas's ChatGPT"; the roster entry doesn't change, only the label. A user-chosen name is a settings feature and out of scope.

## People are circles, agents are hexagons

Two shapes carry the human/agent distinction everywhere an avatar appears: face pile, comments, popup, version history, cursor labels.

- **People are circles**, as before: photo for the signed-in, animal glyph for the anonymous.
- **Agents are hexagons** filled with the owner's colour, carrying the **client's mark** from `app/assets/agents` (Claude, ChatGPT, Gemini, Cursor, VSC, other) in white. The six marks already existed as 24×24 `currentColor` SVGs behind `AgentClientIcon`, so the hexagon is a clip-path around a component we had.

An anonymous agent is the same hexagon in its own rotating colour. Hexagon means agent, full stop; the mark says which kind; the colour says whose.

The tie to the person is therefore **colour plus name**, not a shared photo. That is a weaker visual link than reusing the face, and a cleaner one: the agent reads as a tool of a known type rather than as a second copy of the person, and it works identically for owners without a photo. Colour has to be reliable for this to hold, so it derives from identity, not from the browser: `hash(uid) → USER_COLOURS index` for a signed-in person and for every agent they own; anonymous people keep the localStorage colour, anonymous agents the roster rotation.

The collaboration caret keeps the owner's colour and gains a hexagonal flag for agents, with the client's mark where the "AI" badge was.

## What changed, by layer

| Layer | Before | After |
|---|---|---|
| Sign-in | kept `email`, `name`, `picture` | also keeps `sub`; principal = `google:<sub>`, email on the profile |
| `Registry` | profiles keyed `p:email:…`, UUID `uid`, `agentSlug`, `a:` index | profiles keyed `p:google:…`; `uid` minted as `[a-z0-9]{8}` with a uniqueness check; `agentSlug` and `a:` removed; `e:<email>` index and `alias:<legacy>` added |
| Awareness / thread / version ids | principal | `uid` |
| `AgentIdentity` | `name` = Registry slug, `label` = "Ada's Agent" | `name` = owner's name slug (de-duped per doc), `label` = "Ada's Claude", plus `ownerUid`, `ownerName`, `client` |
| Roster row | `name`, `label`, `color`, `owner` | adds `mention`, `owner_uid`, `client`; `color` = `hash(owner_uid)` when owned; the public entry exposes `ownerUid`, never `owner` |
| Mention grammar | slug, or email | token `@slug(+tag)?~sid`; bare slug kept for legacy; email form removed |
| Mention rendering | inline decoration over text | `mention` node showing the name, hiding the id; decoration kept for legacy slugs |
| `@` popup | signed-in people → email | everyone → token; an email query resolves via `/auth/resolve` before insert |
| `/auth/resolve` | — | signed-in, rate-limited email → `{ uid, displayName, avatar }` or `null` |
| Anonymous id | UUID in localStorage | `[a-z0-9]{8}` at generation; existing UUIDs reduced by `shortIdOf` on use |
| `Avatar` | circle: photo, animal, or initials | `shape` prop, circle or hexagon; the hexagon takes `client` and renders the mark |
| Caret label | rounded flag, "AI" badge | hexagonal flag for agents with the client's mark |
| `/auth/me` | `principal`, `email`, `agentSlug` | `uid`, `email` (owner only), no slug |

Invariants preserved: mentions are plain text in markdown (the token, readable and greppable); capabilities come from the OAuth grant, so the no-escalation argument is untouched; anonymous everything is unchanged except the agent hexagon and the short id on new anonymous identities.

## Migration

Registry re-key: on sign-in, a profile found under `p:email:…` is copied to `p:google:<sub>` with a fresh short uid, its wake target moves with it, and `alias:email:…` points at the new principal so sessions, refresh grants, and roster rows minted under the old principal keep resolving until they expire. Documents need nothing: roster rows live 99 hours and gain their new columns on first touch, `findMentions` accepts old slug names and new tokens alike, and thread or version records carrying an `email:` id age out with their documents.

## Implementation notes

Where the code differs from the draft:

- The resolve endpoint is `GET /auth/resolve`, alongside the other session routes, rather than `/me/resolve`.
- Event payloads (`mention.agent`, `thread_reply.agent`) still carry the agent's internal roster name, which is what `events_poll` filters on; the token is in the roster entry's `mention` and in `read_document.presence`.
- `MentionHighlight` was kept, reduced to bare legacy slugs, so mentions written before tokens keep their colour for the 99 hours those documents live.
- Comment text is plain text, so `ThreadPanel` strips ids for display with `stripMentionIds`; the stored text keeps the token.
- Existing anonymous UUID ids are not rewritten; `shortIdOf` reduces them to eight hex characters wherever a short id is needed, so no localStorage migration runs.
- The email row in the popup stays visible as "Mention ada@example.com" until it is chosen; choosing it is what resolves.

## Open questions

- **Separator.** `~` reads as "about this person" and is rare in prose; `#` collides with headings at line start, `:` with times and URLs, `.` with domains. Chosen: `~`.
- **Anonymous collisions.** Anonymous uids are minted client-side with no registry, so uniqueness is probabilistic: 2.8 trillion values, and a collision only matters between two anonymous people in the same document. Accepted.
- **Resolve reveals account existence.** Any signed-in user can learn that an address has a vapor account, plus its display name. Google Docs sharing makes the same trade. Rate limited (30 a minute) and sign-in only; revisit if abused.
- **Tag word.** `+agent` is generic; `+claude` would let the mention say the client, but it changes when the client does. Chosen: `+agent`.
- **Hexagon at 16px.** The client marks are drawn for 24px. Check Cursor and VSC in a 16px hexagon; the fallback is the colour alone with the mark only at 20px and up.
- **Owner without a photo.** Their circle shows initials, their agent's hexagon shows the mark; colour is the only tie.
