import { Agent, getAgentByName } from "agents";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS, DOCUMENT_TTL_MS, DOC_FORMAT_VERSION, USER_COLOURS } from "../app/shared/constants";
import { animalGlyphForLabel } from "../app/shared/anon-animals";
import type { AgentIdentity, AgentCapability, AgentRosterEntry, AgentError, MentionTarget, Pace } from "../app/shared/agent-protocol";
import { agentMention, anonymousAgentMention } from "../app/shared/agent-protocol";
import { colorIndexFor } from "../app/shared/short-id";
import { descriptionFromMarkdown, titleFromMarkdown } from "../app/shared/doc-url";
import {
  AGENT_NAME_RE,
  findMentions,
  MAX_AGENTS_PER_DOC,
  RATE_LIMIT_MUTATIONS_PER_MIN,
  RATE_LIMIT_CHARS_PER_HOUR,
} from "../app/shared/agent-protocol";
import {
  getBlocks,
  getAgentInstructions,
  instructionsForAgents,
  yDocToMarkdown,
  resolveAnchor,
  buildMarkdownBlocks,
  insertBlockNodes,
  deleteBlocks,
  formatAnchor,
  parseMarkdown,
  buildTypedBlock,
  pmNodeToYElement,
} from "../app/shared/rich-markdown";
import { chunkTyping } from "../app/lib/performance-chunks";
import {
  eventCatalog,
  eventTypeByName,
  buildOccurrence,
  encodeCursor,
  decodeCursor,
  isValidWebhookSecret,
  webhookUrlError,
  subscriptionId,
  signWebhook,
  grantTtlMs,
  DELIVERY_RETRY_DELAYS_MS,
  SUSPEND_AFTER_FAILING_MS,
  POLL_RETRY_AFTER_MS,
  type EventOccurrence,
  eventId,
} from "./events";
import { encodeAgentAwareness, agentClientId, type AgentPresenceState } from "../app/lib/agent-awareness";
import {
  IDLE_SNAPSHOT_MS,
  MAX_VERSION_BYTES,
  RESTORE_COOLDOWN_MS,
  clientIdsInUpdate,
  primaryAuthor,
  pruneOrder,
  shouldSnapshotOnDelta,
  type VersionAuthor,
  type VersionReason,
  type VersionSummary,
} from "../app/shared/version-policy";
import { handleVersionRequest, type VersionStub } from "./version-routes";
import {
  RESERVATION_TTL_MS,
  budgetAllows,
  mintAttachmentId,
  sanitizeFilename,
  typeForFilename,
  type AttachmentError,
} from "../app/shared/attachment-policy";
import type { ThreadData, ThreadReply, UserInfo } from "../app/shared/types";
import { threadIdForComment } from "../app/shared/thread-id";
import { stripInlineMarkdown } from "../app/shared/quote-text";
import type { WakeEvent } from "../app/shared/wake-policy";
import { configuredOrigin } from "../app/shared/site";
import type Registry from "./registry";

/** A recorded document event's public shape, as returned by agentAwaitEvents. */
type DocEventType = "mention" | "thread_reply" | "doc_changed";

/**
 * Origins of server-side Yjs transactions. A bare "agent" is a system write
 * (import, restore) that fires no events. An object names the roster agent
 * behind an edit: observers then emit events for it like any human edit,
 * and each agent's poll drops what it did itself (`payload.actor`), so one
 * agent mentioning another wakes the other without either hearing its own
 * typing echoed back (#40). Human edits arrive with a null origin.
 */
type AgentOrigin = "agent" | { kind: "agent"; actor: string };

function agentOrigin(actor: string): AgentOrigin {
  return { kind: "agent", actor };
}

function isAgentOrigin(origin: unknown): origin is AgentOrigin {
  if (origin === "agent") return true;
  return typeof origin === "object" && origin !== null && (origin as { kind?: unknown }).kind === "agent";
}

/** The roster name behind an agent-origin transaction; null for human edits and system writes. */
function agentActor(origin: unknown): string | null {
  if (typeof origin !== "object" || origin === null) return null;
  const o = origin as { kind?: unknown; actor?: unknown };
  return o.kind === "agent" && typeof o.actor === "string" ? o.actor : null;
}

interface EventRow {
  seq: number;
  type: string;
  payload: string;
  created_at: number;
}

/** How long an agent can go without a join/performance before its presence is auto-removed. */
const AGENT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How early an alarm may fire and still count as "due". Alarms are precise
 * to the millisecond in practice, but a scheduled task that lands a beat
 * before its deadline must not be re-armed for one more wake.
 */
const ALARM_SLACK_MS = 1_000;

/** Re-writing a scheduled task whose deadline moves by less than this is not worth a storage write. */
const SCHEDULE_JITTER_MS = 5_000;

/** Prefix of the scheduled task that clears an idle agent's presence. */
const IDLE_TASK_PREFIX = "idle:";
/** The scheduled task that takes the idle version snapshot. */
const SNAPSHOT_TASK = "snapshot";
/** The scheduled task that fires document.expiring (#83). */
const EXPIRING_TASK = "expiring";
/** How far ahead of deletion document.expiring fires. */
const EXPIRING_LEAD_MS = 6 * 60 * 60 * 1000;

/**
 * Wall-clock budget for one typed performance. Typing pins this Durable
 * Object in memory for its whole duration (a real cost — see
 * docs/plans/2026-08-31-sleeping-tabs-plan.md), so past the budget the
 * remainder of the mutation applies instantly instead of continuing the
 * show.
 */
const PERFORMANCE_WALL_BUDGET_MS = 10_000;

/**
 * Durable Objects SQLite accepts Uint8Array for BLOB columns via the
 * template literal API, but the type signature expects string. This
 * helper makes the cast explicit and grep-able.
 */
function sqlBlob(data: Uint8Array): string {
  return data as unknown as string;
}

/**
 * All Y.XmlText descendants of a block element, in document order — rich
 * blocks (lists, quotes) nest their text inside child elements. A suggest's
 * `find` must land inside a single text node; matches that span nodes are
 * treated as not found.
 */
function textNodesUnder(el: Y.XmlElement): Y.XmlText[] {
  const out: Y.XmlText[] = [];
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) out.push(child);
    else if (child instanceof Y.XmlElement) out.push(...textNodesUnder(child));
  }
  return out;
}

/**
 * Locates `find` in a block's text: the exact string first, then — since
 * agents copy quotes out of read_document's markdown — the string with its
 * inline markdown syntax removed. Returns the node, offset, and the length
 * of what actually matched, which is what a mark must cover.
 */
function findInBlock(
  el: Y.XmlElement,
  find: string,
): { ytext: Y.XmlText; pos: number; length: number } | null {
  const candidates = [find];
  const plain = stripInlineMarkdown(find);
  if (plain !== find && plain.length > 0) candidates.push(plain);
  for (const ytext of textNodesUnder(el)) {
    const text = (ytext.toDelta() as { insert: string }[]).map((op) => op.insert).join("");
    for (const candidate of candidates) {
      const pos = text.indexOf(candidate);
      if (pos !== -1) return { ytext, pos, length: candidate.length };
    }
  }
  return null;
}

/**
 * A comment's inline footprint in a block: the hidden `criticComment` run
 * carrying the comment text and, when the comment was made on a selection,
 * the `criticHighlight` run that immediately precedes it — the same two
 * marks the UI's CommentInput lays down, and what the client's
 * scanDocumentComments reads back to place the thread.
 */
interface CommentRun {
  ytext: Y.XmlText;
  pos: number;
  length: number;
  highlight: { pos: number; length: number } | null;
}

type DeltaOp = { insert: string; attributes?: Record<string, unknown> };

function findCommentRun(el: Y.XmlElement, commentText: string): CommentRun | null {
  for (const ytext of textNodesUnder(el)) {
    const ops = ytext.toDelta() as DeltaOp[];
    let offset = 0;
    let run: { pos: number; text: string; highlight: CommentRun["highlight"] } | null = null;
    let highlight: CommentRun["highlight"] = null;
    const done = () =>
      run && run.text === commentText
        ? { ytext, pos: run.pos, length: run.text.length, highlight: run.highlight }
        : null;
    for (const op of ops) {
      const len = op.insert.length;
      if (op.attributes?.criticComment) {
        // Consecutive comment ops (the text may carry other marks) are one run.
        if (run) run.text += op.insert;
        else run = { pos: offset, text: op.insert, highlight: highlight && highlight.pos + highlight.length === offset ? highlight : null };
      } else {
        const found = done();
        if (found) return found;
        run = null;
        if (op.attributes?.criticHighlight) {
          if (highlight && highlight.pos + highlight.length === offset) highlight.length += len;
          else highlight = { pos: offset, length: len };
        } else {
          highlight = null;
        }
      }
      offset += len;
    }
    const found = done();
    if (found) return found;
  }
  return null;
}

/** The comment run for a thread anywhere in the document, by its comment text. */
function findCommentRunInDoc(doc: Y.Doc, commentText: string): CommentRun | null {
  const frag = doc.getXmlFragment("default");
  for (let i = 0; i < frag.length; i++) {
    const el = frag.get(i);
    if (!(el instanceof Y.XmlElement)) continue;
    const run = findCommentRun(el, commentText);
    if (run) return run;
  }
  return null;
}

/**
 * Deletes a comment's hidden text and lifts its highlight, keeping the
 * highlighted words — what useThreads.removeInlineComment does on resolve
 * and delete. Call inside a transaction.
 */
