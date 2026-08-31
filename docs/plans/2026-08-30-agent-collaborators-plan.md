# Agent Collaborators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI agents join vapor documents as human-like collaborators — presence, paced typing, suggestions, comments — driven by external MCP clients through a `/mcp` endpoint.

**Architecture:** A `VaporMcp` (`McpAgent`) Durable Object serves MCP at `/mcp` and calls the existing `DocumentAgent` DO over RPC. `DocumentAgent` gains three SQLite tables (`agent_tokens`, `performances`, `events`), a performance engine that replays edits at typing speed, and synthesized awareness states so agents appear in the presence stack. Documents move to root-path URLs. Spec: `docs/plans/2026-08-30-agent-collaborators-design.md`.

**Tech Stack:** Cloudflare Workers + Durable Objects, Agents SDK (`agents`, `agents/mcp`), `@modelcontextprotocol/sdk`, Yjs, y-protocols, React Router 7, TipTap 3, Vitest.

## Global Constraints

- Nothing under `app/` may import from `agents/` — shared code goes in `app/shared/` (types/constants) or `app/lib/` (logic). `agents/` MAY import from `app/lib/` and `app/shared/` (see `agents/document.ts`).
- The `agents` npm package uses `cloudflare:` imports and cannot load in plain Vitest — DO tests mock the `Agent` base class (pattern in `tests/integration/agents/document-agent.test.ts`).
- ESLint: unused variables prefixed `_`. Existing ESLint config stays — no Biome (fork rule).
- Node 22+. Tests mirror source structure under `tests/unit/` and `tests/integration/`.
- Commit subjects imperative, with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Doc ids are 8 chars `[a-z0-9]` (`isValidDocumentId` in `app/shared/constants.ts`).
- Every RPC-facing error is a **return value** `{ error: { code, message, snippet? } }`, never a thrown exception (DO RPC serialization).
- Capability rules: `read` implied by any valid token; `suggest`, `comment`, `write` explicit. Default grant on mint: `["suggest", "comment"]`.
- Run `npm run typecheck && npm run lint && npm run test` before every commit.

---

## Phase 1 — foundations (pure logic, no DO changes)

### Task 1: Shared agent protocol module

**Files:**
- Create: `app/shared/agent-protocol.ts`
- Test: `tests/unit/shared/agent-protocol.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later task):

```ts
export type AgentCapability = "comment" | "suggest" | "write";
export type Pace = "natural" | "fast" | "instant";

export interface AgentRosterEntry {
  name: string;            // slug, unique per doc
  color: string;           // one of USER_COLOURS .color values
  owner: string | null;    // free text this phase
  capabilities: AgentCapability[];
  createdAt: number;
  lastSeenAt: number | null;
}

export interface BlockAnchor { index: number; hash: string; }   // hash: 8 hex chars
export interface DocBlock extends BlockAnchor { text: string; } // text: markdown w/ critic delimiters

export interface AgentError { code: AgentErrorCode; message: string; snippet?: string; }
export type AgentErrorCode =
  | "stale_anchor" | "capability_denied" | "invalid_token" | "doc_not_found"
  | "doc_expired" | "find_not_matched" | "rate_limited" | "invalid_name";

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
export const RESERVED_SLUGS = ["new", "mcp", "agents", "api", "assets", "demo", "favicon.ico", "robots.txt"];
export const DEFAULT_CAPABILITIES: AgentCapability[] = ["suggest", "comment"];
export const RATE_LIMIT_MUTATIONS_PER_MIN = 10;
export const RATE_LIMIT_CHARS_PER_HOUR = 20_000;

export function blockHash(text: string): string;        // FNV-1a 32-bit, 8 hex chars
export function formatAnchor(a: BlockAnchor): string;    // "b3-1a2b3c4d"
export function parseAnchor(s: string): BlockAnchor | null;
export function findMentions(text: string, rosterNames: string[]): string[];
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/shared/agent-protocol.test.ts
import { describe, it, expect } from "vitest";
import {
  blockHash, formatAnchor, parseAnchor, findMentions, AGENT_NAME_RE,
} from "~/shared/agent-protocol";

describe("blockHash", () => {
  it("is deterministic and 8 hex chars", () => {
    expect(blockHash("## Heading")).toBe(blockHash("## Heading"));
    expect(blockHash("## Heading")).toMatch(/^[0-9a-f]{8}$/);
    expect(blockHash("a")).not.toBe(blockHash("b"));
  });
});

describe("anchor round-trip", () => {
  it("formats and parses", () => {
    const a = { index: 3, hash: "1a2b3c4d" };
    expect(formatAnchor(a)).toBe("b3-1a2b3c4d");
    expect(parseAnchor("b3-1a2b3c4d")).toEqual(a);
    expect(parseAnchor("nonsense")).toBeNull();
  });
});

describe("findMentions", () => {
  it("matches roster names only, once each", () => {
    expect(findMentions("hey @scribe and @scribe, not @ghost", ["scribe", "muse"]))
      .toEqual(["scribe"]);
  });
  it("requires word boundary", () => {
    expect(findMentions("email me@scribe.com", ["scribe"])).toEqual([]);
  });
});

