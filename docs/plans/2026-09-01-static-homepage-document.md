# Homepage as a static document

Today "New document" mints a Durable Object, seeds it with the demo doc plus a set of synthetic comments, and then asks you to press *Start editing* to throw all of that away. The tour and the blank page fight over the same document. This plan makes the homepage *be* the tour: a real vapor editor, fully interactive, backed by nothing but a local Yjs doc — no Durable Object, no websocket, nothing persisted. "New document" then becomes what it says, and can carry your sandbox edits with it.

## Why it's cheap

The editor stack already runs on a local `Y.Doc`. TipTap's Collaboration extension owns history against the doc; comments live in the doc's `threads` Y.Map; mode and flags live in `docState`. The websocket is a bolt-on: `useYjsEditor` creates the doc *and* wires `useAgent` + `YjsProvider` to it in the same hook. Everything downstream (`DocumentProvider`, `Editor`, `ThreadList`, `MobilePanel`, the bubble menu) only sees the doc. So the work is a hook split plus seeding, not a second editor.

## Plan

1. **Split the hook.** Extract `useLocalDoc()` — Y.Doc, awareness, user identity, `docState`, mode — from `useYjsEditor`, which keeps only the remote part (`useAgent`, provider, idle sleep, `synced`). `useYjsEditor` becomes `useLocalDoc` + `useRemoteSync`. Mechanical; no behaviour change for `/:id`.
2. **Seed a local doc from markdown, client-side.** `DocumentAgent` already turns POSTed markdown into blocks (`buildMarkdownBlocks` in `app/shared/rich-markdown.ts`) and threads (`deserializeThreads`); both are shared code with no `cloudflare:` imports, so the homepage can run the same seeding in the browser into its local doc. Presence is just the local user; `synced` is trivially true.
3. **A `home.md` that merges the two pages.** One document, tour first then the current homepage sections (*Create a document*, *From your terminal*, *From your agent*, *As a habit*, and the 99-hour line). Synthetic threads in the `vapor:` frontmatter as today, refreshed: at least one authored by an agent with `agentClient: "Claude"` so the "Claude • 2h ago" attribution is on display, and one live suggestion (`{++ ++}`) to show track changes. Retire `demo.md`.
4. **A homepage variant of `DocumentLayout`.** Same header and rail, minus what has no meaning without a DO: the id/expiry text, connection status, *Invite an agent*. *Share* keeps *Download* (exporting the sandbox is useful) and drops *Copy link*. *Edit / Suggest / Markdown* stay — they're the tour. The comments toggle stays.
5. **"New document" promotes the sandbox.** The button POSTs the homepage doc's *current* markdown and threads to a fresh `DocumentAgent` — the existing `handleUpload` path — and navigates there. Playing in the sandbox and then keeping it is one click; wanting a blank page is *Cmd-A, delete, New document*, or a second *Blank document* link. *Drop an .md file* is unchanged.
6. **Delete onboarding.** `isOnboarding`, `clearDocument`, `OnboardingBanner`, the `onboarding` flag in `docState` and in `DocumentAgent`'s POST body, and their tests. Nothing else reads them.
7. **Code blocks with a copy button.** The homepage's install commands are code blocks now; the editor renders those but has no copy affordance. Add a hover copy button to the editor's code-block node view. General feature, small, and it keeps the homepage's one interactive nicety.

## Consequences worth naming

- **Zero DO touches on the homepage.** Today every homepage visit is static, but every "New document" click spins up a DO that's usually abandoned seconds later. After this, a DO exists only when someone decides to keep a document.
- **Edits are ephemeral by design.** Reload and the tour resets. That's the right default for a demo; a `localStorage` draft is a possible follow-up, not part of this.
- **SEO/no-JS.** The current homepage is fully server-rendered text. TipTap renders client-side, so SSR the seeded markdown through the existing `Preview` renderer as the pre-hydration/no-JS body. Cheap, and it keeps the copy indexable.
- **The header gets a second shape.** Worth resisting a prop explosion on `DocumentLayout`: pass a small `surface: "home" | "doc"` and branch on it in one place.

## Sizing

Steps 1–2 are half a day and de-risk everything; 3–6 are another day; 7 is an hour. Ship 1–6 together (the homepage flips in one PR); 7 can trail.

## Out of scope

- Persisting homepage edits.
- Multi-user presence on the homepage (there is no one else there).
- Changing the `/:id` document experience.