function removeCommentRun(run: CommentRun): void {
  run.ytext.delete(run.pos, run.length);
  if (run.highlight) run.ytext.format(run.highlight.pos, run.highlight.length, { criticHighlight: null });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The Yjs-application-only part of a mutation, shared by all three RPCs. */
type MutationPayload =
  | { kind: "insert"; anchor?: string; where: "before" | "after" | "append"; markdown: string }
  | { kind: "replace"; from: string; to?: string; markdown: string }
  | { kind: "suggest"; anchor: string; find: string; replacement: string };

/**
 * A mutation either being applied instantly or sitting in the performance
 * queue. `id`/`agentName`/`pace` are meaningless for the instant path (it
 * never touches the `performances` table) — only the queue runner and
 * eviction recovery care about them.
 */
interface PendingMutation {
  id: number;
  agentName: string;
  pace: Pace;
  mutation: MutationPayload;
}

interface PerformanceRow {
  id: number;
  agent_name: string;
  kind: string;
  payload: string;
  created_at: number;
}

interface RosterRow {
  identity_id: string;
  name: string;
  label?: string | null;
  color: string;
  owner: string | null;
  capabilities: string;
  created_at: number;
  last_seen_at: number | null;
  /** JSON array of { at: epoch-ms, chars: number }, pruned to the last hour. */
  recent_mutations?: string | null;
  /** The mention token (without `@`); null on rows enrolled before tokens existed. */
  mention?: string | null;
  /** The owner's public short id; null for anonymous agents. */
  owner_uid?: string | null;
  /** The connecting client's display name, e.g. "Claude". */
  client?: string | null;
}

/** One recorded mutation, used for rate-limiting agent writes. */
interface MutationLogEntry {
  at: number;
  chars: number;
}

function rowToRosterEntry(row: RosterRow): AgentRosterEntry {
  return {
    name: row.name,
    label: row.label ?? null,
    color: row.color,
    ownerUid: row.owner_uid ?? null,
    client: row.client ?? null,
    // Rows enrolled before tokens existed are mentioned by bare name.
    mention: row.mention ?? row.name,
    capabilities: JSON.parse(row.capabilities) as AgentCapability[],
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * The token a document mentions an agent by: the owner's name and public
 * id for a counterpart, the client name and a session id for an
 * anonymous agent (docs/plans/2026-09-06-agent-identity-plan.md).
 */
function mentionForIdentity(identity: AgentIdentity, name: string): string {
  if (identity.ownerUid && identity.ownerName) return agentMention(identity.ownerName, identity.ownerUid);
  return anonymousAgentMention(name, identity.id);
}

class DocumentAgent extends Agent {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;

  /** In-memory mirror of the `performances` table, drained by runPerformances(). */
  private performanceQueue: PendingMutation[] = [];
  private isPerforming = false;
  /**
   * Assigns queue-row ids for this instance's lifetime. Reset to 1 on every
   * fresh instantiation, which is safe because ensureInitialised() always
   * drains (and deletes) any leftover `performances` rows before any new
   * mutation can be enqueued.
   */
  private nextPerformanceId = 1;

  /**
   * Synthetic awareness presence for agents, keyed by agent name. `clock`
   * is monotonically increasing (never reset) because `clientId` is stable
   * across join/leave/idle cycles for a given agent name — a browser
   * client's Awareness only accepts an update whose clock is strictly
   * greater than the last one it saw for that clientId (or an equal clock
   * that carries a null state), so restarting the clock at 1 after a leave
   * would make later updates silently ignored by anyone who saw the higher
   * clock before. `state: null` means "currently absent" (left or idled
   * out) but the entry is kept so the clock keeps counting up.
   */
  private agentPresence = new Map<string, { clientId: number; clock: number; state: AgentPresenceState | null }>();
  /**
   * In-memory mirror of the `schedule` table's deadlines, so re-scheduling
   * a task to (nearly) the same time skips the storage write. Lost on
   * eviction, which only costs one redundant write on the next schedule.
   */
  private scheduledDue = new Map<string, number>();

  /** Resolvers parked by agentAwaitEvents long-polls with nothing to return yet; flushed by recordEvent. */
  private eventWaiters: (() => void)[] = [];
  /** Timestamp of the last "doc_changed" digest event, to cap it at one per 30s. */
  private lastDigestAt = new Map<string, number>();
  /** Agent names already notified for a top-level block — see notifyMentions. */
  private notifiedMentions = new WeakMap<Y.AbstractType<unknown>, Set<string>>();

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while POST / sets a document up, so its writes book no snapshot. */
  private creating = false;

  // ---- Version history (docs/plans/2026-09-05-version-history-plan.md) ----
  /** 60s quiet edge for an `idle` version; separate from the 1s persist timer so persistence stays cheap. */
  /** Everyone whose structs landed since the last version, most recent last. */
  private contributorsSinceSnapshot = new Map<string, VersionAuthor>();
  /** Content has changed since the last version (or since creation). */
  private dirtySinceSnapshot = false;
  /** The Yjs client ids each WebSocket connection has published awareness for. */
  private connectionClients = new Map<string, Set<number>>();
  private lastRestoreAt = 0;

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushDocState();
    }, 1_000);
  }

  private flushDocState(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.doc) return;
    const state = Y.encodeStateAsUpdate(this.doc);
    this.sql`
      INSERT INTO doc_state (key, value) VALUES ('state', ${sqlBlob(state)})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `;
    this.snapshotOnDelta();
  }

  private ensureInitialised(): { doc: Y.Doc; awareness: awarenessProtocol.Awareness } {
    if (this.doc && this.awareness) {
      return { doc: this.doc, awareness: this.awareness };
    }

    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    // Awareness starts a 3-second setInterval to expire stale peers. A
    // standing timer keeps a Durable Object from hibernating, so every
    // document that had ever been opened stayed awake — and billed — until
    // eviction (#58). Clear it; pruneOutdatedAwareness does the same job on
    // incoming traffic, and onClose removes a departing client's state.
    clearInterval((this.awareness as unknown as { _checkInterval?: ReturnType<typeof setInterval> })._checkInterval);
    // Remember which Yjs clients each connection speaks for, so a control
    // message from a connection can be attributed to its awareness user.
    this.awareness.on(
      "update",
      ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
        const id = (origin as { id?: unknown } | null)?.id;
        if (typeof id !== "string") return;
        const clients = this.connectionClients.get(id) ?? new Set<number>();
        for (const c of [...added, ...updated]) clients.add(c);
        this.connectionClients.set(id, clients);
      },
    );

    // Create tables if needed
    this.sql`
      CREATE TABLE IF NOT EXISTS doc_state (
        key TEXT PRIMARY KEY,
        value BLOB
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS roster (
        identity_id TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        label TEXT,
        color TEXT,
        owner TEXT,
        capabilities TEXT,
        created_at INTEGER,
        last_seen_at INTEGER,
        recent_mutations TEXT
      )
    `;
    // Columns added after the table shipped (identity plan): mention token,
    // owner's public id, connecting client. Rows from before stay valid.
    const rosterColumns = new Set(this.sql<{ name: string }>`PRAGMA table_info(roster)`.map((c) => c.name));
    if (!rosterColumns.has("mention")) this.sql`ALTER TABLE roster ADD COLUMN mention TEXT`;
    if (!rosterColumns.has("owner_uid")) this.sql`ALTER TABLE roster ADD COLUMN owner_uid TEXT`;
    if (!rosterColumns.has("client")) this.sql`ALTER TABLE roster ADD COLUMN client TEXT`;
    this.sql`
      CREATE TABLE IF NOT EXISTS performances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_name TEXT,
        kind TEXT,
        payload TEXT,
        created_at INTEGER
      )
    `;
    // Deadlines served by the DO's single alarm (see armAlarm): idle agent
    // presence and the idle version snapshot. A row per task, not a timer
    // per task, because a pending setTimeout pins the DO in memory.
    this.sql`
      CREATE TABLE IF NOT EXISTS schedule (
        key TEXT PRIMARY KEY,
        due INTEGER
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        payload TEXT,
        created_at INTEGER
      )
    `;
    // Attachment metadata only; the bytes live in R2 under <docId>/<id>.
    this.sql`
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        filename TEXT,
        content_type TEXT,
        bytes INTEGER,
        uploader TEXT,
        uploader_name TEXT,
        created_at INTEGER,
        state TEXT
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER,
        reason TEXT,
        author TEXT,
        contributors TEXT,
        markdown TEXT,
        bytes INTEGER,
        restored_from INTEGER
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        principal TEXT,
        agent_name TEXT,
        url TEXT,
        secret TEXT,
        name TEXT,
        arguments TEXT,
        expires_at INTEGER,
        failing_since INTEGER,
        active INTEGER,
        created_at INTEGER
      )
    `;

    // Load persisted state
    const rows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'state'
    `;

    if (rows.length > 0 && rows[0].value) {
      const state = new Uint8Array(rows[0].value);
      Y.applyUpdate(this.doc, state);
    }

    // Persist on a quiet edge, not per update: a typing burst is one write
    // instead of hundreds (rows-written quota, full-state encode CPU, and
    // the pending timer only pins the DO for the debounce window). The
    // ≤1s crash-loss window is healed on reconnect by any client's state
    // vector sync. Explicit flushes: last connection closing, and document
    // creation (so a freshly imported doc survives immediate eviction).
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.schedulePersist();
      this.dirtySinceSnapshot = true;
      // System writes (import, restore) record their own versions and
      // creation is not an edit; only a live edit books the idle snapshot.
      if (origin !== "agent" && !this.creating) this.scheduleIdleSnapshot();
      // Agent edits are credited when dispatched (see dispatchMutation);
      // human edits are traced back to their clients' awareness here.
      if (!isAgentOrigin(origin)) this.noteContributors(update);

      // Agent-originated mutations (doc.transact(fn, agentOrigin(name))) never pass
      // through onMessage's relay — they mutate this DO's Y.Doc directly —
      // so without this, connected browsers never see them until their next
      // reconnect replays full state. Human-origin updates are already
      // relayed by onMessage's broadcastBinary of the raw incoming sync
      // message, so broadcasting them again here would double-send.
      if (isAgentOrigin(origin)) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        this.broadcastToAll(encoding.toUint8Array(encoder));
      }
    });

    // Eviction recovery: a row still in `performances` means the DO was
    // evicted before that mutation ever touched the doc — the row is
    // deleted the instant a performance's first write lands (see
    // performTypedInsert/performTypedSuggest), so anything still here was
    // never applied at all. Apply each leftover mutation instantly, in the
    // order it was queued, and drop the row.
    const leftover = this.sql<PerformanceRow>`
      SELECT * FROM performances ORDER BY id ASC
    `;
    // A poisoned row (unparseable payload, or one whose application throws)
    // must not take the rest of initialisation down with it: the observers
    // below would never be registered, permanently disabling mentions and
    // events, and the surviving row would later collide with a
    // nextPerformanceId that restarts at 1. Log it and drop it.
    for (const row of leftover) {
      try {
        const mutation = JSON.parse(row.payload) as MutationPayload;
        this.applyMutation(mutation, row.agent_name);
      } catch (err) {
        console.error(`Dropping unrecoverable performance row ${row.id}:`, err);
      }
      this.sql`DELETE FROM performances WHERE id = ${row.id}`;
    }

    // Mention detection + doc_changed digests for human edits and for agent
    // edits alike. Agent RPCs tag their transactions with the acting agent
    // (see applyMutation/performTypedInsert/performTypedSuggest); the events
    // they produce carry that `actor`, and an agent's poll drops its own, so
    // it never gets a "mention" for text it typed itself. System writes
    // (the bare "agent" origin: import, restore) fire nothing.
    const frag = this.doc.getXmlFragment("default");
    frag.observeDeep((events, transaction) => {
      if (transaction.origin === "agent") return;
      const actor = agentActor(transaction.origin);

      // No agents on the roster means nothing consumes events — not
      // mentions, and not doc_changed digests either. Check first, so an
      // agentless document accrues no `events` rows at all.
      const rosterNames = this.getRosterTargetsSync();
      if (rosterNames.length === 0) return;

      // One digest window per actor: an agent's typing burst is one event
      // to the others, and never eats the window meant for human edits.
      const now = Date.now();
      const digestKey = actor ?? "";
      if (now - (this.lastDigestAt.get(digestKey) ?? 0) >= 30_000) {
        this.lastDigestAt.set(digestKey, now);
        this.recordEvent("doc_changed", actor ? { actor } : {});
      }

      // Scan each touched block's *full* text, not the individual delta ops:
      // a human typing "@scribe" delivers one op per keystroke, and no single
      // character ever matches the mention pattern. Only pasting did.
      //
      // Which block was touched depends on how the edit arrived. Typing into
      // an existing text node is a text event on that node. A batch of
      // keystrokes into a fresh paragraph reaches the server as one update
      // whose net effect is "text node inserted into the paragraph": an
      // element event, with no text event at all. A paste or an upload is a
      // fragment event listing the inserted blocks. All three must scan.
      const blocks = new Set<Y.AbstractType<unknown>>();
      for (const event of events) {
        const target = event.target;
        if (target === frag) {
          for (const item of event.changes.added) {
            const content = item.content;
            if (content instanceof Y.ContentType) blocks.add(content.type);
          }
          continue;
        }
        const block = this.topLevelBlockOf(target);
        if (block) blocks.add(block);
      }
      for (const block of blocks) {
        const text = this.blockText(block);
        if (text === null) continue; // block already gone from the fragment
        this.notifyMentions(block, text, rosterNames, actor);
      }
    });

    // Human replies to an agent-authored thread: notify that agent. Only
    // fires when a reply was actually *added* — compares the previous
    // replies.length (from event.changes.keys' oldValue, the prior raw
    // JSON) against the new one, so a resolve toggle or any other edit to
    // an already-replied-to thread doesn't re-fire the notification.
    const threadsMap = this.doc.getMap<string>("threads");
    threadsMap.observe((event, transaction) => {
      if (transaction.origin === "agent") return;
      const actor = agentActor(transaction.origin);
      const tagged = actor ? { actor } : {};

      const rosterNames = this.getRosterTargetsSync();
      if (rosterNames.length === 0) return;

      for (const key of event.keysChanged) {
        const raw = threadsMap.get(key);
        if (!raw) continue;
        let thread: ThreadData;
        try {
          thread = JSON.parse(raw) as ThreadData;
        } catch {
          continue;
        }
        const change = event.changes.keys.get(key);
        if (!change || change.action !== "update") continue; // "add" = brand-new thread, not a reply
        let previousReplyCount = 0;
        try {
          const previous = JSON.parse(change.oldValue) as ThreadData;
          previousReplyCount = previous.replies.length;
        } catch {
          continue;
        }
        if (thread.replies.length <= previousReplyCount) continue;

        const lastReply = thread.replies[thread.replies.length - 1];
        if (!lastReply) continue;

        // A reply lives only in the threads map, so the body scan never
        // sees it: `@agent` inside a reply is notified from here. The
        // thread's own author is covered by thread_reply below.
        for (const name of findMentions(lastReply.text ?? "", rosterNames)) {
          if (name === actor || name === lastReply.author?.name || name === thread.author?.name) continue;
          this.recordEvent("mention", { agent: name, text: lastReply.text, threadId: thread.id, ...tagged });
        }

        if (!rosterNames.some((target) => target.name === thread.author?.name)) continue;
        if (lastReply.author?.name === thread.author.name || actor === thread.author.name) continue;
        this.recordEvent("thread_reply", { agent: thread.author.name, threadId: thread.id, ...tagged });
      }
    });

    return { doc: this.doc, awareness: this.awareness };
  }

  async onConnect(connection: Connection, _ctx: ConnectionContext) {
    const { doc, awareness } = this.ensureInitialised();

    // Send SyncStep1 to the new client
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    connection.send(encoding.toUint8Array(syncEncoder));

    // Send SyncStep2 (full state) to the new client
    const stateEncoder = encoding.createEncoder();
    encoding.writeVarUint(stateEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(stateEncoder, doc);
    connection.send(encoding.toUint8Array(stateEncoder));

    // Send current awareness states to the new client
    const awarenessStates = awareness.getStates();
    if (awarenessStates.size > 0) {
      const clients = Array.from(awarenessStates.keys());
      const update = awarenessProtocol.encodeAwarenessUpdate(awareness, clients);
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(awarenessEncoder, update);
      connection.send(encoding.toUint8Array(awarenessEncoder));
    }

    // Replay current agent presence so a late joiner sees resident agents.
    for (const presence of this.agentPresence.values()) {
      if (presence.state) {
        connection.send(encodeAgentAwareness(presence.clientId, presence.clock, presence.state));
      }
    }
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message === "string") {
      this.handleControlMessage(connection, message);
      return;
    }

    const { doc, awareness } = this.ensureInitialised();

    const data =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            (message as Uint8Array).buffer,
            (message as Uint8Array).byteOffset,
            (message as Uint8Array).byteLength,
          );
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, null);

        // If there's a response (e.g. SyncStep2 reply), send it back
        if (encoding.length(encoder) > 1) {
          connection.send(encoding.toUint8Array(encoder));
        }

        // Broadcast the raw message to all other clients
        this.broadcastBinary(message, connection.id);
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, connection);
        this.pruneOutdatedAwareness(awareness);

        // Broadcast awareness to all other clients
        this.broadcastBinary(message, connection.id);
        break;
      }
    }
  }

  async onClose(
    connection: Connection,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    if (this.awareness) {
      // Remove this client's awareness state
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        // Agents SDK uses string IDs; awareness protocol expects numbers.
      // The protocol converts via toString() internally, so this is safe.
      [connection.id as unknown as number],
        null,
      );
    }

    this.connectionClients.delete(connection.id);

    // Last human gone: flush any pending persistence and drop every
    // standing timer so nothing keeps the DO pinned in memory — agent
    // presence only matters while someone is watching, and it rebuilds
    // from the roster on the next performance anyway. The pending idle
    // version is taken now rather than left to a timer that would pin the
    // DO (or be lost to eviction).
    if (!this.hasHumanConnections()) {
      this.flushDocState();
      this.maybeSnapshot("idle");
      this.clearSchedule();
      this.agentPresence.clear();
    }
  }

  /**
   * What y-protocols' Awareness does on its 3-second interval, done on
   * traffic instead: forget remote states no heartbeat has refreshed in
   * `outdatedTimeout`. Clients prune their own view the same way, so no
   * broadcast is needed.
   */
  private pruneOutdatedAwareness(awareness: awarenessProtocol.Awareness): void {
    const now = Date.now();
    const stale: number[] = [];
    awareness.meta.forEach((meta, clientId) => {
      if (clientId === awareness.clientID) return;
      if (awarenessProtocol.outdatedTimeout <= now - meta.lastUpdated && awareness.states.has(clientId)) {
        stale.push(clientId);
      }
    });
    if (stale.length > 0) awarenessProtocol.removeAwarenessStates(awareness, stale, "timeout");
  }

  /* ---- Scheduled tasks on the single DO alarm ---- */

  /**
   * Arms the alarm for the earliest of the scheduled tasks and the
   * document's expiry. The alarm is the one timer that survives
   * hibernation, so everything that used to be a setTimeout longer than
   * the persistence debounce goes through here.
   */
  private async armAlarm(): Promise<void> {
    const rows = this.sql<{ due: number }>`SELECT due FROM schedule ORDER BY due ASC`;
    const expiry = this.docExpiresAt();
    const next = rows.length > 0 ? Math.min(rows[0].due, expiry) : expiry;
    await this.ctx.storage.setAlarm(next);
  }

  /** Schedules (or moves) a task; a move of under SCHEDULE_JITTER_MS is skipped as noise. */
  private scheduleTask(key: string, due: number): void {
    const current = this.scheduledDue.get(key);
    if (current !== undefined && Math.abs(current - due) < SCHEDULE_JITTER_MS) return;
    this.sql`DELETE FROM schedule WHERE key = ${key}`;
    this.sql`INSERT INTO schedule (key, due) VALUES (${key}, ${due})`;
    this.scheduledDue.set(key, due);
    void this.armAlarm().catch((err: unknown) => console.error("alarm arm failed:", err));
  }

  /** Forgets a task. The alarm is left as is: firing early is harmless (nothing due, re-armed). */
  private unscheduleTask(key: string): void {
    if (!this.scheduledDue.has(key)) {
      const rows = this.sql<{ key: string }>`SELECT key FROM schedule WHERE key = ${key}`;
      if (rows.length === 0) return;
    }
    this.sql`DELETE FROM schedule WHERE key = ${key}`;
    this.scheduledDue.delete(key);
  }

  private clearSchedule(): void {
    this.sql`DELETE FROM schedule`;
    this.scheduledDue.clear();
  }

  /** Runs one due task. Unknown keys are dropped silently: they belong to a newer or older build. */
  private runScheduledTask(key: string): void {
    if (key.startsWith(IDLE_TASK_PREFIX)) {
      this.setAgentPresence(key.slice(IDLE_TASK_PREFIX.length), null);
    } else if (key === SNAPSHOT_TASK) {
      this.maybeSnapshot("idle");
    } else if (key === EXPIRING_TASK) {
      if (this.docExists()) {
        this.recordEvent("doc_expiring", { expires_at: new Date(this.docExpiresAt()).toISOString() });
      }
    }
  }

  /**
   * Books document.expiring for EXPIRING_LEAD_MS before deletion, once. Called
   * at creation and whenever an agent enrolls, so documents from before the
   * event existed pick it up on their next agent visit (#83).
   */
  private ensureExpiringTask(): void {
    if (this.scheduledDue.has(EXPIRING_TASK)) return;
    const due = this.docExpiresAt() - EXPIRING_LEAD_MS;
    if (due <= Date.now()) return;
    const rows = this.sql<{ key: string }>`SELECT key FROM schedule WHERE key = ${EXPIRING_TASK}`;
    if (rows.length > 0) {
      this.scheduledDue.set(EXPIRING_TASK, due);
      return;
    }
    this.scheduleTask(EXPIRING_TASK, due);
  }

  /** The Registry, when this agent runs with its bindings (tests may not). */
  private registryStub(): Promise<Registry> | null {
    const binding = (this as unknown as { env?: Env }).env?.Registry;
    if (!binding) return null;
    return getAgentByName(binding, "global") as unknown as Promise<Registry>;
  }

  /**
   * What a listing needs to know about this document without reading it
   * all: whether it exists, its title, and its lifetime. Used by
   * create_document's result and list_documents (#83, #84).
   */
  async documentSummary(): Promise<{
    exists: boolean;
    title: string | null;
    createdAt: string | null;
    expiresAt: string | null;
  }> {
    const { doc } = this.ensureInitialised();
    if (!this.docExists()) return { exists: false, title: null, createdAt: null, expiresAt: null };
    const expiresAt = this.docExpiresAt();
    return {
      exists: true,
      title: titleFromMarkdown(yDocToMarkdown(doc)),
      createdAt: new Date(expiresAt - DOCUMENT_TTL_MS).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  override readonly alarm = async (): Promise<void> => {
    this.ensureInitialised();
    const now = Date.now();

    // Housekeeping first: whatever scheduled tasks are due (idle agent
    // presence, the idle version snapshot), then either re-arm for the
    // next deadline or, if the document's life is up, expire it below.
    const tasks = this.sql<{ key: string; due: number }>`SELECT key, due FROM schedule ORDER BY due ASC`;
    for (const task of tasks) {
      if (task.due > now + ALARM_SLACK_MS) break;
      this.sql`DELETE FROM schedule WHERE key = ${task.key}`;
      this.scheduledDue.delete(task.key);
      try {
        this.runScheduledTask(task.key);
      } catch (err) {
        console.error(`Scheduled task ${task.key} failed:`, err);
      }
    }
    if (!this.docExists()) return; // nothing to expire, and nothing to wake for
    if (now < this.docExpiresAt() - ALARM_SLACK_MS) {
      await this.armAlarm();
      return;
    }

    // A pending persist must not resurrect state after the delete below.
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    // Auto-delete: remove all document data
    this.sql`DELETE FROM doc_state`;
    // The roster dies with the document — an enrollment must not persist
    // against whatever content lands at this doc id if it's recreated
    // after expiry. Signed-in agents' document lists forget it too (#84).
    const enrolled = this.sql<{ identity_id: string }>`SELECT identity_id FROM roster WHERE owner IS NOT NULL`;
    const registry = this.registryStub();
    if (registry && enrolled.length > 0) {
      const forget = registry
        .then((r) => Promise.all(enrolled.map((row) => r.removeEnrollment(row.identity_id, this.name))))
        .catch((err: unknown) => console.error("enrollment cleanup failed:", err));
      const ctx = (this as unknown as { ctx?: { waitUntil?: (p: Promise<unknown>) => void } }).ctx;
      if (ctx?.waitUntil) ctx.waitUntil(forget);
    }
    this.sql`DELETE FROM roster`;
    // Any queued performances belong to a document that no longer exists.
    this.sql`DELETE FROM performances`;
    this.performanceQueue = [];
    this.isPerforming = false;
    // Recorded events (mentions, thread replies, doc_changed digests) are
    // meaningless once the document they refer to is gone.
    this.sql`DELETE FROM events`;
    // Webhook subscriptions die with the document.
    this.sql`DELETE FROM subscriptions`;
    // So does its version history.
    this.sql`DELETE FROM versions`;
    // And every deadline that was waiting on this alarm.
    this.clearSchedule();
    this.contributorsSinceSnapshot.clear();
    this.connectionClients.clear();
    this.dirtySinceSnapshot = false;
    // Attachments: the objects in R2, then their rows. A lifecycle rule on
    // the bucket backstops a DO whose alarm never runs.
    await this.deleteAttachmentObjects();
    this.sql`DELETE FROM attachments`;
    for (const finish of this.eventWaiters) finish();
    this.eventWaiters = [];
    // Agent presence belongs to a document that no longer exists.
    this.agentPresence.clear();
    // Close all active WebSocket connections
    for (const conn of this.getConnections()) {
      conn.close(1000, "Document expired");
    }
    // Clean up in-memory state
    this.doc?.destroy();
    this.doc = null;
    this.awareness = null;
  };

  async onRequest(request: Request) {
    // /versions… under this document's path; null for the bare create/exists routes.
    const versionResponse = await handleVersionRequest(request, this.versionStub());
    if (versionResponse) return versionResponse;

    if (request.method === "POST") {
      // Create / initialise the document
      const { doc } = this.ensureInitialised();
      this.creating = true;
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('exists', ${sqlBlob(new Uint8Array([1]))})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;

      // Stamp doc format version in Yjs metadata
      const meta = doc.getMap<number>("meta");
      if (!meta.has("version")) {
        meta.set("version", DOC_FORMAT_VERSION);
      }

      // Store creation timestamp and set auto-delete alarm
      const now = Date.now();
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('createdAt', ${sqlBlob(new Uint8Array(new Float64Array([now]).buffer))})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
      await this.ctx.storage.setAlarm(now + DOCUMENT_TTL_MS);
      this.scheduleTask(EXPIRING_TASK, now + DOCUMENT_TTL_MS - EXPIRING_LEAD_MS);

      // If the request has a JSON body with content, populate the Yjs doc
      const contentType = request.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        try {
          const body = await request.json() as { content?: string; threads?: unknown[] };

          // Parse before the transaction: Yjs cannot roll back, and a parse
          // failure must not commit a half-imported document.
          let importNodes: Y.XmlElement[] | null = null;
          if (body.content) {
            const built = buildMarkdownBlocks(body.content);
            if (!built.ok) {
              return new Response(JSON.stringify({ ok: false, error: built.message }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              });
            }
            importNodes = built.nodes;
          }

          // Tagged "agent" (system import, not a live edit) so it doesn't
          // register as a human edit for mention/doc_changed/thread_reply
          // detection — see the frag/threads observers in ensureInitialised.
          doc.transact(() => {
            if (importNodes) {
              const frag = doc.getXmlFragment("default");
              if (frag.length === 0) {
                frag.insert(0, importNodes);
              }
            }
            if (body.threads && Array.isArray(body.threads)) {
              const threadsMap = doc.getMap<string>("threads");
              for (const thread of body.threads) {
                const t = thread as { id?: string };
                if (t.id) {
                  threadsMap.set(t.id, JSON.stringify(thread));
                }
              }
            }
          }, "agent");
        } catch {
          // Ignore malformed JSON — document is still created
        }
      }

      // Persist immediately: a freshly created document must survive an
      // eviction that lands inside the debounce window. Creation is not an
      // edit: the trail starts with the first change, not with the import.
      this.dirtySinceSnapshot = false;
      this.contributorsSinceSnapshot.clear();
      this.creating = false;
      this.flushDocState();

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET") {
      // Check whether this document exists
      this.ensureInitialised();
      const exists = this.docExists();

      const createdAtRows = this.sql<{ value: ArrayBuffer }>`
        SELECT value FROM doc_state WHERE key = 'createdAt'
      `;
      const createdAt =
        createdAtRows.length > 0
          ? new Float64Array(createdAtRows[0].value)[0]
          : null;

      // The title and first paragraph, for the page's <title>, its link
      // preview, and the slug in its URL (app/shared/doc-url.ts).
      let title: string | null = null;
      let description: string | null = null;
      if (exists && this.doc) {
        const markdown = yDocToMarkdown(this.doc);
        title = titleFromMarkdown(markdown);
        description = descriptionFromMarkdown(markdown);
      }

      return new Response(JSON.stringify({ exists, createdAt, title, description }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  /** Whether this document has been created (POSTed to) yet. */
  private docExists(): boolean {
    const rows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'exists'
    `;
    return rows.length > 0;
  }

  /**
   * Finds or creates this identity's roster entry. Rows are keyed by the
   * verified identity id (a principal or an anonymous session id), so
   * enrollment is idempotent per identity. The requested name gets a
   * `-2`, `-3`, … suffix when a DIFFERENT identity already holds it.
   * Capabilities on the row mirror the latest grant (they are display
   * data — authorisation always checks the verified identity itself).
   */
  private ensureRosterEntry(
    identity: AgentIdentity,
  ): { entry: AgentRosterEntry } | { error: AgentError } {
    this.ensureInitialised();

    if (!this.docExists()) {
      return { error: { code: "doc_not_found", message: "Document does not exist" } };
    }

    const existing = this.sql<RosterRow>`
      SELECT * FROM roster WHERE identity_id = ${identity.id}
    `;
    if (existing.length > 0) {
      const row = existing[0];
      const caps = JSON.stringify(identity.caps);
      if (row.capabilities !== caps) {
        this.sql`UPDATE roster SET capabilities = ${caps} WHERE identity_id = ${identity.id}`;
        row.capabilities = caps;
      }
      const label = identity.label ?? null;
      if (label !== null && (row.label ?? null) !== label) {
        this.sql`UPDATE roster SET label = ${label} WHERE identity_id = ${identity.id}`;
        row.label = label;
      }
      // Identity details can change between sessions (a rename, another
      // client) and rows from before these columns existed have none.
      const mention = mentionForIdentity(identity, row.name);
      const ownerUid = identity.ownerUid ?? null;
      const client = identity.client ?? null;
      if ((row.mention ?? null) !== mention || (row.owner_uid ?? null) !== ownerUid || (row.client ?? null) !== client) {
        this.sql`UPDATE roster SET mention = ${mention}, owner_uid = ${ownerUid}, client = ${client} WHERE identity_id = ${identity.id}`;
        row.mention = mention;
        row.owner_uid = ownerUid;
        row.client = client;
      }
      return { entry: rowToRosterEntry(row) };
    }

    const roster = this.sql<{ name: string }>`SELECT name FROM roster`;
    // A document is a public, unauthenticated URL: without a ceiling,
    // anything that can reach it could grow the roster without bound.
    if (roster.length >= MAX_AGENTS_PER_DOC) {
      return {
        error: {
          code: "rate_limited",
          message: `This document already has the maximum of ${MAX_AGENTS_PER_DOC} agents. Revoke one first.`,
        },
      };
    }

    const base = AGENT_NAME_RE.test(identity.name) ? identity.name : "agent";
    const taken = new Set(roster.map((r) => r.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) {
      const suffix = `-${n}`;
      name = base.length + suffix.length > 32
        ? `${base.slice(0, 32 - suffix.length).replace(/-+$/, "")}${suffix}`
        : `${base}${suffix}`;
    }

    // A counterpart draws in its owner's colour, the same one the owner
    // gets in every document; anonymous agents rotate through the palette.
    const color = identity.ownerUid
      ? USER_COLOURS[colorIndexFor(identity.ownerUid, USER_COLOURS.length)].color
      : USER_COLOURS[roster.length % USER_COLOURS.length].color;
    const mention = mentionForIdentity(identity, name);
    const ownerUid = identity.ownerUid ?? null;
    const client = identity.client ?? null;
    const createdAt = Date.now();
    this.sql`
      INSERT INTO roster (identity_id, name, label, color, owner, capabilities, created_at, last_seen_at, mention, owner_uid, client)
      VALUES (${identity.id}, ${name}, ${identity.label ?? null}, ${color}, ${identity.owner}, ${JSON.stringify(identity.caps)}, ${createdAt}, ${null}, ${mention}, ${ownerUid}, ${client})
    `;
    // A signed-in agent's documents are listable (#84); the expiring event is
    // booked now so this document warns its agents before it goes (#83).
    if (identity.kind === "principal") {
      const registry = this.registryStub();
      if (registry) {
        void registry
          .then((r) => r.addEnrollment(identity.id, this.name))
          .catch((err: unknown) => console.error("enrollment record failed:", err));
      }
    }
    this.ensureExpiringTask();
    return {
      entry: {
        name,
        label: identity.label ?? null,
        color,
        ownerUid,
        client,
        mention,
        capabilities: identity.caps,
        createdAt,
        lastSeenAt: null,
      },
    };
  }

  /** Lists all agents minted for this document, oldest first. */
  async getAgentRoster(): Promise<AgentRosterEntry[]> {
    this.ensureInitialised();
    const rows = this.sql<RosterRow>`
      SELECT * FROM roster ORDER BY created_at ASC
    `;
    return rows.map(rowToRosterEntry);
  }

  /**
   * Synchronous roster-name lookup for use inside Yjs observer callbacks
   * (which cannot await getAgentRoster's async signature, even though its
   * body is itself fully synchronous SQL access).
   */
  private getRosterTargetsSync(): MentionTarget[] {
    const rows = this.sql<{ name: string; mention: string | null }>`SELECT name, mention FROM roster`;
    return rows.map((r) => ({ name: r.name, mention: r.mention }));
  }

  /**
   * Finds the markdown text (via getBlocks) of the block containing a given
   * Y.XmlText node, for attaching context to a mention event. Returns null
   * if the node isn't a direct child of a top-level block element (e.g. it
   * was already removed from the fragment by a later concurrent edit).
   */
  /**
   * The top-level block (direct child of the fragment) containing a Yjs
   * node. Rich blocks (lists, quotes) nest text several elements deep, so
   * climb; null when the node is no longer attached.
   */
  private topLevelBlockOf(node: Y.AbstractType<unknown>): Y.AbstractType<unknown> | null {
    if (!this.doc) return null;
    const frag = this.doc.getXmlFragment("default");
    let current: Y.AbstractType<unknown> | null = node;
    while (current && current.parent !== frag) {
      current = current.parent;
    }
    return current;
  }

  /** The plain text of a top-level block, or null if it left the fragment. */
  private blockText(block: Y.AbstractType<unknown>): string | null {
    if (!this.doc) return null;
    const frag = this.doc.getXmlFragment("default");
    const index = frag.toArray().indexOf(block as Y.XmlElement | Y.XmlText);
    if (index === -1) return null;
    return getBlocks(this.doc)[index]?.text ?? null;
  }

  /**
   * Records a "mention" event for every roster agent named in a block's text
   * that hasn't already been notified about this block.
   *
   * De-duplication is per (top-level block, agent name), because the scan
   * runs over the block's whole text on every keystroke in it — without this,
   * "@scribe, could you..." would fire a fresh mention for every character
   * typed after the name. A name is forgotten again as soon as it is no
   * longer present in the block, so deleting the mention and retyping it
   * notifies properly rather than being swallowed. The map is keyed weakly by
   * the live Yjs block, so it needs no explicit clearing: entries go away
   * with the blocks (and with the whole document on expiry).
   */
  private notifyMentions(
    block: Y.AbstractType<unknown>,
    text: string,
    rosterNames: MentionTarget[],
    actor: string | null,
  ): void {
    const mentioned = new Set(findMentions(text, rosterNames));
    // An agent writing its own name is not mentioning itself.
    if (actor) mentioned.delete(actor);

    let notified = this.notifiedMentions.get(block);
    if (!notified) {
      notified = new Set<string>();
      this.notifiedMentions.set(block, notified);
    }

    for (const name of notified) {
      if (!mentioned.has(name)) notified.delete(name);
    }

    for (const name of mentioned) {
      if (notified.has(name)) continue;
      notified.add(name);
      this.recordEvent("mention", { agent: name, text, ...(actor ? { actor } : {}) });
    }
  }

  /**
   * Inserts a row into `events` and wakes every agentAwaitEvents long-poll
   * currently parked with nothing to return — each re-queries past its own
   * cursor once woken, so no event data needs to travel through the
   * resolver itself.
   */
  private recordEvent(type: string, payload: unknown): void {
    this.ensureInitialised();
    this.sql`
      INSERT INTO events (type, payload, created_at) VALUES (${type}, ${JSON.stringify(payload)}, ${Date.now()})
    `;
    // ORDER BY + last element rather than MAX(): behaves identically on
    // real SQLite and stays within what the test harness's SQL fake parses.
    const seqRows = this.sql<{ seq: number }>`
      SELECT seq FROM events ORDER BY seq ASC
    `;
    const seq = seqRows.length ? seqRows[seqRows.length - 1].seq : 0;
    this.dispatchWebhooks(seq, type, payload);
    this.dispatchWake(seq, type, payload);
    const waiters = this.eventWaiters;
    this.eventWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /**
   * Long-polls for events past `cursor` (default 0, i.e. everything).
   * Returns immediately if any exist; otherwise parks until either
   * recordEvent flushes it or `timeoutMs` (capped at 15s) elapses, then
   * returns whatever is available at that point (possibly still empty —
   * then with a `retryAfterMs` pacing hint). Only a valid token is
   * required — read is implied.
   */
  async agentAwaitEvents(
    identity: AgentIdentity,
    args: { cursor?: number; timeoutMs?: number },
  ): Promise<
    | { events: { seq: number; type: DocEventType; payload: unknown }[]; cursor: number; retryAfterMs?: number }
    | { error: AgentError }
  > {
    const verified = await this.verifyIdentity(identity);
    if ("error" in verified) return verified;

    const cursor = args.cursor ?? 0;
    const self = verified.entry.name;

    /**
     * Reads events past the cursor, keeping only those addressed to this
     * agent. "mention" and "thread_reply" name their target agent in the
     * payload and are nobody else's business; "doc_changed" is a broadcast
     * digest and goes to everyone except the agent whose edit it digests
     * (`payload.actor`, set when an agent rather than a person made it).
     *
     * `lastSeq` is the highest row *scanned*, not the highest returned, so an
     * agent's cursor still advances past events filtered out for it — it
     * never re-scans another agent's notifications.
     */
    const readPast = (): {
      events: { seq: number; type: DocEventType; payload: unknown }[];
      lastSeq: number;
    } => {
      const rows = this.sql<EventRow>`
        SELECT * FROM events WHERE seq > ${cursor} ORDER BY seq ASC
      `;
      const out: { seq: number; type: DocEventType; payload: unknown }[] = [];
      let lastSeq = cursor;
      for (const row of rows) {
        lastSeq = Math.max(lastSeq, row.seq);
        let payload: unknown;
        try {
          payload = JSON.parse(row.payload) as unknown;
        } catch {
          console.warn(`Skipping unparseable event ${row.seq}`);
          continue;
        }
        const type = row.type as DocEventType;
        const data = payload as { agent?: string; actor?: string };
        // Never an agent's own doing (its edits, its comments), and
        // addressed events only to their addressee.
        if (data.actor === self) continue;
        if (type === "mention" || type === "thread_reply") {
          if (data.agent !== self) continue;
        }
        out.push({ seq: row.seq, type, payload });
      }
      return { events: out, lastSeq };
    };

    let { events, lastSeq } = readPast();
    if (events.length === 0) {
      // Capped at 15s: an in-flight RPC pins this Durable Object in memory
      // for its whole duration, and every idle long-polling agent used to
      // be a full-time pinned DO (see the sleeping-tabs plan). The
      // retryAfterMs hint below asks quiet agents to poll on a cadence.
      const timeoutMs = Math.min(args.timeoutMs ?? 15_000, 15_000);
      await new Promise<void>((resolve) => {
        const finish = () => {
          this.eventWaiters = this.eventWaiters.filter((w) => w !== finish);
          clearTimeout(timer);
          resolve();
        };
        this.eventWaiters.push(finish);
        const timer = setTimeout(finish, timeoutMs);
      });
      ({ events, lastSeq } = readPast());
    }

    if (events.length === 0) {
      return { events, cursor: lastSeq, retryAfterMs: 30_000 };
    }
    return { events, cursor: lastSeq };
  }

  /* ================================================================ */
  /*  MCP Events polyfill (draft Triggers & Events extension)          */
  /*  docs/plans/2026-08-31-mcp-events-polyfill-plan.md                */
  /* ================================================================ */

  /** When this document's auto-delete alarm fires (TTL grants cap here). */
  private docExpiresAt(): number {
    const rows = this.sql<{ value: ArrayBuffer | Uint8Array }>`
      SELECT value FROM doc_state WHERE key = 'createdAt'
    `;
    if (rows.length === 0) return Date.now() + DOCUMENT_TTL_MS;
    const v = rows[0].value;
    const bytes = v instanceof Uint8Array ? v : new Uint8Array(v);
    const createdAt = new Float64Array(bytes.buffer, bytes.byteOffset, 1)[0];
    return createdAt + DOCUMENT_TTL_MS;
  }

  /** The sketch's `events/list`: the event-type catalog. */
  async eventsList(identity: AgentIdentity): Promise<
    | { events: ReturnType<typeof eventCatalog> }
    | { error: AgentError }
  > {
    const verified = await this.verifyIdentity(identity);
    if ("error" in verified) return verified;
    return { events: eventCatalog() };
  }

  /**
   * The sketch's `events/poll`: request/response, no long hold (the hold
   * lives in the deprecated agentAwaitEvents; polling here is meant to be
   * cheap and paced by nextPollMs).
   */
  async eventsPoll(
    identity: AgentIdentity,
    args: { name: string; cursor?: string | null; maxEvents?: number },
  ): Promise<
    | {
        events: EventOccurrence[];
        cursor: string | null;
        truncated: boolean;
        hasMore: boolean;
        nextPollMs: number;
        retryAfterMs?: number;
      }
    | { error: AgentError }
  > {
    const verified = await this.verifyIdentity(identity);
    if ("error" in verified) return verified;

    const type = eventTypeByName(args.name);
    if (!type) {
      return { error: { code: "not_found", message: `Unknown event type: ${args.name}` } };
    }
    const since = decodeCursor(args.cursor);
    if (since === null) {
      return { error: { code: "invalid_params", message: `Unparseable cursor: ${args.cursor}` } };
    }
    const maxEvents = Math.min(Math.max(args.maxEvents ?? 50, 1), 200);
    const self = verified.entry.name;

    const rows = this.sql<EventRow>`
      SELECT * FROM events WHERE seq > ${since} ORDER BY seq ASC
    `;
    const out: EventOccurrence[] = [];
    let lastSeq = since;
    let hasMore = false;
    for (const row of rows) {
      if (out.length >= maxEvents) {
        hasMore = true;
        break;
      }
      lastSeq = Math.max(lastSeq, row.seq);
      if (row.type !== type.internalType) continue;
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload) as unknown;
      } catch {
        continue;
      }
      const data = payload as { agent?: string; actor?: string };
      if (data.actor === self) continue; // its own edit or comment
      if (type.addressed && data.agent !== self) continue;
      const occurrence = buildOccurrence({
        docId: this.name,
        seq: row.seq,
        internalType: row.type,
        payload,
        createdAt: row.created_at,
      });
      if (occurrence) out.push(occurrence);
    }

    return {
      events: out,
      cursor: encodeCursor(lastSeq),
      truncated: false,
      hasMore,
      nextPollMs: POLL_RETRY_AFTER_MS,
      ...(out.length === 0 ? { retryAfterMs: POLL_RETRY_AFTER_MS } : {}),
    };
  }

  /**
   * The sketch's `events/subscribe` (webhook mode only): idempotent upsert
   * keyed on (principal, url, name, arguments); re-subscribing refreshes
   * the TTL and reactivates a suspended subscription. Requires an
   * authenticated principal — the sketch forbids webhook mode on
   * unauthenticated callers, and it also keeps the dispatcher from being
   * an anonymous "make this server POST anywhere" primitive.
   */
  async eventsSubscribe(
    identity: AgentIdentity,
    args: { name: string; url: string; secret: string; ttlMs?: number | null },
  ): Promise<
    | { id: string; refreshBefore: string; cursor: string; truncated: boolean }
    | { error: AgentError }
  > {
    const verified = await this.verifyIdentity(identity);
    if ("error" in verified) return verified;

    if (identity.kind !== "principal") {
      return {
        error: {
          code: "capability_denied",
          message: "Webhook subscriptions require the signed-in /mcp endpoint; anonymous agents may poll.",
        },
      };
    }
    if (!eventTypeByName(args.name)) {
      return { error: { code: "not_found", message: `Unknown event type: ${args.name}` } };
    }
    const urlError = webhookUrlError(args.url);
    if (urlError) {
      return { error: { code: "invalid_params", message: urlError } };
    }
    if (!isValidWebhookSecret(args.secret)) {
      return {
        error: {
          code: "invalid_params",
          message: "delivery.secret must be whsec_ + base64 of 24-64 random bytes",
        },
      };
    }

    const now = Date.now();
    const argumentsJson = JSON.stringify({ doc_id: this.name });
    const id = await subscriptionId(identity.id, args.url, args.name, argumentsJson);
    const ttl = grantTtlMs(args.ttlMs, this.docExpiresAt(), now);
    const expiresAt = now + ttl;

    // Idempotent upsert as delete+insert: a refresh replaces the secret,
    // re-grants the TTL, clears the failure clock, and reactivates.
    this.sql`DELETE FROM subscriptions WHERE id = ${id}`;
    this.sql`
      INSERT INTO subscriptions (id, principal, agent_name, url, secret, name, arguments, expires_at, failing_since, active, created_at)
      VALUES (${id}, ${identity.id}, ${verified.entry.name}, ${args.url}, ${args.secret}, ${args.name}, ${argumentsJson}, ${expiresAt}, ${null}, ${1}, ${now})
    `;

    const seqRows = this.sql<{ seq: number }>`
      SELECT seq FROM events ORDER BY seq ASC
    `;
    const watermark = encodeCursor(seqRows.length ? seqRows[seqRows.length - 1].seq : 0);

    return { id, refreshBefore: new Date(expiresAt).toISOString(), cursor: watermark, truncated: false };
  }

  /** The sketch's `events/unsubscribe`: eager teardown by subscription key. */
  async eventsUnsubscribe(
    identity: AgentIdentity,
    args: { name: string; url: string },
  ): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity);
    if ("error" in verified) return verified;
    if (identity.kind !== "principal") {
      return { error: { code: "capability_denied", message: "Webhook subscriptions require the signed-in /mcp endpoint." } };
    }
    const argumentsJson = JSON.stringify({ doc_id: this.name });
    const id = await subscriptionId(identity.id, args.url, args.name, argumentsJson);
    const rows = this.sql<{ id: string }>`SELECT id FROM subscriptions WHERE id = ${id}`;
    if (rows.length === 0) {
      return { error: { code: "not_found", message: "No such subscription" } };
    }
    this.sql`DELETE FROM subscriptions WHERE id = ${id}`;
    return { ok: true };
  }

  /**
   * Wakes the owner of an addressed agent through their identity-wide wake
   * target (docs/plans/2026-09-06-agent-wake-plan.md): mentions and thread
   * replies only, never digests, and only for signed-in agents (a roster row
   * with an owner). The Registry holds the target and does the sending, so
   * this just names the event; without a Registry binding (the test harness)
   * it is a no-op.
   */
  private dispatchWake(seq: number, internalType: string, payload: unknown): void {
    if (internalType !== "mention" && internalType !== "thread_reply") return;
    const registryBinding = (this as unknown as { env?: Env }).env?.Registry;
    if (!registryBinding) return;
    const data = (payload ?? {}) as { agent?: string; text?: string; threadId?: string };
    if (!data.agent) return;
    const rows = this.sql<{ owner: string | null }>`SELECT owner FROM roster WHERE name = ${data.agent}`;
    const owner = rows[0]?.owner;
    if (!owner) return;

    const event: WakeEvent = {
      name: internalType === "mention" ? "mention" : "thread.reply",
      docId: this.name,
      agent: data.agent,
      ...(data.text !== undefined ? { text: data.text } : {}),
      ...(data.threadId !== undefined ? { threadId: data.threadId } : {}),
      timestamp: new Date().toISOString(),
      eventId: eventId(this.name, seq),
    };
    const delivery = (async () => {
      const registry = (await getAgentByName(registryBinding, "global")) as unknown as Registry;
      // A document has no request in hand; PUBLIC_ORIGIN (if set) names the
      // instance, else the Registry falls back to the origin the target was
      // saved from.
      await registry.wake({ principal: owner, event, origin: configuredOrigin(this.env) ?? undefined });
    })().catch((err: unknown) => console.error("wake dispatch failed:", err));
    const ctx = (this as unknown as { ctx?: { waitUntil?: (p: Promise<unknown>) => void } }).ctx;
    if (ctx?.waitUntil) ctx.waitUntil(delivery);
  }

  /**
   * Dispatches a just-recorded event to matching webhook subscriptions.
   * Runs off the hot path via waitUntil where available; each delivery
   * retries briefly and marks sustained failure for suspension.
   */
  private dispatchWebhooks(seq: number, internalType: string, payload: unknown): void {
    const occurrence = buildOccurrence({
      docId: this.name,
      seq,
      internalType,
      payload,
      createdAt: Date.now(),
    });
    if (!occurrence) return; // internal event type with no wire mapping

    const now = Date.now();
    const candidates = this.sql<{
      id: string;
      url: string;
      secret: string;
      agent_name: string;
      failing_since: number | null;
      expires_at: number;
      active: number;
    }>`
      SELECT id, url, secret, agent_name, failing_since, expires_at, active
      FROM subscriptions WHERE name = ${occurrence.name}
    `;
    const subs: typeof candidates = [];
    for (const sub of candidates) {
      // Lazy TTL expiry: reap lapsed rows whenever we dispatch.
      if (sub.expires_at < now) {
        this.sql`DELETE FROM subscriptions WHERE id = ${sub.id}`;
        continue;
      }
      if (sub.active !== 1) continue;
      subs.push(sub);
    }
    if (subs.length === 0) return;

    const data = (payload ?? {}) as { agent?: string; actor?: string };
    const type = eventTypeByName(occurrence.name);

    for (const sub of subs) {
      if (data.actor === sub.agent_name) continue; // the subscriber's own doing
      if (type?.addressed && data.agent !== sub.agent_name) continue;
      const delivery = this.deliverWebhook(sub, occurrence);
      // The Agents SDK exposes the DO's state as this.ctx; guard for test
      // doubles that don't implement waitUntil.
      const ctx = (this as unknown as { ctx?: { waitUntil?: (p: Promise<unknown>) => void } }).ctx;
      if (ctx?.waitUntil) ctx.waitUntil(delivery);
      else void delivery;
    }
  }

  private async deliverWebhook(
    sub: { id: string; url: string; secret: string; failing_since: number | null },
    occurrence: EventOccurrence,
  ): Promise<void> {
    const body = JSON.stringify(occurrence);
    const headers = {
      "Content-Type": "application/json",
      "X-MCP-Subscription-Id": sub.id,
      ...(await signWebhook({
        secret: sub.secret,
        messageId: occurrence.eventId,
        timestampSeconds: Math.floor(Date.now() / 1000),
        body,
      })),
    };

    const attempts = [0, ...DELIVERY_RETRY_DELAYS_MS];
    for (let i = 0; i < attempts.length; i++) {
      if (attempts[i] > 0) await sleep(attempts[i]);
      try {
        const res = await fetch(sub.url, { method: "POST", headers, body });
        if (res.ok) {
          if (sub.failing_since !== null) {
            this.sql`UPDATE subscriptions SET failing_since = ${null} WHERE id = ${sub.id}`;
          }
          return;
        }
      } catch {
        // fall through to retry
      }
    }

    // All attempts failed: start (or continue) the sustained-failure clock;
    // suspend only after failures have spanned SUSPEND_AFTER_FAILING_MS so
    // a receiver's deploy blip self-heals instead of killing the
    // subscription (a successful re-subscribe reactivates).
    const now = Date.now();
    const since = sub.failing_since ?? now;
    if (sub.failing_since === null) {
      this.sql`UPDATE subscriptions SET failing_since = ${now} WHERE id = ${sub.id}`;
    }
    if (now - since >= SUSPEND_AFTER_FAILING_MS) {
      this.sql`UPDATE subscriptions SET active = ${0} WHERE id = ${sub.id}`;
    }
  }

  /** Revokes an agent's token by name. Idempotent. */
  async revokeAgentEntry(name: string): Promise<{ ok: true } | { error: AgentError }> {
    this.ensureInitialised();
    this.sql`DELETE FROM roster WHERE name = ${name}`;
    this.clearAgentIdleTimer(name);
    this.setAgentPresence(name, null);
    return { ok: true };
  }

  /**
   * Validates a caller-supplied identity (already authenticated upstream by
   * VaporMcp — DocumentAgent trusts its DO-RPC callers) and resolves it to
   * this document's roster entry, enrolling on first touch. `read` is
   * implied by any valid identity; pass `needs` to require a capability.
   * Updates `last_seen_at` on success.
   */
  private async verifyIdentity(
    identity: AgentIdentity,
    needs?: AgentCapability,
  ): Promise<{ entry: AgentRosterEntry } | { error: AgentError }> {
    if (
      !identity ||
      (identity.kind !== "principal" && identity.kind !== "anonymous") ||
      typeof identity.id !== "string" ||
      identity.id.length === 0 ||
      typeof identity.name !== "string" ||
      !Array.isArray(identity.caps)
    ) {
      return { error: { code: "invalid_token", message: "Malformed agent identity" } };
    }

    const enrolled = this.ensureRosterEntry(identity);
    if ("error" in enrolled) return enrolled;

    // last_seen_at tracks presence, not authorisation: update before the
    // capability check so a denied call still counts as "seen".
    const now = Date.now();
    this.sql`UPDATE roster SET last_seen_at = ${now} WHERE identity_id = ${identity.id}`;

    if (needs && !identity.caps.includes(needs)) {
      return {
        error: { code: "capability_denied", message: `Agent lacks capability: ${needs}` },
      };
    }

    return { entry: { ...enrolled.entry, lastSeenAt: now } };
  }

  /**
   * Checks and records rate-limit usage for a token ahead of a mutation of
   * `chars` characters. Denies with `rate_limited` when the token has made
   * more than `RATE_LIMIT_MUTATIONS_PER_MIN` mutations in the last 60s, or
   * written more than `RATE_LIMIT_CHARS_PER_HOUR` characters in the last
   * hour. On success, records this attempt. The log is pruned to the last
   * hour on every check regardless of outcome.
   */
  private async checkRateLimit(identityId: string, chars: number): Promise<{ error: AgentError } | null> {
    const rows = this.sql<{ recent_mutations: string | null }>`
      SELECT recent_mutations FROM roster WHERE identity_id = ${identityId}
    `;

    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const minuteAgo = now - 60 * 1000;

    const raw = rows[0]?.recent_mutations;
    // A corrupt log is treated as empty rather than thrown from: it is
    // rewritten (pruned) at the end of every check, so the column self-heals
    // on this very call.
    let log: MutationLogEntry[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) log = parsed as MutationLogEntry[];
      } catch {
        console.warn("Discarding unparseable rate-limit log for an agent token");
      }
    }
    const pruned = log.filter((e) => e.at > hourAgo);

    const recentCount = pruned.filter((e) => e.at > minuteAgo).length;
    const totalChars = pruned.reduce((sum, e) => sum + e.chars, 0);

    if (recentCount >= RATE_LIMIT_MUTATIONS_PER_MIN || totalChars + chars > RATE_LIMIT_CHARS_PER_HOUR) {
      this.sql`UPDATE roster SET recent_mutations = ${JSON.stringify(pruned)} WHERE identity_id = ${identityId}`;
      return { error: { code: "rate_limited", message: "Agent mutation rate limit exceeded" } };
    }

    pruned.push({ at: now, chars });
    this.sql`UPDATE roster SET recent_mutations = ${JSON.stringify(pruned)} WHERE identity_id = ${identityId}`;
    return null;
  }

  /**
   * Returns the document's full markdown, per-block anchors, current
   * presence (humans from awareness, agents from the roster), and comment
   * threads. Any valid token can read; no capability is required.
   */
  async agentRead(identity: AgentIdentity): Promise<
    | {
        markdown: string;
        blocks: { anchor: string; text: string }[];
        /** Standing per-document guidance addressed to agents; null when the document has none. */
        instructions: string | null;
        instruction_sources: { edited_by: string | null; edited_at: string | null }[];
        /** ISO 8601: when the document was created and when it deletes itself (#83). */
        created_at: string;
        expires_at: string;
        presence: { name: string; isAgent: boolean; mention?: string }[];
        threads: ThreadData[];
      }
    | { error: AgentError }
  > {
    const verified = await this.verifyIdentity(identity);
    if ("error" in verified) return verified;

    const { doc, awareness } = this.ensureInitialised();

    const markdown = yDocToMarkdown(doc);
    const blocks = getBlocks(doc).map((b) => ({ anchor: formatAnchor(b), text: b.text }));
    const instructionBlocks = getAgentInstructions(doc);
    // Framed as untrusted document guidance, with each block's editor (#82).
    const instructions = instructionsForAgents(instructionBlocks);
    const instruction_sources = instructionBlocks.map((b) => ({ edited_by: b.editedBy, edited_at: b.editedAt }));

    // One entry per person, not per tab: awareness has a state per connected
    // client, and the same person with two windows (or a reconnecting one)
    // appears twice (#88). Key by the user's stable id, else their name.
    const presence: { name: string; isAgent: boolean; mention?: string }[] = [];
    const seen = new Set<string>();
    for (const state of awareness.getStates().values()) {
      const user = (state as { user?: { name?: string; id?: string; isAgent?: boolean } }).user;
      if (!user?.name || user.isAgent) continue;
      const key = user.id ?? user.name;
      if (seen.has(key)) continue;
      seen.add(key);
      presence.push({ name: user.name, isAgent: false });
    }

    const now = Date.now();
    const roster = await this.getAgentRoster();
    for (const entry of roster) {
      if (entry.lastSeenAt != null && now - entry.lastSeenAt < 5 * 60 * 1000) {
        presence.push({ name: entry.label ?? entry.name, isAgent: true, mention: `@${entry.mention}` });
      }
    }

    const threadsMap = doc.getMap<string>("threads");
    const threads: ThreadData[] = [];
    threadsMap.forEach((value, key) => {
      // Thread JSON is written by clients into a shared Y.Map, so a single
      // malformed entry must not take the whole read down with it — the rest
      // of the document is still perfectly readable without it.
      try {
        threads.push(JSON.parse(value) as ThreadData);
      } catch {
        console.warn(`Skipping unparseable thread ${key} in agentRead`);
      }
    });

    const expiresAtMs = this.docExpiresAt();
    return {
      markdown,
      blocks,
      instructions,
      instruction_sources,
      created_at: new Date(expiresAtMs - DOCUMENT_TTL_MS).toISOString(),
      expires_at: new Date(expiresAtMs).toISOString(),
      presence,
      threads,
    };
  }

  /**
   * Returns the document's full markdown, with no token required — docs are
   * public by URL, and this backs the public `GET /:id.md` raw export route
   * (workers/routes.ts) as well as any future read-only surface that wants
   * plain markdown without the anchors/presence/threads agentRead returns.
   */
  // ---------------------------------------------------------------------
  // Version history
  // ---------------------------------------------------------------------

  /**
   * Books the idle version snapshot for IDLE_SNAPSHOT_MS from now, on the
   * alarm rather than a timer so a document can sleep while it waits.
   * Called on every update; the jitter window in scheduleTask keeps a
   * typing burst from rewriting the deadline per keystroke.
   */
  private scheduleIdleSnapshot(): void {
    this.scheduleTask(SNAPSHOT_TASK, Date.now() + IDLE_SNAPSHOT_MS);
  }

  /** On each persist: a version now if the document has swung in size or gone long enough without one. */
  private snapshotOnDelta(): void {
    if (!this.doc || !this.dirtySinceSnapshot) return;
    // History is a side trail: nothing about it may break persistence.
    try {
      const latest = this.sql<{ bytes: number; created_at: number }>`
        SELECT bytes, created_at FROM versions ORDER BY id DESC LIMIT 1
      `;
      const prevBytes = latest.length ? latest[0].bytes : null;
      const lastAt = latest.length ? latest[0].created_at : null;
      const nextBytes = yDocToMarkdown(this.doc).length;
      if (shouldSnapshotOnDelta(prevBytes, nextBytes, lastAt, Date.now())) this.maybeSnapshot("delta");
    } catch (err) {
      console.warn("Version check skipped:", err);
    }
  }

  /** Human edits: the clients whose structs an update carries, named through awareness. */
  private noteContributors(update: Uint8Array): void {
    if (!this.awareness) return;
    const states = this.awareness.getStates();
    for (const client of clientIdsInUpdate(update)) {
      const user = (states.get(client) as { user?: Record<string, unknown> } | undefined)?.user;
      const author: VersionAuthor = user
        ? {
            kind: "human",
            id: typeof user.id === "string" && user.id ? user.id : `client:${client}`,
            name: typeof user.name === "string" && user.name ? user.name : "Someone",
            color: typeof user.color === "string" ? user.color : "#999",
            avatar: typeof user.avatar === "string" ? user.avatar : null,
            animal: typeof user.animal === "string" ? user.animal : undefined,
          }
        : { kind: "unknown", id: `client:${client}`, name: "Someone", color: "#999" };
      // Re-insert so the most recent contributor is last.
      this.contributorsSinceSnapshot.delete(author.id);
      this.contributorsSinceSnapshot.set(author.id, author);
    }
  }

  /** An agent as a version author: the roster's label and colour. */
  private agentAuthor(agentName: string): VersionAuthor {
    const rows = this.sql<RosterRow>`SELECT * FROM roster WHERE name = ${agentName}`;
    const row = rows[0];
    const name = row?.label ?? row?.name ?? agentName;
    return {
      kind: "agent",
      id: row?.identity_id ?? `agent:${agentName}`,
      name,
      color: row?.color ?? "#999",
      animal: animalGlyphForLabel(name),
    };
  }

  /** The awareness user behind a connection, for control messages it sends. */
  private authorForConnection(connection: Connection): VersionAuthor | undefined {
    const clients = this.connectionClients.get(connection.id);
    if (!clients || !this.awareness) return undefined;
    const states = this.awareness.getStates();
    for (const client of clients) {
      const user = (states.get(client) as { user?: Record<string, unknown> } | undefined)?.user;
      if (!user) continue;
      return {
        kind: "human",
        id: typeof user.id === "string" && user.id ? user.id : `client:${client}`,
        name: typeof user.name === "string" && user.name ? user.name : "Someone",
        color: typeof user.color === "string" ? user.color : "#999",
        avatar: typeof user.avatar === "string" ? user.avatar : null,
        animal: typeof user.animal === "string" ? user.animal : undefined,
      };
    }
    return undefined;
  }

  /**
   * JSON control messages on the document socket. The one so far asks for
   * a version before a client-side bulk action (Accept all / Reject all)
   * the server could not otherwise tell from typing; per-connection
   * ordering guarantees it lands before that action's sync update.
   */
  private handleControlMessage(connection: Connection, message: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const msg = parsed as { type?: unknown; reason?: unknown } | null;
    if (msg?.type !== "snapshot" || msg.reason !== "pre_accept_all") return;
    this.ensureInitialised();
    this.maybeSnapshot("pre_accept_all", this.authorForConnection(connection));
  }

  /**
   * Take a version now unless the markdown matches the latest one. `actor`
   * takes the byline (an agent about to replace, a person restoring);
   * otherwise it goes to the most recent contributor. Returns the row id.
   */
  private maybeSnapshot(reason: VersionReason, actor?: VersionAuthor): number | null {
    if (!this.doc || !this.docExists()) return null;
    let markdown: string;
    try {
      markdown = yDocToMarkdown(this.doc);
    } catch (err) {
      // A document the serializer can't read yet is not worth a version,
      // and must not stop the edit it was meant to precede.
      console.warn(`Version (${reason}) skipped:`, err);
      return null;
    }
    const latest = this.sql<{ markdown: string }>`SELECT markdown FROM versions ORDER BY id DESC LIMIT 1`;
    if (latest.length && latest[0].markdown === markdown) {
      this.dirtySinceSnapshot = false;
      return null;
    }
    if (markdown.length > MAX_VERSION_BYTES) {
      console.warn(`Skipping version (${reason}): ${markdown.length} chars exceeds the cap`);
      return null;
    }
    const contributors = [...this.contributorsSinceSnapshot.values()].filter((c) => c.id !== actor?.id);
    if (actor) contributors.push(actor);
    try {
      return this.recordVersion(reason, actor ?? primaryAuthor(contributors), contributors, markdown, null);
    } catch (err) {
      console.warn(`Version (${reason}) not recorded:`, err);
      return null;
    }
  }

  private recordVersion(
    reason: VersionReason,
    author: VersionAuthor,
    contributors: VersionAuthor[],
    markdown: string,
    restoredFrom: number | null,
  ): number {
    const now = Date.now();
    this.sql`
      INSERT INTO versions (created_at, reason, author, contributors, markdown, bytes, restored_from)
      VALUES (${now}, ${reason}, ${JSON.stringify(author)}, ${JSON.stringify(contributors)}, ${markdown}, ${markdown.length}, ${restoredFrom})
    `;
    const idRows = this.sql<{ id: number }>`SELECT last_insert_rowid() AS id`;
    this.contributorsSinceSnapshot.clear();
    this.dirtySinceSnapshot = false;
    const all = this.sql<{ id: number; reason: VersionReason; created_at: number }>`
      SELECT id, reason, created_at FROM versions
    `;
    for (const id of pruneOrder(all ?? [])) this.sql`DELETE FROM versions WHERE id = ${id}`;
    return idRows?.[0]?.id ?? 0;
  }

  listVersions(): VersionSummary[] {
    this.ensureInitialised();
    const rows = this.sql<{
      id: number;
      created_at: number;
      reason: VersionReason;
      author: string;
      contributors: string;
      bytes: number;
      restored_from: number | null;
    }>`
      SELECT id, created_at, reason, author, contributors, bytes, restored_from
      FROM versions ORDER BY id DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      reason: r.reason,
      author: JSON.parse(r.author) as VersionAuthor,
      contributors: JSON.parse(r.contributors) as VersionAuthor[],
      bytes: r.bytes,
      restoredFrom: r.restored_from,
    }));
  }

  getVersionMarkdown(id: number): string | null {
    this.ensureInitialised();
    const rows = this.sql<{ markdown: string }>`SELECT markdown FROM versions WHERE id = ${id}`;
    return rows.length ? rows[0].markdown : null;
  }

  saveVersion(reason: "manual", author: VersionAuthor): { id: number } | { error: string } {
    this.ensureInitialised();
    if (!this.docExists()) return { error: "doc_not_found" };
    const id = this.maybeSnapshot(reason, author);
    return id === null ? { error: "unchanged" } : { id };
  }

  /**
   * Restore a version as an ordinary edit: the current text is saved first
   * (`pre_restore`), then every block is replaced through the same builders
   * an upload uses, in one "agent"-origin transaction so connected browsers
   * receive it and the mention/digest observers stay quiet. Threads are
   * untouched: anchors present in the restored markdown come back with it.
   */
  restoreVersion(id: number, actor: VersionAuthor): { ok: true } | { error: string } {
    const { doc } = this.ensureInitialised();
    if (!this.docExists()) return { error: "doc_not_found" };
    const now = Date.now();
    if (now - this.lastRestoreAt < RESTORE_COOLDOWN_MS) return { error: "rate_limited" };
    const rows = this.sql<{ markdown: string }>`SELECT markdown FROM versions WHERE id = ${id}`;
    if (!rows.length) return { error: "version_not_found" };
    const markdown = rows[0].markdown;
    // Parse before the transaction: Yjs cannot roll back a half-applied restore.
    const built = buildMarkdownBlocks(markdown);
    if (!built.ok) return { error: "unsupported_markup" };

    this.maybeSnapshot("pre_restore", actor);
    const frag = doc.getXmlFragment("default");
    doc.transact(() => {
      if (frag.length > 0) deleteBlocks(doc, 0, frag.length - 1);
      insertBlockNodes(doc, 0, built.nodes);
    }, "agent");
    this.lastRestoreAt = now;
    try {
      this.recordVersion("restore", actor, [actor], markdown, id);
    } catch (err) {
      console.warn("Restore version not recorded:", err);
    }
    this.flushDocState();
    return { ok: true };
  }

  private versionStub(): VersionStub {
    // A Durable Object that has never been initialised has no tables yet;
    // docExists() would throw before anything else ran.
    this.ensureInitialised();
    return {
      listVersions: () => (this.docExists() ? this.listVersions() : []),
      getVersionMarkdown: (id) => this.getVersionMarkdown(id),
      saveVersion: (reason, author) => this.saveVersion(reason, author),
      restoreVersion: (id, actor) => this.restoreVersion(id, actor),
    };
  }

  // ---------------------------------------------------------------------
  // Attachments (docs/plans/2026-09-05-attachments-plan.md)
  // ---------------------------------------------------------------------

  private attachmentBucket(): R2Bucket | null {
    return (this.env as Partial<Cloudflare.Env> | undefined)?.ATTACHMENTS ?? null;
  }

  private async deleteAttachmentObjects(): Promise<void> {
    const bucket = this.attachmentBucket();
    if (!bucket) return;
    try {
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix: `${this.name}/`, cursor });
        const keys = page.objects.map((o) => o.key);
        if (keys.length > 0) await bucket.delete(keys);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    } catch (err) {
      console.error("Attachment cleanup failed:", err);
    }
  }

  /**
   * Hold room for an upload: a `reserved` row that counts against the
   * document's budget until commit or release. Reservations older than
   * five minutes were abandoned and are reclaimed here. The type is judged
   * from the filename now; the bytes are sniffed by the uploader and the
   * real content type recorded on commit.
   */
  reserveAttachment(args: {
    filename: string;
    bytes: number;
    uploader: string;
    uploaderName: string;
  }): { id: string; filename: string } | { error: AttachmentError } {
    this.ensureInitialised();
    if (!this.docExists()) return { error: "doc_not_found" };
    const filename = sanitizeFilename(args.filename);
    if (!typeForFilename(filename)) return { error: "attachment_type" };

    const now = Date.now();
    this.sql`DELETE FROM attachments WHERE state = 'reserved' AND created_at < ${now - RESERVATION_TTL_MS}`;
    const totals = this.sql<{ state: string; total: number; count: number }>`
      SELECT state, COALESCE(SUM(bytes), 0) AS total, COUNT(*) AS count FROM attachments GROUP BY state
    `;
    const of = (state: string) => totals.find((t) => t.state === state);
    const refused = budgetAllows(
      {
        readyBytes: of("ready")?.total ?? 0,
        reservedBytes: of("reserved")?.total ?? 0,
        count: totals.reduce((n, t) => n + t.count, 0),
      },
      args.bytes,
    );
    if (refused) return { error: refused };

    const id = mintAttachmentId();
    this.sql`
      INSERT INTO attachments (id, filename, content_type, bytes, uploader, uploader_name, created_at, state)
      VALUES (${id}, ${filename}, ${null}, ${args.bytes}, ${args.uploader}, ${args.uploaderName}, ${now}, 'reserved')
    `;
    return { id, filename };
  }

  commitAttachment(id: string, info: { contentType: string; bytes: number }): { ok: true } | { error: AttachmentError } {
    this.ensureInitialised();
    const rows = this.sql<{ id: string }>`SELECT id FROM attachments WHERE id = ${id} AND state = 'reserved'`;
    if (rows.length === 0) return { error: "attachment_not_found" };
    this.sql`
      UPDATE attachments SET state = 'ready', content_type = ${info.contentType}, bytes = ${info.bytes} WHERE id = ${id}
    `;
    return { ok: true };
  }

  releaseAttachment(id: string): { ok: true } {
    this.ensureInitialised();
    this.sql`DELETE FROM attachments WHERE id = ${id} AND state = 'reserved'`;
    return { ok: true };
  }

  /** A ready attachment's serving metadata, or null. */
  attachmentInfo(id: string): { filename: string; contentType: string; bytes: number } | null {
    this.ensureInitialised();
    const rows = this.sql<{ filename: string; content_type: string; bytes: number }>`
      SELECT filename, content_type, bytes FROM attachments WHERE id = ${id} AND state = 'ready'
    `;
    const row = rows[0];
    return row ? { filename: row.filename, contentType: row.content_type, bytes: row.bytes } : null;
  }

  /** Remaining life of the document in ms, for cache headers on its attachments. */
  async remainingLifetimeMs(): Promise<number> {
    this.ensureInitialised();
    if (!this.docExists()) return 0;
    return Math.max(0, this.docExpiresAt() - Date.now());
  }

  async exportMarkdown(): Promise<{ markdown: string } | { error: AgentError }> {
    this.ensureInitialised();

    if (!this.docExists()) {
      return { error: { code: "doc_not_found", message: "Document does not exist" } };
    }

    const { doc } = this.ensureInitialised();
    return { markdown: yDocToMarkdown(doc) };
  }

  /**
   * Inserts markdown as new blocks. `where: "append"` needs no anchor;
   * otherwise the anchor is resolved and the blocks are inserted directly
   * before or after it. Requires `write`.
   */
  async agentInsert(
    identity: AgentIdentity,
    args: { anchor?: string; where: "before" | "after" | "append"; markdown: string; pace?: Pace },
  ): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity, "write");
    if ("error" in verified) return verified;

    // Validate before charging the rate limit — a malformed call shouldn't
    // spend the agent's budget.
    if (args.where !== "append" && !args.anchor) {
      return {
        error: { code: "stale_anchor", message: `An anchor is required for where: "${args.where}"` },
      };
    }

    const rateLimited = await this.checkRateLimit(identity.id, args.markdown.length);
    if (rateLimited) return rateLimited;

    return this.dispatchMutation(verified.entry.name, args.pace, {
      kind: "insert",
      anchor: args.anchor,
      where: args.where,
      markdown: args.markdown,
    });
  }

  /**
   * Replaces the block range [from, to] (anchors, `to` defaults to `from`)
   * with new markdown, in one transaction. Requires `write`.
   */
  async agentReplace(
    identity: AgentIdentity,
    args: { from: string; to?: string; markdown: string; pace?: Pace },
  ): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity, "write");
    if ("error" in verified) return verified;

    // Validate before charging the rate limit — see agentInsert.
    if (!args.from) {
      return {
        error: { code: "stale_anchor", message: 'A "from" anchor is required for replace' },
      };
    }

    const rateLimited = await this.checkRateLimit(identity.id, args.markdown.length);
    if (rateLimited) return rateLimited;

    return this.dispatchMutation(verified.entry.name, args.pace, {
      kind: "replace",
      from: args.from,
      to: args.to,
      markdown: args.markdown,
    });
  }

  /**
   * Suggests a replacement inside a block: marks `find` as a critic
   * deletion and inserts `replacement` as a critic addition, mirroring the
   * marks TipTap's suggest-mode plugin applies for human edits (no
   * author-metadata attrs — see app/lib/suggest-mode.ts). Requires
   * `suggest`.
   */
  async agentSuggest(
    identity: AgentIdentity,
    args: { anchor: string; find: string; replacement: string; pace?: Pace },
  ): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity, "suggest");
    if ("error" in verified) return verified;

    const rateLimited = await this.checkRateLimit(identity.id, args.find.length + args.replacement.length);
    if (rateLimited) return rateLimited;

    return this.dispatchMutation(verified.entry.name, args.pace, {
      kind: "suggest",
      anchor: args.anchor,
      find: args.find,
      replacement: args.replacement,
    });
  }

  /**
   * Creates a new comment thread anchored at a block. `anchor` is validated
   * (stale_anchor on failure) but — like ThreadData itself — not stored on
   * the thread; `quote` maps to `highlightText`, `text` to `commentText`,
   * matching how the client's own comment threads are shaped
   * (app/lib/comment-threads.ts / useThreads.ts). Requires `comment`.
   */
  /**
   * How an agent signs its comments and replies. `id` is the roster name,
   * which is public already (it is the mention token), never the principal;
   * it is what edit_comment and delete_comment check ownership against.
   */
  private agentAuthorInfo(entry: { name: string; label?: string | null; color: string }, identity: AgentIdentity): UserInfo {
    const display = entry.label ?? entry.name;
    return {
      id: `agent:${entry.name}`,
      name: display,
      color: entry.color,
      colorLight: entry.color,
      animal: animalGlyphForLabel(display),
      agentClient: identity.client,
    };
  }

  /** Whether this agent wrote a comment or reply. Legacy agent authors carried no id; their name and client stand in. */
  private isAgentAuthor(author: UserInfo | undefined, entry: { name: string; label?: string | null }): boolean {
    if (!author) return false;
    if (author.id) return author.id === `agent:${entry.name}`;
    return author.agentClient !== undefined && author.name === (entry.label ?? entry.name);
  }

  /** A thread from the shared map, or the typed error every thread RPC returns for a missing or unreadable one. */
  private loadThread(threadsMap: Y.Map<string>, threadId: string): { thread: ThreadData } | { error: AgentError } {
    const raw = threadsMap.get(threadId);
    if (!raw) return { error: { code: "thread_not_found", message: "thread not found" } };
    // An unparseable thread is no more usable than a missing one — same
    // typed error, rather than a throw through the RPC.
    try {
      const thread = JSON.parse(raw) as ThreadData;
      if (!Array.isArray(thread?.replies)) return { error: { code: "thread_not_found", message: "thread is unreadable" } };
      return { thread };
    } catch {
      return { error: { code: "thread_not_found", message: "thread is unreadable" } };
    }
  }

  /**
   * Opens a comment thread. With `quote` — an exact substring of the
   * block's text — the comment is attached to that span the way a comment
   * made in the browser is: a `criticHighlight` over the words and the
   * comment text right after it as a hidden `criticComment` run, which is
   * what every client places the thread by. Without a quote the marker sits
   * at the end of the block. Requires `comment`.
   */
  async agentComment(
    identity: AgentIdentity,
    args: { anchor: string; quote?: string; text: string },
  ): Promise<{ threadId: string } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity, "comment");
    if ("error" in verified) return verified;

    if (typeof args.text !== "string" || args.text.trim().length === 0) {
      return { error: { code: "invalid_params", message: "text must not be empty" } };
    }
    const rateLimited = await this.checkRateLimit(identity.id, args.text.length);
    if (rateLimited) return rateLimited;

    const { doc } = this.ensureInitialised();
    const resolved = resolveAnchor(doc, args.anchor);
    if ("error" in resolved) {
      return { error: { code: resolved.error, message: "Anchor not found", snippet: resolved.snippet } };
    }
    const el = doc.getXmlFragment("default").get(resolved.index);

    // Where the marks go: the quoted span, or the end of the block's text.
    const quote = args.quote && args.quote.length > 0 ? args.quote : undefined;
    let target: { ytext: Y.XmlText; pos: number } | null = null;
    // Length of the highlighted span: what matched, which may be the quote
    // with its markdown syntax stripped.
    let quoted = 0;
    if (el instanceof Y.XmlElement) {
      if (quote) {
        const match = findInBlock(el, quote);
        target = match;
        quoted = match?.length ?? 0;
        if (!match) {
          const snippet = textNodesUnder(el)
            .map((t) => (t.toDelta() as DeltaOp[]).map((op) => op.insert).join(""))
            .join("")
            .slice(0, 200);
          return { error: { code: "find_not_matched", message: "quote is not text in this block", snippet } };
        }
      } else {
        const last = textNodesUnder(el).at(-1);
        if (last) target = { ytext: last, pos: last.length };
      }
    }

    const { name } = verified.entry;
    const threadsMap = doc.getMap<string>("threads");
    // The same deterministic id a client would mint for this mark, so a
    // browser that scans the mark first converges on this key; a second
    // thread with identical text gets a fresh id.
    // The highlight recorded on the thread is the text on the page (the
    // quote minus any markdown syntax it was copied with), since that is
    // what clients match the mark by.
    const highlightText = target && quote ? stripInlineMarkdown(quote) : quote;
    let id = threadIdForComment({ commentText: args.text, highlightText });
    if (threadsMap.has(id)) id = crypto.randomUUID();
    const thread: ThreadData = {
      id,
      commentText: args.text,
      highlightText,
      author: this.agentAuthorInfo(verified.entry, identity),
      createdAt: Date.now(),
      resolved: false,
      replies: [],
    };

    doc.transact(() => {
      if (target) {
        if (quoted) target.ytext.format(target.pos, quoted, { criticHighlight: { threadId: id } });
        target.ytext.insert(target.pos + quoted, args.text, { criticComment: {} });
      }
      threadsMap.set(id, JSON.stringify(thread));
    }, agentOrigin(name));

    return { threadId: id };
  }

  /**
   * Resolves a thread (or reopens it with `resolved: false`). Resolving lifts
   * the highlight and marker from the text, as the browser does; reopening
   * leaves the text alone. Anyone in the document may resolve, as in the
   * UI. Requires `comment`.
   */
  async agentResolveThread(
    identity: AgentIdentity,
    args: { threadId: string; resolved?: boolean },
  ): Promise<{ ok: true; resolved: boolean } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity, "comment");
    if ("error" in verified) return verified;

    const { doc } = this.ensureInitialised();
    const threadsMap = doc.getMap<string>("threads");
    const loaded = this.loadThread(threadsMap, args.threadId);
    if ("error" in loaded) return loaded;
    const { thread } = loaded;
    const resolved = args.resolved ?? true;

    doc.transact(() => {
      if (resolved && !thread.resolved) {
        const run = findCommentRunInDoc(doc, thread.commentText);
        if (run) removeCommentRun(run);
      }
      thread.resolved = resolved;
      threadsMap.set(args.threadId, JSON.stringify(thread));
    }, agentOrigin(verified.entry.name));

    return { ok: true, resolved };
  }

  /**
   * Rewrites the text of a comment or reply this agent wrote. The opening
   * comment's hidden run in the text is rewritten too, since that is what
   * clients match the thread by. Requires `comment`.
   */
  async agentEditComment(
    identity: AgentIdentity,
    args: { threadId: string; replyId?: string; text: string },
  ): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity, "comment");
    if ("error" in verified) return verified;

    if (typeof args.text !== "string" || args.text.trim().length === 0) {
      return { error: { code: "invalid_params", message: "text must not be empty" } };
    }
    const rateLimited = await this.checkRateLimit(identity.id, args.text.length);
    if (rateLimited) return rateLimited;

    const { doc } = this.ensureInitialised();
    const threadsMap = doc.getMap<string>("threads");
    const loaded = this.loadThread(threadsMap, args.threadId);
    if ("error" in loaded) return loaded;
    const { thread } = loaded;

    if (args.replyId !== undefined) {
      const reply = thread.replies.find((r) => r.id === args.replyId);
      if (!reply) return { error: { code: "reply_not_found", message: "reply not found" } };
      if (!this.isAgentAuthor(reply.author, verified.entry)) {
        return { error: { code: "not_author", message: "only the reply's author may edit it" } };
      }
      reply.text = args.text;
      doc.transact(() => {
        threadsMap.set(args.threadId, JSON.stringify(thread));
      }, agentOrigin(verified.entry.name));
      return { ok: true };
    }

    if (!this.isAgentAuthor(thread.author, verified.entry)) {
      return { error: { code: "not_author", message: "only the comment's author may edit it" } };
    }
    doc.transact(() => {
      const run = findCommentRunInDoc(doc, thread.commentText);
      if (run) {
        run.ytext.delete(run.pos, run.length);
        run.ytext.insert(run.pos, args.text, { criticComment: {} });
      }
      thread.commentText = args.text;
      threadsMap.set(args.threadId, JSON.stringify(thread));
    }, agentOrigin(verified.entry.name));
    return { ok: true };
  }

  /**
   * Deletes a reply this agent wrote (`replyId`), or a whole thread this
   * agent opened — its highlight and marker leave the text too. Requires
   * `comment`.
   */
  async agentDeleteComment(
    identity: AgentIdentity,
    args: { threadId: string; replyId?: string },
  ): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity, "comment");
    if ("error" in verified) return verified;

    const { doc } = this.ensureInitialised();
    const threadsMap = doc.getMap<string>("threads");
    const loaded = this.loadThread(threadsMap, args.threadId);
    if ("error" in loaded) return loaded;
    const { thread } = loaded;

    if (args.replyId !== undefined) {
      const index = thread.replies.findIndex((r) => r.id === args.replyId);
      if (index === -1) return { error: { code: "reply_not_found", message: "reply not found" } };
      if (!this.isAgentAuthor(thread.replies[index].author, verified.entry)) {
        return { error: { code: "not_author", message: "only the reply's author may delete it" } };
      }
      thread.replies.splice(index, 1);
      doc.transact(() => {
        threadsMap.set(args.threadId, JSON.stringify(thread));
      }, agentOrigin(verified.entry.name));
      return { ok: true };
    }

    if (!this.isAgentAuthor(thread.author, verified.entry)) {
      return { error: { code: "not_author", message: "only the thread's author may delete it" } };
    }
    doc.transact(() => {
      const run = findCommentRunInDoc(doc, thread.commentText);
      if (run) removeCommentRun(run);
      threadsMap.delete(args.threadId);
    }, agentOrigin(verified.entry.name));
    return { ok: true };
  }

  /**
   * Appends a reply to an existing thread. Requires `comment`. A missing
   * thread returns `thread_not_found`.
   */
  async agentReply(
    identity: AgentIdentity,
    args: { threadId: string; text: string },
  ): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity, "comment");
    if ("error" in verified) return verified;

    const rateLimited = await this.checkRateLimit(identity.id, args.text.length);
    if (rateLimited) return rateLimited;

    const { doc } = this.ensureInitialised();
    const threadsMap = doc.getMap<string>("threads");
    const loaded = this.loadThread(threadsMap, args.threadId);
    if ("error" in loaded) return loaded;
    const { thread } = loaded;

    const { name } = verified.entry;
    const reply: ThreadReply = {
      id: crypto.randomUUID(),
      author: this.agentAuthorInfo(verified.entry, identity),
      text: args.text,
      createdAt: Date.now(),
    };
    thread.replies.push(reply);

    doc.transact(() => {
      threadsMap.set(args.threadId, JSON.stringify(thread));
    }, agentOrigin(name));

    return { ok: true };
  }

  /**
   * Marks an agent present in awareness (visible in the presence stack and,
   * once it performs a mutation, as a caret) and (re)starts its 5-minute
   * idle timer. Any valid token may join — presence is not a capability.
   */
  async agentJoin(identity: AgentIdentity, status?: string): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity);
    if ("error" in verified) return verified;

    const { name, label, color, client } = verified.entry;
    this.setAgentPresence(name, {
      user: { name: label ?? name, color, isAgent: true, ...(client ? { agentClient: client } : {}) },
      ...(status !== undefined ? { status } : {}),
    });
    this.resetAgentIdleTimer(name);

    return { ok: true };
  }

  /**
   * Removes an agent's presence immediately (broadcasts a null state) and
   * cancels its idle timer. The agent's token stays valid — leaving is
   * purely an awareness-visibility signal, not a revocation.
   */
  async agentLeave(identity: AgentIdentity): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity);
    if ("error" in verified) return verified;

    this.clearAgentIdleTimer(verified.entry.name);
    this.setAgentPresence(verified.entry.name, null);

    return { ok: true };
  }

  /**
   * Records and broadcasts a synthetic client's awareness state to every
   * connection. Bumps that agent's clock (see the `agentPresence` field
   * doc comment for why it never resets) regardless of whether `state` is
   * a real presence or `null` (removal).
   */
  private setAgentPresence(name: string, state: AgentPresenceState | null): void {
    const existing = this.agentPresence.get(name);
    const clientId = existing?.clientId ?? agentClientId(name);
    const clock = (existing?.clock ?? 0) + 1;
    this.agentPresence.set(name, { clientId, clock, state });
    this.broadcastAgentPresence(clientId, clock, state);
  }

  /** Sends a hand-encoded MSG_AWARENESS frame to every connected client. */
  private broadcastAgentPresence(clientId: number, clock: number, state: AgentPresenceState | null): void {
    const frame = encodeAgentAwareness(clientId, clock, state);
    for (const conn of this.getConnections()) {
      conn.send(frame);
    }
  }

  /**
   * (Re)books an agent's 5-minute idle deadline on the alarm. Called on
   * join and on every performance-cursor update; when it falls due the
   * agent's presence is removed (a broadcast null state) without touching
   * its token.
   */
  private resetAgentIdleTimer(name: string): void {
    this.scheduleTask(`${IDLE_TASK_PREFIX}${name}`, Date.now() + AGENT_IDLE_TIMEOUT_MS);
  }

  private clearAgentIdleTimer(name: string): void {
    this.unscheduleTask(`${IDLE_TASK_PREFIX}${name}`);
  }

  /**
   * Decides whether a mutation is applied synchronously or handed to the
   * performance queue. `pace: "instant"` (the default, for backward
   * compatibility with callers that don't pass `pace` at all) or the
   * absence of any connected human always applies immediately — there's no
   * one to watch it type. Otherwise the mutation is persisted to
   * `performances` and the queue runner picks it up.
   */
  private dispatchMutation(
    agentName: string,
    pace: Pace | undefined,
    mutation: MutationPayload,
  ): { ok: true } | { error: AgentError } {
    // Reject markdown the schema can't represent here, before the
    // instant/queued fork: an agent gets the same typed error whatever its
    // pace, and nothing unparseable is ever persisted to `performances`.
    if (mutation.kind === "insert" || mutation.kind === "replace") {
      const parsed = parseMarkdown(mutation.markdown);
      if (!parsed.ok) {
        return { error: { code: "unsupported_markup", message: parsed.message } };
      }
    }

    // Credit the agent for whatever lands; the update handler skips
    // "agent"-origin transactions for attribution.
    const actor = this.agentAuthor(agentName);
    this.contributorsSinceSnapshot.delete(actor.id);
    this.contributorsSinceSnapshot.set(actor.id, actor);

    const effectivePace = pace ?? "instant";
    if (effectivePace !== "instant" && this.hasHumanConnections()) {
      return this.enqueuePerformance(agentName, effectivePace, mutation);
    }
    if (mutation.kind === "replace") this.maybeSnapshot("pre_replace", actor);
    return this.applyMutation(mutation, agentName);
  }

  /** Whether any (human) WebSocket client is currently connected. */
  private hasHumanConnections(): boolean {
    for (const _conn of this.getConnections()) {
      return true;
    }
    return false;
  }

  /**
   * Persists a mutation to the `performances` table and appends it to the
   * in-memory queue, kicking off the runner if it isn't already draining
   * the queue. Anchors are stored verbatim (not resolved to indices) so
   * they can be re-checked for staleness at dequeue time.
   */
  private enqueuePerformance(
    agentName: string,
    pace: "natural" | "fast",
    mutation: MutationPayload,
  ): { ok: true } {
    const id = this.nextPerformanceId++;
    this.sql`
      INSERT INTO performances (id, agent_name, kind, payload, created_at)
      VALUES (${id}, ${agentName}, ${mutation.kind}, ${JSON.stringify(mutation)}, ${Date.now()})
    `;
    this.performanceQueue.push({ id, agentName, pace, mutation });

    if (!this.isPerforming) {
      // runPerformances swallows per-mutation failures itself; the catch is
      // the last line of defence against an unhandled rejection here.
      void this.runPerformances().catch((err) => {
        console.error("Performance runner failed:", err);
      });
    }

    return { ok: true };
  }

  /**
   * Drains the performance queue one mutation at a time, in FIFO order.
   * Runs for as long as the DO stays live; if it's evicted mid-queue,
   * ensureInitialised()'s recovery step picks up whatever rows are left on
   * the next wake-up. Each performX method below is responsible for
   * deleting its own `performances` row at the right moment — see
   * performTypedInsert/performTypedSuggest for why that isn't simply "when
   * this function returns".
   *
   * Nothing here may escape as a throw. `isPerforming` is cleared in a
   * `finally` (leaking it `true` would wedge the queue forever, since
   * enqueuePerformance only starts a runner when it is false), and each
   * mutation is attempted inside its own try/catch so one poisoned item is
   * dropped — row and all — instead of stalling everything behind it.
   */
  private async runPerformances(): Promise<void> {
    this.isPerforming = true;
    try {
      while (this.performanceQueue.length > 0) {
        const item = this.performanceQueue[0];
        try {
          await this.performQueuedMutation(item);
        } catch (err) {
          console.error(`Dropping failed performance ${item.id}:`, err);
          this.deletePerformanceRow(item.id);
        }
        this.performanceQueue.shift();
      }
    } finally {
      this.isPerforming = false;
    }
  }

  /** Deletes a performance's row. Safe to call more than once (no-op the second time). */
  private deletePerformanceRow(id: number): void {
    this.sql`DELETE FROM performances WHERE id = ${id}`;
  }

  /**
   * Applies one queued mutation. `replace` has no meaningful "typing"
   * animation (it's a delete-and-insert), so it applies atomically as soon
   * as it's dequeued. `insert` and `suggest` type their new text out via
   * chunkTyping ticks so connected humans see it appear incrementally.
   */
  private async performQueuedMutation(item: PendingMutation): Promise<void> {
    const pace: "natural" | "fast" = item.pace === "fast" ? "fast" : "natural";

    if (item.mutation.kind === "replace") {
      this.maybeSnapshot("pre_replace", this.agentAuthor(item.agentName));
      this.applyMutation(item.mutation, item.agentName);
      this.deletePerformanceRow(item.id);
      return;
    }
    if (item.mutation.kind === "insert") {
      await this.performTypedInsert(item, pace);
      return;
    }
    await this.performTypedSuggest(item, pace);
  }

  /**
   * Types a single-paragraph insert out chunk by chunk. Anchor resolution
   * happens here (dequeue time), not when the mutation was enqueued, so a
   * stale anchor is simply dropped.
   *
   * Multi-paragraph markdown applies as one shot once it's this mutation's
   * turn — only the single-paragraph case gets the typing effect.
   *
   * Concurrency: the target block index is only trustworthy up to the
   * point we last touched the doc without yielding. So the empty
   * paragraph is inserted at `index` *synchronously*, before the first
   * `await sleep(...)` — claiming its slot before any concurrent instant
   * mutation gets a chance to run and shift indices out from under us.
   * From there on, characters are typed in via a Y.RelativePosition bound
   * to that paragraph's text, which stays correct regardless of what else
   * happens to the surrounding document structure; if the position can no
   * longer be resolved (e.g. the paragraph itself was deleted by a
   * concurrent edit), typing stops cleanly instead of writing into the
   * wrong place.
   *
   * The `performances` row is deleted the moment the slot is claimed, not
   * when typing finishes: from that instant, whatever's been typed is
   * already part of the Yjs document and persisted the normal way (the
   * doc_state update hook), so a DO eviction mid-typing loses only the
   * as-yet-untyped tail rather than risking a duplicate re-application on
   * recovery. An eviction *before* the slot is claimed leaves the row
   * intact, and ensureInitialised() applies the whole mutation instantly.
   */
  private async performTypedInsert(item: PendingMutation, pace: "natural" | "fast"): Promise<void> {
    const mutation = item.mutation as Extract<MutationPayload, { kind: "insert" }>;
    const { doc } = this.ensureInitialised();

    let index: number;
    if (mutation.where === "append") {
      index = doc.getXmlFragment("default").length;
    } else {
      if (!mutation.anchor) {
        this.deletePerformanceRow(item.id);
        return;
      }
      const resolved = resolveAnchor(doc, mutation.anchor);
      if ("error" in resolved) {
        this.deletePerformanceRow(item.id);
        return;
      }
      index = mutation.where === "before" ? resolved.index : resolved.index + 1;
    }

    const parsed = parseMarkdown(mutation.markdown);
    if (!parsed.ok) {
      // Unreachable via the RPCs (dispatchMutation validates before
      // queueing) — this is the poisoned-row backstop.
      console.warn(`Dropping queued insert with unsupported markup: ${parsed.message}`);
      this.deletePerformanceRow(item.id);
      return;
    }

    // Type block by block. Each block's skeleton (structure with empty text
    // nodes) is inserted synchronously — claiming its slot before any await
    // can let a concurrent mutation shift indices — and its text is then
    // typed run by run WITH the run's formatting attributes, so styled text
    // styles as it appears. The `performances` row is deleted at the first
    // claim (eviction from then on loses only the untyped tail; see the
    // original doc comment above).
    const frag = doc.getXmlFragment("default");
    const deadline = Date.now() + PERFORMANCE_WALL_BUDGET_MS;
    let rowDeleted = false;
    let prevElement: Y.XmlElement | null = null;

    // Budget cutover: applies everything not yet typed in a handful of
    // transactions. Later runs/fills append at the end of their (still
    // agent-owned) text nodes; whole untouched blocks insert as complete
    // elements after the last block we placed.
    const finishInstantly = (
      fills: { ytext: Y.XmlText; runs: { text: string; attrs?: Record<string, unknown> }[] }[],
      fillIdx: number,
      runIdx: number,
      typedInRun: number,
      nextBlock: number,
    ): void => {
      doc.transact(() => {
        for (let f = fillIdx; f < fills.length; f++) {
          const fill = fills[f];
          const startRun = f === fillIdx ? runIdx : 0;
          for (let r = startRun; r < fill.runs.length; r++) {
            const run = fill.runs[r];
            const text = f === fillIdx && r === runIdx ? run.text.slice(typedInRun) : run.text;
            if (!text) continue;
            fill.ytext.insert(fill.ytext.length, text, run.attrs as Record<string, unknown>);
          }
        }
        for (let b = nextBlock; b < parsed.doc.childCount; b++) {
          const el = pmNodeToYElement(parsed.doc.child(b));
          if (prevElement) {
            const prevIndex = frag.toArray().indexOf(prevElement);
            if (prevIndex === -1) return;
            frag.insert(prevIndex + 1, [el]);
          } else {
            frag.insert(Math.min(index, frag.length), [el]);
          }
          prevElement = el;
        }
      }, agentOrigin(item.agentName));
    };

    for (let b = 0; b < parsed.doc.childCount; b++) {
      const { element, fills } = buildTypedBlock(parsed.doc.child(b));

      // Re-derive the insertion point from the previous typed block: its
      // index is only trustworthy while we haven't yielded.
      let insertAt: number;
      if (prevElement) {
        const prevIndex = frag.toArray().indexOf(prevElement);
        if (prevIndex === -1) return; // our earlier work was deleted — stop
        insertAt = prevIndex + 1;
      } else {
        insertAt = Math.min(index, frag.length);
      }

      doc.transact(() => frag.insert(insertAt, [element]), agentOrigin(item.agentName));
      if (!rowDeleted) {
        this.deletePerformanceRow(item.id);
        rowDeleted = true;
      }
      prevElement = element;

      for (let fillIdx = 0; fillIdx < fills.length; fillIdx++) {
        const fill = fills[fillIdx];
        let relPos = Y.createRelativePositionFromTypeIndex(fill.ytext, 0);
        for (let runIdx = 0; runIdx < fill.runs.length; runIdx++) {
          const run = fill.runs[runIdx];
          const ticks = chunkTyping(run.text, pace);
          let typedInRun = 0;
          for (const tick of ticks) {
            if (Date.now() > deadline) {
              finishInstantly(fills, fillIdx, runIdx, typedInRun, b + 1);
              return;
            }
            await sleep(tick.delayMs);
            const { doc: liveDoc } = this.ensureInitialised();
            const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, liveDoc);
            if (!absPos || absPos.type !== fill.ytext) {
              // The block (or its text) is gone — nothing sane left to type into.
              return;
            }
            doc.transact(
              () => fill.ytext.insert(absPos.index, tick.chunk, run.attrs as Record<string, unknown>),
              agentOrigin(item.agentName),
            );
            typedInRun += tick.chunk.length;
            const caretOffset = absPos.index + tick.chunk.length;
            relPos = Y.createRelativePositionFromTypeIndex(fill.ytext, caretOffset);
            this.onPerformanceCursor(item.agentName, fill.ytext, caretOffset);
          }
        }
      }
    }
  }

  /**
   * Types a suggestion's replacement text out chunk by chunk.
   *
   * `find`'s position is resolved and immediately (synchronously, no
   * `await` in between) marked as a critic deletion — that's the "claim"
   * moment, matching performTypedInsert, and it's what makes "re-verify
   * `find` is still there before marking" automatic: nothing can run
   * between resolving `pos` and writing the mark. The `performances` row
   * is deleted at that same moment, for the same eviction-safety reason as
   * performTypedInsert. The replacement text is then typed in via a
   * Y.RelativePosition anchored just after the deleted `find` text, so a
   * concurrent edit elsewhere can't make it land in the wrong place;
   * typing stops cleanly if that position stops resolving.
   */
  private async performTypedSuggest(item: PendingMutation, pace: "natural" | "fast"): Promise<void> {
    const mutation = item.mutation as Extract<MutationPayload, { kind: "suggest" }>;
    const { doc } = this.ensureInitialised();

    const resolved = resolveAnchor(doc, mutation.anchor);
    if ("error" in resolved) {
      this.deletePerformanceRow(item.id);
      return;
    }

    const frag = doc.getXmlFragment("default");
    const el = frag.get(resolved.index);
    const match = el instanceof Y.XmlElement ? findInBlock(el, mutation.find) : null;
    if (!match) {
      this.deletePerformanceRow(item.id);
      return;
    }
    const { ytext, pos, length: found } = match;

    // Claim the slot now, synchronously — see the doc comment above.
    doc.transact(() => ytext.format(pos, found, { criticDeletion: {} }), agentOrigin(item.agentName));
    let relPos = Y.createRelativePositionFromTypeIndex(ytext, pos + found);
    this.deletePerformanceRow(item.id);

    const deadline = Date.now() + PERFORMANCE_WALL_BUDGET_MS;
    const ticks = chunkTyping(mutation.replacement, pace);
    let typed = 0;
    const resolve = (): number | null => {
      const { doc: liveDoc } = this.ensureInitialised();
      const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, liveDoc);
      // Null when the block (or its text) is gone — nothing sane to type into.
      return absPos && absPos.type === ytext ? absPos.index : null;
    };

    for (const tick of ticks) {
      if (Date.now() > deadline) {
        // Budget spent — land the rest of the replacement in one shot.
        const at = resolve();
        if (at === null) return;
        const rest = mutation.replacement.slice(typed);
        doc.transact(() => ytext.insert(at, rest, { criticAddition: {} }), agentOrigin(item.agentName));
        return;
      }
      await sleep(tick.delayMs);
      const at = resolve();
      if (at === null) return;
      doc.transact(() => ytext.insert(at, tick.chunk, { criticAddition: {} }), agentOrigin(item.agentName));
      typed += tick.chunk.length;
      const caretOffset = at + tick.chunk.length;
      relPos = Y.createRelativePositionFromTypeIndex(ytext, caretOffset);
      this.onPerformanceCursor(item.agentName, ytext, caretOffset);
    }
  }

  /**
   * Moves an agent's caret to its live typing position during a
   * performance. Takes the `Y.XmlText` node and offset being typed into
   * *right now* rather than a block index: a block index resolved when the
   * performance started goes stale the moment any concurrent edit shifts
   * blocks around it (see the eviction/concurrency notes on
   * performTypedInsert/performTypedSuggest above), whereas a fresh
   * `Y.RelativePosition` built from the live text node at the moment of
   * each tick always resolves to the right place regardless of what else
   * has happened to the document structure.
   *
   * Builds the presence state itself (rather than going through
   * `agentJoin`) because a performing agent may never have explicitly
   * joined; on first cursor update for such an agent this looks its
   * name/color up from the roster instead of failing silently.
   */
  private onPerformanceCursor(agentName: string, ytext: Y.XmlText, offset: number): void {
    const relPos = Y.createRelativePositionFromTypeIndex(ytext, offset);
    // Round-trip through JSON to strip the class instance down to the plain
    // object y-tiptap's cursor plugin expects (and that JSON.stringify in
    // encodeAgentAwareness will produce anyway) — see AgentPresenceState's
    // doc comment for the exact shape.
    const posJson = JSON.parse(JSON.stringify(Y.relativePositionToJSON(relPos))) as unknown;
    const cursor = { anchor: posJson, head: posJson };

    const existing = this.agentPresence.get(agentName);
    const status = existing?.state?.status;
    let user = existing?.state?.user;
    if (!user) {
      const rows = this.sql<{ name: string; label: string | null; color: string; client: string | null }>`
        SELECT name, label, color, client FROM roster WHERE name = ${agentName}
      `;
      if (rows.length === 0) return; // unknown agent — nothing sane to show
      user = {
        name: rows[0].label ?? rows[0].name,
        color: rows[0].color,
        isAgent: true,
        ...(rows[0].client ? { agentClient: rows[0].client } : {}),
      };
    }

    this.setAgentPresence(agentName, { user, ...(status !== undefined ? { status } : {}), cursor });
    this.resetAgentIdleTimer(agentName);
  }

  /**
   * Applies a mutation's Yjs change directly, synchronously, in one
   * transaction. Shared by the instant path (pace "instant", or no humans
   * connected), eviction recovery, and the queue runner's handling of
   * `replace` mutations (which have no typing animation of their own).
   */
  private applyMutation(m: MutationPayload, actor?: string): { ok: true } | { error: AgentError } {
    // Tagged with the acting agent so observers can credit its edits to it;
    // a recovered row with no name falls back to the silent system origin.
    const origin: AgentOrigin = actor ? agentOrigin(actor) : "agent";
    const { doc } = this.ensureInitialised();

    switch (m.kind) {
      case "insert": {
        let index: number;
        if (m.where === "append") {
          index = doc.getXmlFragment("default").length;
        } else {
          if (!m.anchor) {
            return {
              error: { code: "stale_anchor", message: `An anchor is required for where: "${m.where}"` },
            };
          }
          const resolved = resolveAnchor(doc, m.anchor);
          if ("error" in resolved) {
            return { error: { code: resolved.error, message: "Anchor not found", snippet: resolved.snippet } };
          }
          index = m.where === "before" ? resolved.index : resolved.index + 1;
        }

        // Parse before opening the transaction — see buildMarkdownBlocks.
        const built = buildMarkdownBlocks(m.markdown);
        if (!built.ok) {
          return { error: { code: "unsupported_markup", message: built.message } };
        }

        doc.transact(() => {
          insertBlockNodes(doc, index, built.nodes);
        }, origin);

        return { ok: true };
      }

      case "replace": {
        const fromResolved = resolveAnchor(doc, m.from);
        if ("error" in fromResolved) {
          return { error: { code: fromResolved.error, message: "Anchor not found", snippet: fromResolved.snippet } };
        }
        const toResolved = resolveAnchor(doc, m.to ?? m.from);
        if ("error" in toResolved) {
          return { error: { code: toResolved.error, message: "Anchor not found", snippet: toResolved.snippet } };
        }

        const fromIndex = fromResolved.index;
        const toIndex = toResolved.index;

        if (toIndex < fromIndex) {
          const snippet = getBlocks(doc)
            .slice(0, 6)
            .map((b) => `[b${b.index} ${b.hash}] ${b.text.slice(0, 60)}`)
            .join("\n");
          return {
            error: {
              code: "stale_anchor",
              message: `Anchor range resolved out of order: "to" (block ${toIndex}) is before "from" (block ${fromIndex}). Re-read the document and retry with fresh anchors.`,
              snippet,
            },
          };
        }

        // Build the replacement paragraphs *before* the transaction opens.
        // Yjs cannot roll a transaction back, so parsing inside it would let
        // a parse failure commit the delete and lose the replaced blocks
        // outright.
        const built = buildMarkdownBlocks(m.markdown);
        if (!built.ok) {
          return { error: { code: "unsupported_markup", message: built.message } };
        }

        doc.transact(() => {
          deleteBlocks(doc, fromIndex, toIndex);
          insertBlockNodes(doc, fromIndex, built.nodes);
        }, origin);

        return { ok: true };
      }

      case "suggest": {
        const resolved = resolveAnchor(doc, m.anchor);
        if ("error" in resolved) {
          return { error: { code: resolved.error, message: "Anchor not found", snippet: resolved.snippet } };
        }

        const frag = doc.getXmlFragment("default");
        const el = frag.get(resolved.index);
        const block = getBlocks(doc)[resolved.index];
        const match = el instanceof Y.XmlElement ? findInBlock(el, m.find) : null;
        if (!match) {
          return {
            error: { code: "find_not_matched", message: "Could not find text to suggest a change on", snippet: block?.text ?? "" },
          };
        }

        doc.transact(() => {
          match.ytext.format(match.pos, match.length, { criticDeletion: {} });
          match.ytext.insert(match.pos + match.length, m.replacement, { criticAddition: {} });
        }, origin);

        return { ok: true };
      }
    }
  }

  /**
   * Sends a pre-encoded binary frame to every connected client, with no
   * exclusion — used for server-originated broadcasts (agent mutations)
   * where there is no originating connection to exclude, unlike
   * broadcastBinary's relay of a message that arrived from one client.
   */
  private broadcastToAll(bytes: Uint8Array) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    for (const conn of this.getConnections()) {
      conn.send(buf);
    }
  }

  private broadcastBinary(message: WSMessage, excludeId: string) {
    // Make a clean copy to avoid ArrayBufferView offset issues
    const bytes =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            (message as Uint8Array).buffer,
            (message as Uint8Array).byteOffset,
            (message as Uint8Array).byteLength,
          );
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    for (const conn of this.getConnections()) {
      if (conn.id !== excludeId) {
        conn.send(buf);
      }
    }
  }
}

export default DocumentAgent;