describe("AGENT_NAME_RE", () => {
  it("accepts slugs, rejects others", () => {
    expect(AGENT_NAME_RE.test("nicks-agent")).toBe(true);
    expect(AGENT_NAME_RE.test("ab")).toBe(true);
    expect(AGENT_NAME_RE.test("-bad")).toBe(false);
    expect(AGENT_NAME_RE.test("Bad")).toBe(false);
    expect(AGENT_NAME_RE.test("a".repeat(33))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/shared/agent-protocol.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// app/shared/agent-protocol.ts  (types as in Interfaces block, plus:)
export function blockHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function formatAnchor(a: BlockAnchor): string {
  return `b${a.index}-${a.hash}`;
}

export function parseAnchor(s: string): BlockAnchor | null {
  const m = /^b(\d+)-([0-9a-f]{8})$/.exec(s);
  return m ? { index: Number(m[1]), hash: m[2] } : null;
}

export function findMentions(text: string, rosterNames: string[]): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^a-z0-9@.])@([a-z0-9][a-z0-9-]{0,30}[a-z0-9])/g)) {
    if (rosterNames.includes(m[1])) found.add(m[1]);
  }
  return [...found];
}
```

- [ ] **Step 4: Run test to verify it passes** — same command, expected PASS.
- [ ] **Step 5: Commit** — `git add app/shared/agent-protocol.ts tests/unit/shared/agent-protocol.test.ts && git commit -m "Add shared agent protocol module"` (with the Co-Authored-By trailer; all later commits too).

### Task 2: Yjs ↔ markdown block layer

**Files:**
- Create: `app/lib/y-markdown.ts`
- Test: `tests/unit/lib/y-markdown.test.ts`

**Interfaces:**
- Consumes: `blockHash`, `DocBlock` from Task 1; `parseCriticMarkupToContent` from `app/lib/critic-parser.ts` (existing — read it first; it returns `{ cleanText, marks: { type, from, to, attrs? }[] }`).
- Produces:

```ts
export function getBlocks(doc: Y.Doc): DocBlock[];                 // one per paragraph element
export function yDocToMarkdown(doc: Y.Doc): string;                // blocks joined with "\n"
export function resolveAnchor(doc: Y.Doc, anchor: string):
  { index: number } | { error: "stale_anchor"; snippet: string };  // hash-first, index tiebreak
export function insertMarkdownBlocks(doc: Y.Doc, index: number, markdown: string): void;
export function deleteBlocks(doc: Y.Doc, from: number, to: number): void;
```

Document structure (see `agents/document.ts` `onRequest` POST): the fragment `doc.getXmlFragment("default")` is a flat list of `Y.XmlElement("paragraph")`, each containing one `Y.XmlText` whose string is a markdown source line, with critic marks as Yjs formatting attributes. Block text serialization re-inserts CriticMarkup delimiters around formatted runs — delimiters per mark type: `criticAddition` `{++ ++}`, `criticDeletion` `{-- --}`, `criticComment` `{>> <<}`, `criticHighlight` `{== ==}` (verify against `CRITIC_DELIMITERS` in `app/lib/critic-marks.ts:71` and reuse that export if it imports cleanly outside TipTap; otherwise define the map locally with a comment pointing there).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/y-markdown.test.ts
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { getBlocks, yDocToMarkdown, resolveAnchor, insertMarkdownBlocks, deleteBlocks } from "~/lib/y-markdown";
import { formatAnchor, blockHash } from "~/shared/agent-protocol";

function docFrom(lines: string[]): Y.Doc {
  const doc = new Y.Doc();
  insertMarkdownBlocks(doc, 0, lines.join("\n"));
  return doc;
}

describe("y-markdown", () => {
  it("round-trips plain markdown", () => {
    const doc = docFrom(["# Title", "", "Body text."]);
    expect(yDocToMarkdown(doc)).toBe("# Title\n\nBody text.");
    expect(getBlocks(doc)).toHaveLength(3);
    expect(getBlocks(doc)[0].hash).toBe(blockHash("# Title"));
  });

  it("round-trips CriticMarkup marks as delimiters", () => {
    const doc = docFrom(["keep {--cut this--} and {++add this++} end"]);
    expect(yDocToMarkdown(doc)).toBe("keep {--cut this--} and {++add this++} end");
  });

  it("resolveAnchor finds by hash after blocks shift", () => {
    const doc = docFrom(["alpha", "beta", "gamma"]);
    const anchor = formatAnchor(getBlocks(doc)[2]);       // gamma at index 2
    insertMarkdownBlocks(doc, 0, "zero");                 // shifts everything down
    const r = resolveAnchor(doc, anchor);
    expect(r).toEqual({ index: 3 });
  });

  it("resolveAnchor reports stale_anchor with a snippet", () => {
    const doc = docFrom(["alpha", "beta"]);
    const anchor = formatAnchor(getBlocks(doc)[1]);
    deleteBlocks(doc, 1, 1);
    const r = resolveAnchor(doc, anchor);
    expect(r).toMatchObject({ error: "stale_anchor" });
    expect((r as { snippet: string }).snippet).toContain("alpha");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/unit/lib/y-markdown.test.ts`, FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// app/lib/y-markdown.ts
import * as Y from "yjs";
import { blockHash, parseAnchor } from "~/shared/agent-protocol";
import type { DocBlock } from "~/shared/agent-protocol";
import { parseCriticMarkupToContent } from "~/lib/critic-parser";

const DELIMS: Record<string, [string, string]> = {
  criticAddition: ["{++", "++}"],
  criticDeletion: ["{--", "--}"],
  criticComment: ["{>>", "<<}"],
  criticHighlight: ["{==", "==}"],
};

function blockText(el: Y.XmlElement): string {
  let out = "";
  for (const child of el.toArray()) {
    if (!(child instanceof Y.XmlText)) continue;
    for (const op of child.toDelta() as { insert: string; attributes?: Record<string, unknown> }[]) {
      const markType = op.attributes && Object.keys(op.attributes).find((k) => DELIMS[k]);
      out += markType ? DELIMS[markType][0] + op.insert + DELIMS[markType][1] : op.insert;
    }
  }
  return out;
}

export function getBlocks(doc: Y.Doc): DocBlock[] {
  const frag = doc.getXmlFragment("default");
  return frag.toArray().map((el, index) => {
    const text = el instanceof Y.XmlElement ? blockText(el) : "";
    return { index, hash: blockHash(text), text };
  });
}

export function yDocToMarkdown(doc: Y.Doc): string {
  return getBlocks(doc).map((b) => b.text).join("\n");
}

export function resolveAnchor(doc: Y.Doc, anchor: string) {
  const parsed = parseAnchor(anchor);
  const blocks = getBlocks(doc);
  const snippet = () =>
    blocks.slice(0, 6).map((b) => `[b${b.index} ${b.hash}] ${b.text.slice(0, 60)}`).join("\n");
  if (!parsed) return { error: "stale_anchor" as const, snippet: snippet() };
  const matches = blocks.filter((b) => b.hash === parsed.hash);
  if (matches.length === 0) return { error: "stale_anchor" as const, snippet: snippet() };
  const best = matches.reduce((a, b) =>
    Math.abs(a.index - parsed.index) <= Math.abs(b.index - parsed.index) ? a : b);
  return { index: best.index };
}

