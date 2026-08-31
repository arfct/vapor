import { Agent } from "agents";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS, DOCUMENT_TTL_MS, DOC_FORMAT_VERSION, USER_COLOURS } from "../app/shared/constants";
import type { AgentIdentity, AgentCapability, AgentRosterEntry, AgentError, Pace } from "../app/shared/agent-protocol";
import {
  AGENT_NAME_RE,
  findMentions,
  MAX_AGENTS_PER_DOC,
  RATE_LIMIT_MUTATIONS_PER_MIN,
  RATE_LIMIT_CHARS_PER_HOUR,
} from "../app/shared/agent-protocol";
import {
  getBlocks,
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
import { encodeAgentAwareness, agentClientId, type AgentPresenceState } from "../app/lib/agent-awareness";
import type { ThreadData, ThreadReply } from "../app/shared/types";

/** A recorded document event's public shape, as returned by agentAwaitEvents. */
type DocEventType = "mention" | "thread_reply" | "doc_changed";

interface EventRow {
  seq: number;
  type: string;
  payload: string;
  created_at: number;
}

/** How long an agent can go without a join/performance before its presence is auto-removed. */
const AGENT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

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

function findInBlock(
  el: Y.XmlElement,
  find: string,
): { ytext: Y.XmlText; pos: number } | null {
  for (const ytext of textNodesUnder(el)) {
    const text = (ytext.toDelta() as { insert: string }[]).map((op) => op.insert).join("");
    const pos = text.indexOf(find);
    if (pos !== -1) return { ytext, pos };
  }
  return null;
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
    owner: row.owner,
    capabilities: JSON.parse(row.capabilities) as AgentCapability[],
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
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
  /** Per-agent 5-minute idle timer, reset on every join/performance-cursor update. */
  private agentIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Resolvers parked by agentAwaitEvents long-polls with nothing to return yet; flushed by recordEvent. */
  private eventWaiters: (() => void)[] = [];
  /** Timestamp of the last "doc_changed" digest event, to cap it at one per 30s. */
  private lastDigestAt = 0;
  /** Agent names already notified for a block's text node — see notifyMentions. */
  private notifiedMentions = new WeakMap<Y.XmlText, Set<string>>();

  private persistTimer: ReturnType<typeof setTimeout> | null = null;

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
  }

  private ensureInitialised(): { doc: Y.Doc; awareness: awarenessProtocol.Awareness } {
    if (this.doc && this.awareness) {
      return { doc: this.doc, awareness: this.awareness };
    }

    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);

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
    this.sql`
      CREATE TABLE IF NOT EXISTS performances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_name TEXT,
        kind TEXT,
        payload TEXT,
        created_at INTEGER
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

      // Agent-originated mutations (doc.transact(fn, "agent")) never pass
      // through onMessage's relay — they mutate this DO's Y.Doc directly —
      // so without this, connected browsers never see them until their next
      // reconnect replays full state. Human-origin updates are already
      // relayed by onMessage's broadcastBinary of the raw incoming sync
      // message, so broadcasting them again here would double-send.
      if (origin === "agent") {
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
        this.applyMutation(mutation);
      } catch (err) {
        console.error(`Dropping unrecoverable performance row ${row.id}:`, err);
      }
      this.sql`DELETE FROM performances WHERE id = ${row.id}`;
    }

    // Mention detection + doc_changed digests: only for human-originated
    // changes to document content. Agent RPCs tag their own transactions
    // with the "agent" origin (see applyMutation/performTypedInsert/
    // performTypedSuggest) specifically so this observer can ignore them —
    // an agent shouldn't get a "mention" notification for text it just
    // typed itself, nor should its own edits consume the doc_changed
    // digest window meant for humans.
    const frag = this.doc.getXmlFragment("default");
    frag.observeDeep((events, transaction) => {
      if (transaction.origin === "agent") return;

      // No agents on the roster means nothing consumes events — not
      // mentions, and not doc_changed digests either. Check first, so an
      // agentless document accrues no `events` rows at all.
      const rosterNames = this.getRosterNamesSync();
      if (rosterNames.length === 0) return;

      const now = Date.now();
      if (now - this.lastDigestAt >= 30_000) {
        this.lastDigestAt = now;
        this.recordEvent("doc_changed", {});
      }

      // Scan each touched block's *full* text, not the individual delta ops:
      // a human typing "@scribe" delivers one op per keystroke, and no single
      // character ever matches the mention pattern. Only pasting did.
      const scanned = new Set<Y.XmlText>();
      for (const event of events) {
        const target = event.target;
        if (!(target instanceof Y.XmlText)) continue;
        if (scanned.has(target)) continue;
        scanned.add(target);
        const text = this.findBlockTextForXmlText(target);
        if (text === null) continue; // block already gone from the fragment
        this.notifyMentions(target, text, rosterNames);
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

      const rosterNames = this.getRosterNamesSync();
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
        if (!rosterNames.includes(thread.author?.name)) continue;

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
        if (!lastReply || lastReply.author?.name === thread.author.name) continue;
        this.recordEvent("thread_reply", { agent: thread.author.name, threadId: thread.id });
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
      // JSON control messages — reserved for future use
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

    // Last human gone: flush any pending persistence and drop every
    // standing timer so nothing keeps the DO pinned in memory — agent
    // presence only matters while someone is watching, and it rebuilds
    // from the roster on the next performance anyway.
    if (!this.hasHumanConnections()) {
      this.flushDocState();
      for (const timer of this.agentIdleTimers.values()) {
        clearTimeout(timer);
      }
      this.agentIdleTimers.clear();
      this.agentPresence.clear();
    }
  }

  override readonly alarm = async (): Promise<void> => {
    // A pending persist must not resurrect state after the delete below.
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    // Auto-delete: remove all document data
    this.sql`DELETE FROM doc_state`;
    // The roster dies with the document — an enrollment must not persist
    // against whatever content lands at this doc id if it's recreated
    // after expiry.
    this.sql`DELETE FROM roster`;
    // Any queued performances belong to a document that no longer exists.
    this.sql`DELETE FROM performances`;
    this.performanceQueue = [];
    this.isPerforming = false;
    // Recorded events (mentions, thread replies, doc_changed digests) are
    // meaningless once the document they refer to is gone.
    this.sql`DELETE FROM events`;
    for (const finish of this.eventWaiters) finish();
    this.eventWaiters = [];
    // Agent presence belongs to a document that no longer exists — drop it
    // and cancel every pending idle timer along with it.
    for (const timer of this.agentIdleTimers.values()) {
      clearTimeout(timer);
    }
    this.agentIdleTimers.clear();
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
    if (request.method === "POST") {
      // Create / initialise the document
      const { doc } = this.ensureInitialised();
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

      // If the request has a JSON body with content, populate the Yjs doc
      const contentType = request.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        try {
          const body = await request.json() as { content?: string; threads?: unknown[]; onboarding?: boolean };

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
            if (body.onboarding) {
              const docState = doc.getMap<string>("docState");
              docState.set("onboarding", "true");
            }
          }, "agent");
        } catch {
          // Ignore malformed JSON — document is still created
        }
      }

      // Persist immediately: a freshly created document must survive an
      // eviction that lands inside the debounce window.
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

      return new Response(JSON.stringify({ exists, createdAt }), {
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

    const color = USER_COLOURS[roster.length % USER_COLOURS.length].color;
    const createdAt = Date.now();
    this.sql`
      INSERT INTO roster (identity_id, name, label, color, owner, capabilities, created_at, last_seen_at)
      VALUES (${identity.id}, ${name}, ${identity.label ?? null}, ${color}, ${identity.owner}, ${JSON.stringify(identity.caps)}, ${createdAt}, ${null})
    `;
    return {
      entry: {
        name,
        label: identity.label ?? null,
        color,
        owner: identity.owner,
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
  private getRosterNamesSync(): string[] {
    const rows = this.sql<{ name: string }>`SELECT name FROM roster`;
    return rows.map((r) => r.name);
  }

  /**
   * Finds the markdown text (via getBlocks) of the block containing a given
   * Y.XmlText node, for attaching context to a mention event. Returns null
   * if the node isn't a direct child of a top-level block element (e.g. it
   * was already removed from the fragment by a later concurrent edit).
   */
  private findBlockTextForXmlText(ytext: Y.XmlText): string | null {
    if (!this.doc) return null;
    const frag = this.doc.getXmlFragment("default");
    // Climb to the top-level block containing this text node — rich blocks
    // (lists, quotes) nest text several elements deep.
    let node: unknown = ytext;
    while (node && (node as { parent: unknown }).parent !== frag) {
      node = (node as { parent: unknown }).parent;
    }
    if (!(node instanceof Y.XmlElement)) return null;
    const index = frag.toArray().indexOf(node);
    if (index === -1) return null;
    return getBlocks(this.doc)[index]?.text ?? null;
  }

  /**
   * Records a "mention" event for every roster agent named in a block's text
   * that hasn't already been notified about this block.
   *
   * De-duplication is per (block text node, agent name), because the scan
   * runs over the block's whole text on every keystroke in it — without this,
   * "@scribe, could you..." would fire a fresh mention for every character
   * typed after the name. A name is forgotten again as soon as it is no
   * longer present in the block, so deleting the mention and retyping it
   * notifies properly rather than being swallowed. The map is keyed weakly by
   * the live Y.XmlText node, so it needs no explicit clearing: entries go
   * away with the blocks (and with the whole document on expiry).
   */
  private notifyMentions(ytext: Y.XmlText, text: string, rosterNames: string[]): void {
    const mentioned = new Set(findMentions(text, rosterNames));

    let notified = this.notifiedMentions.get(ytext);
    if (!notified) {
      notified = new Set<string>();
      this.notifiedMentions.set(ytext, notified);
    }

    for (const name of notified) {
      if (!mentioned.has(name)) notified.delete(name);
    }

    for (const name of mentioned) {
      if (notified.has(name)) continue;
      notified.add(name);
      this.recordEvent("mention", { agent: name, text });
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
     * digest and goes to everyone.
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
        if (type === "mention" || type === "thread_reply") {
          if ((payload as { agent?: string }).agent !== self) continue;
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
        presence: { name: string; isAgent: boolean }[];
        threads: ThreadData[];
      }
    | { error: AgentError }
  > {
    const verified = await this.verifyIdentity(identity);
    if ("error" in verified) return verified;

    const { doc, awareness } = this.ensureInitialised();

    const markdown = yDocToMarkdown(doc);
    const blocks = getBlocks(doc).map((b) => ({ anchor: formatAnchor(b), text: b.text }));

    const presence: { name: string; isAgent: boolean }[] = [];
    for (const state of awareness.getStates().values()) {
      const user = (state as { user?: { name?: string } }).user;
      if (user?.name) presence.push({ name: user.name, isAgent: false });
    }

    const now = Date.now();
    const roster = await this.getAgentRoster();
    for (const entry of roster) {
      if (entry.lastSeenAt != null && now - entry.lastSeenAt < 5 * 60 * 1000) {
        presence.push({ name: entry.label ?? entry.name, isAgent: true });
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

    return { markdown, blocks, presence, threads };
  }

  /**
   * Returns the document's full markdown, with no token required — docs are
   * public by URL, and this backs the public `GET /:id.md` raw export route
   * (workers/routes.ts) as well as any future read-only surface that wants
   * plain markdown without the anchors/presence/threads agentRead returns.
   */
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
  async agentComment(
    identity: AgentIdentity,
    args: { anchor: string; quote?: string; text: string },
  ): Promise<{ threadId: string } | { error: AgentError }> {
    const verified = await this.verifyIdentity(identity, "comment");
    if ("error" in verified) return verified;

    const rateLimited = await this.checkRateLimit(identity.id, args.text.length);
    if (rateLimited) return rateLimited;

    const { doc } = this.ensureInitialised();
    const resolved = resolveAnchor(doc, args.anchor);
    if ("error" in resolved) {
      return { error: { code: resolved.error, message: "Anchor not found", snippet: resolved.snippet } };
    }

    const { name, label, color } = verified.entry;
    const id = crypto.randomUUID();
    const thread: ThreadData = {
      id,
      commentText: args.text,
      highlightText: args.quote,
      author: { name: label ?? name, color, colorLight: color },
      createdAt: Date.now(),
      resolved: false,
      replies: [],
    };

    doc.transact(() => {
      doc.getMap<string>("threads").set(id, JSON.stringify(thread));
    }, "agent");

    return { threadId: id };
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
    const raw = threadsMap.get(args.threadId);
    if (!raw) {
      return { error: { code: "thread_not_found", message: "thread not found" } };
    }

    // An unparseable thread is no more replyable than a missing one — same
    // typed error, rather than a throw through the RPC.
    let thread: ThreadData;
    try {
      thread = JSON.parse(raw) as ThreadData;
    } catch {
      return { error: { code: "thread_not_found", message: "thread is unreadable" } };
    }
    if (!Array.isArray(thread?.replies)) {
      return { error: { code: "thread_not_found", message: "thread is unreadable" } };
    }

    const { name, label, color } = verified.entry;
    const reply: ThreadReply = {
      id: crypto.randomUUID(),
      author: { name: label ?? name, color, colorLight: color },
      text: args.text,
      createdAt: Date.now(),
    };
    thread.replies.push(reply);

    doc.transact(() => {
      threadsMap.set(args.threadId, JSON.stringify(thread));
    }, "agent");

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

    const { name, label, color } = verified.entry;
    this.setAgentPresence(name, {
      user: { name: label ?? name, color, isAgent: true },
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
   * (Re)starts an agent's 5-minute idle timer. Called on join and on every
   * performance-cursor update; firing removes the agent's presence (a
   * broadcast null state) without touching its token.
   */
  private resetAgentIdleTimer(name: string): void {
    this.clearAgentIdleTimer(name);
    const timer = setTimeout(() => {
      this.agentIdleTimers.delete(name);
      this.setAgentPresence(name, null);
    }, AGENT_IDLE_TIMEOUT_MS);
    this.agentIdleTimers.set(name, timer);
  }

  private clearAgentIdleTimer(name: string): void {
    const timer = this.agentIdleTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.agentIdleTimers.delete(name);
    }
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

    const effectivePace = pace ?? "instant";
    if (effectivePace !== "instant" && this.hasHumanConnections()) {
      return this.enqueuePerformance(agentName, effectivePace, mutation);
    }
    return this.applyMutation(mutation);
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
      this.applyMutation(item.mutation);
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
      }, "agent");
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

      doc.transact(() => frag.insert(insertAt, [element]), "agent");
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
              "agent",
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
    const { ytext, pos } = match;

    // Claim the slot now, synchronously — see the doc comment above.
    doc.transact(() => ytext.format(pos, mutation.find.length, { criticDeletion: {} }), "agent");
    let relPos = Y.createRelativePositionFromTypeIndex(ytext, pos + mutation.find.length);
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
        doc.transact(() => ytext.insert(at, rest, { criticAddition: {} }), "agent");
        return;
      }
      await sleep(tick.delayMs);
      const at = resolve();
      if (at === null) return;
      doc.transact(() => ytext.insert(at, tick.chunk, { criticAddition: {} }), "agent");
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
      const rows = this.sql<{ name: string; label: string | null; color: string }>`
        SELECT name, label, color FROM roster WHERE name = ${agentName}
      `;
      if (rows.length === 0) return; // unknown agent — nothing sane to show
      user = { name: rows[0].label ?? rows[0].name, color: rows[0].color, isAgent: true };
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
  private applyMutation(m: MutationPayload): { ok: true } | { error: AgentError } {
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
        }, "agent");

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
        }, "agent");

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
          match.ytext.format(match.pos, m.find.length, { criticDeletion: {} });
          match.ytext.insert(match.pos + m.find.length, m.replacement, { criticAddition: {} });
        }, "agent");

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