function makeParagraph(line: string): Y.XmlElement {
  const { cleanText, marks } = parseCriticMarkupToContent(line);
  const para = new Y.XmlElement("paragraph");
  const ytext = new Y.XmlText(cleanText);
  for (const mark of marks) {
    ytext.format(mark.from, mark.to - mark.from, { [mark.type]: mark.attrs ?? {} });
  }
  para.insert(0, [ytext]);
  return para;
}

export function insertMarkdownBlocks(doc: Y.Doc, index: number, markdown: string): void {
  const frag = doc.getXmlFragment("default");
  doc.transact(() => {
    frag.insert(index, markdown.split("\n").map(makeParagraph));
  });
}

export function deleteBlocks(doc: Y.Doc, from: number, to: number): void {
  const frag = doc.getXmlFragment("default");
  doc.transact(() => frag.delete(from, to - from + 1));
}
```

- [ ] **Step 4: Run test to verify it passes.** Also run the full unit suite (`npx vitest run tests/unit`) to catch regressions.
- [ ] **Step 5: Commit** — `Add Yjs markdown block layer with content-hash anchors`.

### Task 3: Documents render at the root path

**Files:**
- Modify: `app/routes.ts`, `app/routes/home.tsx:43,59`, `app/routes/new.ts` (the `/docs/${id}` URL near the end)
- Rename: `app/routes/docs.$id.tsx` → `app/routes/doc.$id.tsx` (route id clarity; content unchanged except its own `Route` types import path)
- Test: `tests/unit/routes/root-path.test.ts` (plus update any existing tests referencing `/docs/`: `grep -rn "docs/" tests/`)

**Interfaces:**
- Consumes: `isValidDocumentId` from `app/shared/constants.ts` (already 404-guards ids in the doc route loader — verify while editing).
- Produces: documents at `/:id`; `new.ts` returns `${origin}/${id}`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/routes/root-path.test.ts
import { describe, it, expect } from "vitest";
import routes from "~/routes";

describe("route table", () => {
  it("serves documents at /:id, not /docs/:id", () => {
    const flat = JSON.stringify(routes);
    expect(flat).toContain('":id"');
    expect(flat).not.toContain("docs/:id");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/routes/root-path.test.ts`.
- [ ] **Step 3: Implement** — in `app/routes.ts`: `route(":id", "routes/doc.$id.tsx")` (static routes `/new` rank higher than the dynamic segment in React Router; keep index route first). Update the two `navigate(\`/docs/${id}\`)` calls in `home.tsx` to `navigate(\`/${id}\`)`; update `new.ts` response to `` `${url.origin}/${id}\n` ``. Rename the route file with `git mv`.
- [ ] **Step 4: Verify** — unit tests pass, then `npm run dev` and manually create a doc; the URL bar shows `/<8 chars>`.
- [ ] **Step 5: Commit** — `Serve documents at the root path`.

---

## Phase 2 — DocumentAgent extensions

All DO work is tested through the mock-Agent pattern in `tests/integration/agents/document-agent.test.ts`. **First step of Task 4 extends that mock's `sql` fake** with a generic in-memory table store for `agent_tokens`, `performances`, and `events` (match on table name in the query; support INSERT/SELECT/UPDATE/DELETE with the exact queries the implementation uses — keep the fake dumb and query-shaped, as the existing `doc_state` fake is).

### Task 4: Token roster (mint, verify, revoke, list)

**Files:**
- Create: `app/lib/agent-tokens.ts`
- Modify: `agents/document.ts` (add table + 4 RPC methods)
- Test: `tests/unit/lib/agent-tokens.test.ts`, extend `tests/integration/agents/document-agent.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `USER_COLOURS` from `app/shared/constants.ts`.
- Produces:

```ts
// app/lib/agent-tokens.ts
export function generateAgentToken(): string;                    // "vpr_" + 43 base64url chars (32 random bytes)
export async function hashToken(token: string): Promise<string>; // SHA-256 hex via crypto.subtle

// agents/document.ts RPC methods (called on the stub from routes and VaporMcp)
async mintAgentToken(opts: { name: string; owner?: string; capabilities?: AgentCapability[] }):
  Promise<{ token: string; entry: AgentRosterEntry } | { error: AgentError }>
async getAgentRoster(): Promise<AgentRosterEntry[]>
async revokeAgentToken(name: string): Promise<{ ok: true } | { error: AgentError }>
// internal, used by every agent RPC in later tasks:
private async verifyAgentToken(token: string, needs?: AgentCapability):
  Promise<{ entry: AgentRosterEntry } | { error: AgentError }>
```

Table: `agent_tokens (token_hash TEXT PRIMARY KEY, name TEXT UNIQUE, color TEXT, owner TEXT, capabilities TEXT, created_at INTEGER, last_seen_at INTEGER)` — capabilities JSON-encoded. Mint validates `AGENT_NAME_RE`, rejects duplicate names (`invalid_name`), assigns the next `USER_COLOURS` entry round-robin by roster size. `verifyAgentToken` hashes the presented token, looks it up, checks the needed capability (`capability_denied`), updates `last_seen_at`, and returns `invalid_token` for misses. Existence check: reuse the `exists` row logic from `onRequest` GET — missing doc ⇒ `doc_not_found`.

- [ ] **Step 1: Unit test for the pure helpers**

```ts
// tests/unit/lib/agent-tokens.test.ts
import { describe, it, expect } from "vitest";
import { generateAgentToken, hashToken } from "~/lib/agent-tokens";

describe("agent tokens", () => {
  it("generates prefixed unique tokens", () => {
    const t = generateAgentToken();
    expect(t).toMatch(/^vpr_[A-Za-z0-9_-]{43}$/);
    expect(generateAgentToken()).not.toBe(t);
  });
  it("hashes stably to 64 hex chars", async () => {
    expect(await hashToken("vpr_x")).toBe(await hashToken("vpr_x"));
    expect(await hashToken("vpr_x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `agent-tokens.ts` (`crypto.getRandomValues`, base64url encode; `crypto.subtle.digest("SHA-256", …)` — both exist in Workers and in Node 22 Vitest).
- [ ] **Step 3: Integration test** — in the existing integration file, after extending the sql mock:

```ts
describe("agent roster", () => {
  it("mints, lists, verifies capability, revokes", async () => {
    const agent = makeAgent();               // existing helper for the mocked DocumentAgent
    await agent.onRequest(new Request("https://do/", { method: "POST" }));  // create doc
    const minted = await agent.mintAgentToken({ name: "scribe" });
    expect("token" in minted && minted.token).toMatch(/^vpr_/);
    expect((await agent.getAgentRoster())[0]).toMatchObject({
      name: "scribe", capabilities: ["suggest", "comment"],
    });
    // default grant lacks write (verifyAgentToken is private; cast for the test):
    const v = await (agent as never as { verifyAgentToken(t: string, c?: string): Promise<unknown> })
      .verifyAgentToken((minted as { token: string }).token, "write");
    expect(v).toMatchObject({ error: { code: "capability_denied" } });
    await agent.revokeAgentToken("scribe");
    expect(await agent.getAgentRoster()).toHaveLength(0);
  });
  it("rejects bad names and duplicates", async () => {
    const agent = makeAgent();
    await agent.onRequest(new Request("https://do/", { method: "POST" }));
    expect(await agent.mintAgentToken({ name: "Bad Name" })).toMatchObject({ error: { code: "invalid_name" } });
    await agent.mintAgentToken({ name: "scribe" });
    expect(await agent.mintAgentToken({ name: "scribe" })).toMatchObject({ error: { code: "invalid_name" } });
  });
});
```

- [ ] **Step 4: Implement the DO methods**, run integration file until green.
- [ ] **Step 5: Commit** — `Add per-document agent token roster`.

### Task 5: Read and instant mutations with anchors

**Files:**
- Modify: `agents/document.ts`
- Test: extend `tests/integration/agents/document-agent.test.ts`

**Interfaces:**
- Consumes: Task 2 (`getBlocks`, `yDocToMarkdown`, `resolveAnchor`, `insertMarkdownBlocks`, `deleteBlocks`), Task 4 (`verifyAgentToken`).
- Produces (RPC, all token-first; every mutation takes `pace?: Pace` which this task ignores — Task 6 wires it):

```ts
async agentRead(token: string): Promise<{
  markdown: string;
  blocks: { anchor: string; text: string }[];      // anchor = formatAnchor(block)
  presence: { name: string; isAgent: boolean }[];  // humans from awareness + roster agents currently joined
  threads: ThreadData[];
} | { error: AgentError }>

async agentInsert(token: string, args: { anchor?: string; where: "before" | "after" | "append"; markdown: string; pace?: Pace }): Promise<{ ok: true } | { error: AgentError }>
async agentReplace(token: string, args: { from: string; to?: string; markdown: string; pace?: Pace }): Promise<{ ok: true } | { error: AgentError }>
async agentSuggest(token: string, args: { anchor: string; find: string; replacement: string; pace?: Pace }): Promise<{ ok: true } | { error: AgentError }>
```

Semantics:
- `agentInsert` with `where: "append"` needs no anchor; otherwise resolve the anchor (`stale_anchor` on miss) and insert before/after that block index via `insertMarkdownBlocks`.
- `agentReplace` resolves `from` (and `to`, defaulting to `from`), calls `deleteBlocks`, then `insertMarkdownBlocks` at the from-index — inside one `doc.transact`. Requires `write`.
- `agentSuggest` requires `suggest`: resolve anchor, locate `find` in the block's `Y.XmlText` clean text (`indexOf`; `find_not_matched` with the block text as `snippet` when absent), then in one transaction `ytext.format(pos, find.length, { criticDeletion: {} })` and `ytext.insert(pos + find.length, replacement, { criticAddition: {} })`. Before implementing, read `app/lib/suggest-mode.ts` and mirror the attrs it puts on those marks (author metadata, if any) so agent suggestions render identically to human ones.
- Rate limiting on every mutation: keep `mutationLog: number[]` (timestamps) and `charLog: { at: number; chars: number }[]` per token in a `rate_limits` reuse of the events pattern — simplest correct version: two columns on `agent_tokens` (`recent_mutations TEXT`, JSON array of epoch-ms, pruned to the last hour on each check). Deny with `rate_limited` when >10 in the last 60s or >20 000 chars in the last hour (`RATE_LIMIT_*` constants from Task 1).

- [ ] **Step 1: Write failing integration tests**

```ts
describe("agent mutations", () => {
  async function setup(caps?: AgentCapability[]) {
    const agent = makeAgent();
    await agent.onRequest(new Request("https://do/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Title\n\nBody." }),
    }));
    const m = await agent.mintAgentToken({ name: "scribe", capabilities: caps });
    return { agent, token: (m as { token: string }).token };
  }

  it("reads markdown with anchors", async () => {
    const { agent, token } = await setup();
    const r = await agent.agentRead(token);
    expect("markdown" in r && r.markdown).toBe("# Title\n\nBody.");
    expect("blocks" in r && r.blocks[0].anchor).toMatch(/^b0-[0-9a-f]{8}$/);
  });

  it("denies write without capability, allows with it", async () => {
    const { agent, token } = await setup();                       // default: no write
    const denied = await agent.agentInsert(token, { where: "append", markdown: "More." });
    expect(denied).toMatchObject({ error: { code: "capability_denied" } });
    const { agent: a2, token: t2 } = await setup(["write"]);
    await a2.agentInsert(t2, { where: "append", markdown: "More." });
    const r = await a2.agentRead(t2);
    expect("markdown" in r && r.markdown).toContain("More.");
  });

  it("suggest lays critic marks", async () => {
    const { agent, token } = await setup();
    const read = await agent.agentRead(token);
    const anchor = ("blocks" in read ? read.blocks : [])[2].anchor;   // "Body."
    await agent.agentSuggest(token, { anchor, find: "Body.", replacement: "Better body." });
    const after = await agent.agentRead(token);
    expect("markdown" in after && after.markdown).toContain("{--Body.--}{++Better body.++}");
  });

  it("stale anchor errors after concurrent edit", async () => {
    const { agent, token } = await setup(["write"]);
    const read = await agent.agentRead(token);
    const anchor = ("blocks" in read ? read.blocks : [])[0].anchor;
    await agent.agentReplace(token, { from: anchor, markdown: "# New title" });
    const stale = await agent.agentReplace(token, { from: anchor, markdown: "# Again" });
    expect(stale).toMatchObject({ error: { code: "stale_anchor" } });
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement the four RPCs** in `agents/document.ts` (each starts with `verifyAgentToken(token, neededCap)`, then `ensureInitialised()`; mutations end by touching nothing else — Yjs `update` handler already persists).
- [ ] **Step 4: Run integration + full suite until green.**
- [ ] **Step 5: Commit** — `Add agent read and mutation RPCs with anchor checks`.

### Task 6: Performance engine

**Files:**
- Create: `app/lib/performance-chunks.ts`
- Modify: `agents/document.ts`
- Test: `tests/unit/lib/performance-chunks.test.ts`, extend integration file

**Interfaces:**
- Consumes: Task 5 mutation internals (refactor each mutation's Yjs application into a private `applyMutation(m: PendingMutation)` so the queue and the instant path share it).
- Produces:

```ts
// app/lib/performance-chunks.ts
export interface TypingTick { chunk: string; delayMs: number; }
export function chunkTyping(text: string, pace: "natural" | "fast", rng?: () => number): TypingTick[];
// natural: 2–6 chars/tick, 30–80 ms; extra 300–900 ms pause after ".", "!", "?", "\n"
// fast: 8–16 chars/tick, 10–20 ms, no sentence pauses

// agents/document.ts
private performanceQueue: PendingMutation[];   // also persisted to `performances` table on enqueue, deleted on completion
private hasHumanConnections(): boolean;        // this.getConnections() non-empty
private async runPerformances(): Promise<void>; // drains queue; setTimeout between ticks; instant when no humans
```

Behaviour: a mutation with `pace` `"natural"`/`"fast"` **enqueues** and returns `{ ok: true }` immediately; `"instant"` (or no human connections) applies synchronously. The runner takes one mutation at a time, moves the agent's cursor (Task 7 wires awareness; until then a no-op hook `onPerformanceCursor(name, blockIndex)`), and for insert/suggest text applies `chunkTyping` ticks as successive `ytext.insert` transactions so remote clients see typing. On `ensureInitialised`, any rows left in `performances` (eviction mid-performance) apply instantly. Anchor resolution happens at **dequeue** time, not enqueue, so queued work re-checks staleness; a stale queued mutation is dropped and recorded as an event (`doc_changed` digest payload `{"dropped": …}` — Task 8 adds the events table; until then just delete the row).

- [ ] **Step 1: Unit-test the chunker** (deterministic rng: `() => 0.5`):

```ts
import { describe, it, expect } from "vitest";
import { chunkTyping } from "~/lib/performance-chunks";

describe("chunkTyping", () => {
  it("covers the whole text in order", () => {
    const ticks = chunkTyping("Hello world. Bye.", "natural", () => 0.5);
    expect(ticks.map((t) => t.chunk).join("")).toBe("Hello world. Bye.");
  });
  it("pauses after sentence ends", () => {
    const ticks = chunkTyping("Hi. Yo", "natural", () => 0.5);
    const afterDot = ticks.find((t) => t.chunk.startsWith(" Yo") || t.chunk.startsWith("Yo"));
    expect(afterDot!.delayMs).toBeGreaterThanOrEqual(300);
  });
  it("fast pace uses bigger chunks", () => {
    expect(chunkTyping("x".repeat(100), "fast", () => 0.5).length)
      .toBeLessThan(chunkTyping("x".repeat(100), "natural", () => 0.5).length);
  });
});
```

- [ ] **Step 2: Run (fail), implement, run (pass).**
- [ ] **Step 3: Integration test with fake timers** — enqueue an insert at `natural` pace with one mock human connection attached; `vi.useFakeTimers()`; assert the doc is incomplete after the first tick and complete after `vi.runAllTimersAsync()`; assert instant application when `getConnections()` is empty.
- [ ] **Step 4: Full suite green.**
- [ ] **Step 5: Commit** — `Add performance engine for paced agent edits`.

### Task 7: Agent presence in awareness

**Files:**
- Create: `app/lib/agent-awareness.ts`
- Modify: `agents/document.ts`
- Test: `tests/unit/lib/agent-awareness.test.ts`, extend integration file

**Interfaces:**
- Consumes: `MSG_AWARENESS` from `app/shared/constants.ts`; broadcast pattern from `agents/document.ts` `broadcastBinary`.
- Produces:

```ts
// app/lib/agent-awareness.ts — hand-encode awareness updates for synthetic clients
export interface AgentPresenceState {
  user: { name: string; color: string; isAgent: true };
  status?: string;
  cursor?: unknown;   // y-prosemirror relative-position JSON; see step 3
}
export function encodeAgentAwareness(
  clientId: number, clock: number, state: AgentPresenceState | null,
): Uint8Array;  // full MSG_AWARENESS frame ready to broadcast: varUint(MSG_AWARENESS), varUint8Array(update)
// update format (y-protocols/awareness): varUint(1 entry), varUint(clientId), varUint(clock), varString(JSON state or "null")

// agents/document.ts
private agentPresence: Map<string, { clientId: number; clock: number }>;  // name → synthetic client
async agentJoin(token: string, status?: string): Promise<{ ok: true } | { error: AgentError }>
async agentLeave(token: string): Promise<{ ok: true } | { error: AgentError }>
```

Synthetic `clientId`: derive stably from the agent name (`parseInt(blockHash(name), 16) >>> 1`, forced non-zero) so reconnects reuse it. `agentJoin` broadcasts presence to every connection and replays current agent states in `onConnect` (after the existing awareness replay) so late joiners see resident agents. `onPerformanceCursor` from Task 6 becomes real: `Y.createRelativePositionFromTypeIndex(ytext, offset)` → `JSON.parse(JSON.stringify(Y.relativePositionToJSON(pos)))` placed in `state.cursor` as `{ anchor, head }` — **verify the exact field shape against what `@tiptap/extension-collaboration-caret` writes** by inspecting a live awareness state in the browser console before settling it (`provider.awareness.getStates()`), and match it. Idle timeout: on join, store `lastActiveAt`; a 5-minute `setTimeout` (reset on each performance) broadcasts a `null` state (presence removal).

- [ ] **Step 1: Unit-test the encoder** — decode with the real `y-protocols/awareness` `applyAwarenessUpdate` against a scratch `Awareness` instance and assert the state landed:

```ts
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as decoding from "lib0/decoding";
import { encodeAgentAwareness } from "~/lib/agent-awareness";

it("encodes a state the protocol can apply", () => {
  const frame = encodeAgentAwareness(12345, 1, { user: { name: "scribe", color: "#4DD0E1", isAgent: true } });
  const dec = decoding.createDecoder(frame);
  expect(decoding.readVarUint(dec)).toBe(1);                       // MSG_AWARENESS
  const aw = new awarenessProtocol.Awareness(new Y.Doc());
  awarenessProtocol.applyAwarenessUpdate(aw, decoding.readVarUint8Array(dec), "test");
  expect(aw.getStates().get(12345)).toMatchObject({ user: { name: "scribe", isAgent: true } });
});
```

- [ ] **Step 2: Run (fail), implement encoder with `lib0/encoding`, run (pass).**
- [ ] **Step 3: Integration** — `agentJoin` then assert every mock connection received a frame whose decode contains the agent; connect a new mock client and assert `onConnect` replays it.
- [ ] **Step 4: UI check** — `npm run dev`, join an agent via a scratch script or temporary test route, confirm the presence stack shows the agent; style the `isAgent` badge in the avatar stack and caret label (find the presence component via `grep -rn "awareness" app/components app/lib/useYjsEditor.ts`; render a small "AI" chip using existing Tailwind patterns).
- [ ] **Step 5: Commit** — `Add synthetic agent presence to awareness`.

### Task 8: Events, mentions, await_events

**Files:**
- Modify: `agents/document.ts`
- Test: extend integration file (mention detection unit case is already covered by Task 1's `findMentions`)

**Interfaces:**
- Consumes: `findMentions` (Task 1), roster (Task 4).
- Produces:

```ts
// table: events (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, payload TEXT, created_at INTEGER)
async agentAwaitEvents(token: string, args: { cursor?: number; timeoutMs?: number }):
  Promise<{ events: { seq: number; type: "mention" | "thread_reply" | "doc_changed"; payload: unknown }[]; cursor: number } | { error: AgentError }>
private recordEvent(type: string, payload: unknown): void;   // inserts row + resolves waiting promises
```

Mention detection: in `ensureInitialised`, after doc setup, attach `frag.observeDeep(events => …)` that walks each event's `changes.delta`, collects inserted strings, and for each `findMentions(text, rosterNames)` hit records `{ type: "mention", payload: { agent: name, text: <the containing block text, via getBlocks> } }`. Skip transactions originated by agent RPCs (tag them: `doc.transact(fn, "agent")` and check `event.transaction.origin !== "agent"`). `doc_changed` digests: on human-origin updates, record at most one event per 30 s (in-memory `lastDigestAt`). Long-poll: if no rows past `cursor`, park the resolver in `this.eventWaiters: (() => void)[]` and race a `setTimeout` of `min(timeoutMs ?? 50_000, 50_000)`; `recordEvent` flushes waiters. Events are pruned in the existing `alarm` (doc expiry) along with everything else.

- [ ] **Step 1: Failing integration tests** — (a) mint `scribe`, simulate a human edit inserting `"ping @scribe please"` through the Yjs sync path (existing test helpers do real Y.Doc sync), then `agentAwaitEvents` returns the mention; (b) with no events, a call with `timeoutMs: 50` resolves empty after the timeout (fake timers); (c) `cursor` excludes already-seen events.
- [ ] **Step 2: Run (fail).** **Step 3: Implement.** **Step 4: Run (pass), full suite.**
- [ ] **Step 5: Commit** — `Add document events with mention detection and long-poll`.

---

## Phase 3 — the MCP door

### Task 9: VaporMcp server and worker routing

**Files:**
- Create: `agents/mcp.ts`, `agents/mcp-tools.ts`
- Modify: `workers/app.ts`, `wrangler.jsonc`, `package.json` (add explicit deps: `@modelcontextprotocol/sdk`, `zod` — both already in the tree transitively; pin what `npm ls` shows)
- Test: `tests/unit/agents/mcp-tools.test.ts` (the tool→RPC mapping with a fake stub; `agents/mcp-tools.ts` must not import from the `agents` npm package so it stays unit-testable)

**Interfaces:**
- Consumes: every `agent*` RPC from Tasks 4–8; `getAgentByName` (in `agents/mcp.ts` only).
- Produces:

```ts
// agents/mcp-tools.ts — pure tool table, unit-testable
export interface DocStub {   // the subset of DocumentAgent RPC the tools call
  agentRead(token: string): Promise<unknown>;
  agentInsert(token: string, args: unknown): Promise<unknown>;
  agentReplace(token: string, args: unknown): Promise<unknown>;
  agentSuggest(token: string, args: unknown): Promise<unknown>;
  agentComment(token: string, args: unknown): Promise<unknown>;
  agentReply(token: string, args: unknown): Promise<unknown>;
  agentJoin(token: string, status?: string): Promise<unknown>;
  agentLeave(token: string): Promise<unknown>;
  agentAwaitEvents(token: string, args: unknown): Promise<unknown>;
}
export interface ToolDeps { getStub(docId: string): Promise<DocStub>; token: string; }
export const TOOLS: { name: string; description: string; schema: ZodRawShape;
                      run(deps: ToolDeps, args: Record<string, unknown>): Promise<unknown> }[];
// one entry per spec tool: read_document, insert, replace, suggest, comment, reply,
// join, leave, await_events  (create_document is Task 10 — it's HTTP, not tool, per spec? NO:
// spec lists it as a tool with no auth; implement it in agents/mcp.ts directly since it needs env access
// and no token — see step 4.)
```

```ts
// agents/mcp.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export class VaporMcp extends McpAgent<Env, never, { bearer: string | null }> {
  server = new McpServer({ name: "vapor", version: "1.0.0" });
  async init() { /* register TOOLS via this.server.tool(name, desc, schema, handler) */ }
}
```

Worker entry (`workers/app.ts`): before `routeAgentRequest`,

```ts
if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
  const auth = request.headers.get("Authorization");
  ctx.props = { bearer: auth?.startsWith("Bearer ") ? auth.slice(7) : null };
  return VaporMcp.serve("/mcp", { binding: "VaporMcp" }).fetch(request, env, ctx);
}
```

(Read the installed `agents/mcp` typings for the exact `serve` signature and props plumbing before writing this — `node_modules/agents/dist/mcp*.d.ts`. The pattern is the Cloudflare-documented `ctx.props` + `McpAgent.serve` one; adjust to the version in the lockfile, not from memory.) Tools resolve `deps.getStub(doc_id)` → `getAgentByName(this.env.DocumentAgent, docId)` and pass `this.props.bearer` as the token; a null bearer returns the `invalid_token` error object as tool content. Every tool returns `{ content: [{ type: "text", text: JSON.stringify(result) }] }`.

`wrangler.jsonc`: add `{ "name": "VaporMcp", "class_name": "VaporMcp" }` to `durable_objects.bindings` and a migration `{ "tag": "v2", "new_sqlite_classes": ["VaporMcp"] }`; export `VaporMcp` from `workers/app.ts`.

- [ ] **Step 1: Failing unit test for the tool table**

```ts
// tests/unit/agents/mcp-tools.test.ts
import { describe, it, expect, vi } from "vitest";
import { TOOLS } from "../../../agents/mcp-tools";   // no "~" — file lives outside app/

describe("mcp tool table", () => {
  const names = TOOLS.map((t) => t.name);
  it("exposes the spec surface", () => {
    for (const n of ["read_document", "insert", "replace", "suggest", "comment", "reply", "join", "leave", "await_events"])
      expect(names).toContain(n);
  });
  it("routes read_document to the stub with the bearer token", async () => {
    const stub = { agentRead: vi.fn(async () => ({ markdown: "# Hi", blocks: [], presence: [], threads: [] })) };
    const tool = TOOLS.find((t) => t.name === "read_document")!;
    const out = await tool.run(
      { getStub: async () => stub as never, token: "vpr_t" },
      { doc_id: "abcd1234" },
    );
    expect(stub.agentRead).toHaveBeenCalledWith("vpr_t");
    expect(out).toMatchObject({ markdown: "# Hi" });
  });
});
```

- [ ] **Step 2: Run (fail), implement `mcp-tools.ts` with zod shapes** (e.g. `insert`: `{ doc_id: z.string(), anchor: z.string().optional(), where: z.enum(["before","after","append"]), markdown: z.string(), pace: z.enum(["natural","fast","instant"]).optional() }`), run (pass).
- [ ] **Step 3: Implement `agents/mcp.ts` + worker routing + wrangler config**; `npm run typecheck` (regenerates Env types via cf-typegen).
- [ ] **Step 4: Add `create_document` tool inside `agents/mcp.ts`** — no token required: generate an id (`generateDocumentId`), POST to the doc stub as `app/routes/new.ts` does, mint a default token via `stub.mintAgentToken({ name: "agent" })`, return `{ id, url: "https://vapor.fyi/" + id, token }`.
- [ ] **Step 5: Live verification** — `npm run dev`, then from another terminal: `claude mcp add --transport http vapor-dev http://localhost:5173/mcp --header "Authorization: Bearer <token minted via a scratch route or Task 11 UI>"`; in a Claude session, `read_document` a doc you created in the browser and `suggest` an edit; watch the marks land. Record the transcript command in the PR description.
- [ ] **Step 6: Commit** — `Serve MCP at /mcp backed by DocumentAgent RPCs`.

### Task 10: Raw markdown export and /mcp help page

**Files:**
- Modify: `workers/app.ts`
- Create: `app/lib/mcp-help.ts` (exports a `mcpHelpHtml(origin: string): string` template string)
- Test: `tests/unit/agents/worker-routes.test.ts` (extract the two handlers into `workers/routes.ts` as pure functions taking `(request, env)` so they unit-test without the worker harness; `workers/app.ts` calls them)

**Interfaces:**
- Consumes: `yDocToMarkdown` via a new `DocumentAgent` RPC `exportMarkdown(): Promise<{ markdown: string } | { error: AgentError }>` (no token — docs are public by URL; add it to `agents/document.ts` in this task, exists-checked).
- Produces: `GET /:id.md` → `text/markdown` (404 for missing docs, id validated with `isValidDocumentId`); `GET /mcp` with `Accept: text/html` → the help page (API clients POST, so only browser GETs see it — check method GET + Accept header **before** the `VaporMcp.serve` branch).

- [ ] **Step 1: Failing tests** — `handleRawMarkdown` returns 200 + `text/markdown` for an existing doc (fake env stub), 404 for missing/invalid id; `GET /mcp` with `Accept: text/html` returns HTML containing `claude mcp add`.
- [ ] **Step 2–4: Implement, run, full suite.** Help page copy (real content, sentence case): what vapor's MCP is, the three connection snippets from the spec's Connect UI section with the origin substituted, and a note that tokens are minted from a document's **Invite agent** dialog.
- [ ] **Step 5: Commit** — `Add raw markdown export and MCP help page`.

---

## Phase 4 — connect UI

### Task 11: Invite agent dialog and roster

**Files:**
- Create: `app/components/InviteAgentDialog.tsx`, `app/routes/doc.$id.agents.ts` (resource route: `action` for mint/revoke, `loader` for roster)
- Modify: `app/routes.ts` (add `route(":id/agents", "routes/doc.$id.agents.ts")`), the doc header/menu component (find it: `grep -rn "Share\|menu\|header" app/components --include=*.tsx -l` and read `app/routes/doc.$id.tsx` for composition)
- Test: `tests/unit/routes/doc-agents-route.test.ts`, `tests/unit/components/InviteAgentDialog.test.tsx`

**Interfaces:**
- Consumes: `mintAgentToken`, `getAgentRoster`, `revokeAgentToken` RPCs; `getCloudflare`/`getAgentByName` pattern from `app/routes/new.ts`.
- Produces: `POST /:id/agents` with JSON `{ intent: "mint", name, owner?, capabilities }` → `{ token, entry }` (token appears exactly once, in this response); `{ intent: "revoke", name }` → `{ ok: true }`; `GET /:id/agents` → `AgentRosterEntry[]`.

Dialog (Radix is already a dependency — use `@radix-ui/react-dropdown-menu` peers' styling conventions from existing components):
1. Fields: name (text input, pre-filled with an unused slug like `scribe`, validated against `AGENT_NAME_RE` with inline error copy "Lowercase letters, digits, and hyphens"), owner (optional text), capability switches — **Suggest** and **Comment** on, **Write** off, using `@radix-ui/react-switch` like the existing theme controls.
2. On create: POST, then swap to the token screen — the token in a `<code>` block with a copy button, the warning "This token is shown once. Revoke and re-mint to replace it.", and three copy-snippet rows (Claude Code command, claude.ai connector URL `https://vapor.fyi/mcp`, `mcpServers` JSON) built from `window.location.origin`.
3. Roster list below: name, colour dot, capability chips, owner, last seen (relative), revoke button per row.

- [ ] **Step 1: Failing route test** — mock the stub (pattern from existing route tests in `tests/unit/routes/`): mint intent returns a token once; revoke removes; loader lists.
- [ ] **Step 2: Implement the resource route; run (pass).**
- [ ] **Step 3: Failing component test** (Testing Library, `tests/helpers/document-context.tsx` provides the doc context): renders defaults (suggest+comment checked, write unchecked); submitting calls fetch with the typed name; token screen shows the token from the mocked response.
- [ ] **Step 4: Implement the dialog, wire an "Invite agent" item into the doc menu, run tests.**
- [ ] **Step 5: Visual check** — `npm run dev`, mint a real token, connect Claude Code with the copied command, watch the agent appear in presence. This is the acceptance demo from the spec.
- [ ] **Step 6: Commit** — `Add invite agent dialog and roster management`.

---

## Phase 5 — domains and docs

### Task 12: Redirect secondary domains

**Files:**
- Modify: `workers/routes.ts` (hostname redirect), `wrangler.jsonc` (two more custom domains)
- Test: extend `tests/unit/agents/worker-routes.test.ts`

**Interfaces:**
- Produces: requests whose hostname is `vpr.fyi`, `www.vpr.fyi`, `vaporware.fyi`, `www.vaporware.fyi`, or `www.vapor.fyi` get `301` to `https://vapor.fyi` + original path/query. `wrangler.jsonc` routes gain `{ "pattern": "vpr.fyi", "custom_domain": true }` and `{ "pattern": "vaporware.fyi", "custom_domain": true }`.

- [ ] **Step 1: Failing test** — `redirectHost(new Request("https://vpr.fyi/abc?x=1"))` returns 301 with `Location: https://vapor.fyi/abc?x=1`; `vapor.fyi` requests return `null`.
- [ ] **Step 2: Implement as the first check in the worker fetch; run (pass).**
- [ ] **Step 3: Deploy check** — after merge, `npm run deploy` (their zones may still hold Porkbun parking DNS records like vapor.fyi did; if wrangler errors with code 100117, delete the zone's A/CNAME parking records via the dashboard or API, then redeploy). `curl -sI https://vpr.fyi | grep -i location` shows `https://vapor.fyi/`.
- [ ] **Step 4: Commit** — `Redirect secondary domains to vapor.fyi`.

### Task 13: Docs and org template

**Files:**
- Modify: `README.md` (rename references mist→vapor where they describe *this* deployment, keep upstream credit: "vapor is a fork of [mist](https://github.com/inanimate-tech/mist)"; document the MCP door: connect command, tool list, token model), `CLAUDE.md` (restructure onto the arfct org template header — primer links — keeping every repo-specific section; add a short "Agent collaborators" architecture note pointing at the spec and the new modules)
- Test: none (docs)

- [ ] **Step 1: Rewrite the two docs.** The CLAUDE.md template is `~/Code/artifact-process/ops/templates/CLAUDE.md` (also at github.com/arfct/ops → templates).
- [ ] **Step 2: `npm run lint` (markdown untouched by it, but keeps the habit), commit** — `Update README and CLAUDE.md for the vapor fork`.
- [ ] **Step 3: Open the PR** for the whole feature branch per org standards; PR body links the spec and lists the acceptance demo commands. After merge + deploy: add a vapor row to `arfct/ops` `primer/deployment.md` (separate ops PR) and record the three domains in `arfct/internal`.

---

## Self-review notes

- Spec coverage: routing (T3), tokens/roster (T4, T11), tool surface (T5, T8, T9), anchors (T2, T5), performance engine (T6), presence (T7), events/summoning (T8), connect UI (T11), `/mcp` help + `/:id.md` (T10), redirects (T12), chores (T13). `create_document` in T9 step 4.
- Deliberate deviations from spec text: none. Rate-limit storage rides on `agent_tokens` rather than its own table (fewer moving parts, same behaviour).
- Known verify-in-repo points (flagged inline): critic mark attrs (T5), collaboration-caret cursor field shape (T7), `McpAgent.serve` signature for the installed `agents` version (T9). Each has a concrete default plus the file to check.
