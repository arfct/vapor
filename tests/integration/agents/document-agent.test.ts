/**
 * DocumentAgent integration tests.
 *
 * Tests the actual DocumentAgent code with a mocked Agent base class.
 * The agents SDK uses cloudflare: protocol imports, so we mock the base
 * class and test lifecycle methods (onConnect, onMessage, onClose,
 * onRequest, alarm) directly.
 *
 * For Yjs sync tests, real Y.Doc clients exchange messages through the
 * actual agent code — testing the sync relay, SQL persistence, and
 * awareness propagation end-to-end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { DOCUMENT_TTL_MS, DOC_FORMAT_VERSION } from "~/shared/constants";
import { YjsProvider } from "~/lib/yjs-provider";
import { MAX_AGENTS_PER_DOC, type AgentCapability, type AgentIdentity } from "~/shared/agent-protocol";
import { yDocToMarkdown } from "~/shared/rich-markdown";

/* ------------------------------------------------------------------ */
/*  Mock Agent base class                                              */
/* ------------------------------------------------------------------ */

let mockSqlStore: Map<string, ArrayBuffer>;
let mockConnectionMap: Map<string, MockConnection>;
let mockSetAlarm: ReturnType<typeof vi.fn>;
/**
 * Generic in-memory table store for tables other than `doc_state`
 * (currently `roster`, `performances`, `events`).
 * Keyed by table name -> array of row objects. Query-shaped, not a real
 * SQL engine: it pattern-matches the exact INSERT/SELECT/UPDATE/DELETE
 * forms the DO code uses, mirroring the `doc_state` fake above.
 */
let mockTables: Map<string, Array<Record<string, unknown>>>;

vi.mock("agents", () => ({
  Agent: class MockAgent {
    name = "test-doc";
    env = {};
    ctx = {
      storage: {
        get setAlarm() {
          return mockSetAlarm;
        },
      },
    };

    // Captured by reference at construction time (not a live binding to the
    // outer `let`), so each `new MockAgent()` gets whatever store the
    // module-level variables currently point to. The default `beforeEach`
    // creates one agent per test, so this is transparent there. Tests that
    // need several independent documents in a single test (agent-mutation
    // tests) reassign the module-level maps to fresh ones immediately
    // before constructing each additional agent, so its captured
    // references never alias an earlier agent's store. Conversely, the
    // "restore from persisted state" test constructs a second agent
    // *without* reassigning the maps in between, so it deliberately
    // shares the first agent's store (simulating a DO reload).
    private _sqlStore = mockSqlStore;
    private _tables = mockTables;
    private _connections = mockConnectionMap;

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const raw = strings.join("$");
      const query = raw.toLowerCase().trim();

      if (query.includes("create table")) return [];

      if (query.includes("delete from doc_state")) {
        this._sqlStore.clear();
        return [];
      }

      if (query.includes("select") && query.includes("from doc_state")) {
        const match = query.match(/key\s*=\s*'(\w+)'/);
        if (match) {
          const buf = this._sqlStore.get(match[1]);
          if (buf) return [{ value: buf }];
        }
        return [];
      }

      if (query.includes("insert into doc_state")) {
        const match = query.match(/values\s*\(\s*'(\w+)'/i);
        if (match) {
          const val = values[0];
          if (val instanceof Uint8Array) {
            this._sqlStore.set(
              match[1],
              val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength),
            );
          }
        }
        return [];
      }

      // Generic table store, matched by table name in the query.
      const tableMatch = /(?:from|into|update)\s+(\w+)/.exec(query);
      if (tableMatch) {
        const table = tableMatch[1];
        if (!this._tables.has(table)) this._tables.set(table, []);
        const rows = this._tables.get(table)!;

        if (query.startsWith("insert into")) {
          const colsMatch = /\(([^)]+)\)\s*values/i.exec(raw);
          if (colsMatch) {
            const cols = colsMatch[1].split(",").map((c) => c.trim());
            const row: Record<string, unknown> = {};
            cols.forEach((col, i) => {
              row[col] = values[i];
            });
            // `events.seq` is an AUTOINCREMENT primary key the real schema
            // assigns; the DO code never supplies it explicitly (see
            // recordEvent), so synthesize a monotonically increasing one
            // here, matching real SQLite's behavior closely enough for
            // "insert then query by seq" tests.
            if (table === "events" && !("seq" in row)) {
              const maxSeq = rows.reduce((m, r) => Math.max(m, (r.seq as number) ?? 0), 0);
              row.seq = maxSeq + 1;
            }
            // Real SQLite rejects a duplicate PRIMARY KEY / UNIQUE value with
            // a constraint error, and code that assumes ids are free (e.g.
            // the performance-queue id counter resetting after an eviction
            // that left rows behind) is only wrong if the fake enforces that
            // too. Mirror the two constraints the schema actually declares
            // and the DO code actually supplies values for.
            const constrained: Record<string, string> = {
              performances: "id",
              roster: "name",
            };
            const uniqueCol = constrained[table];
            if (uniqueCol && rows.some((r) => r[uniqueCol] === row[uniqueCol])) {
              throw new Error(
                `UNIQUE constraint failed: ${table}.${uniqueCol} (${String(row[uniqueCol])})`,
              );
            }
            rows.push(row);
          }
          return [];
        }

        if (query.startsWith("update")) {
          const setMatch = /set\s+(\w+)\s*=/i.exec(raw);
          const whereMatch = /where\s+(\w+)\s*=/i.exec(raw);
          if (setMatch && whereMatch) {
            const [setVal, whereVal] = values;
            for (const row of rows) {
              if (row[whereMatch[1]] === whereVal) row[setMatch[1]] = setVal;
            }
          }
          return [];
        }

        if (query.startsWith("delete from")) {
          const whereMatch = /where\s+(\w+)\s*=/i.exec(raw);
          if (whereMatch) {
            const whereVal = values[0];
            this._tables.set(
              table,
              rows.filter((row) => row[whereMatch[1]] !== whereVal),
            );
          } else {
            this._tables.set(table, []);
          }
          return [];
        }

        if (query.startsWith("select")) {
          // Supports plain equality (`col = ?`) and, for the events cursor
          // query, a strictly-greater comparison (`seq > ?`).
          const whereMatch = /where\s+(\w+)\s*(=|>)\s*/i.exec(raw);
          let result = rows;
          if (whereMatch) {
            const [, col, op] = whereMatch;
            result = rows.filter((row) =>
              op === ">" ? (row[col] as number) > (values[0] as number) : row[col] === values[0],
            );
          }

          const orderMatch = /order by\s+(\w+)/i.exec(raw);
          if (orderMatch) {
            const col = orderMatch[1];
            result = [...result].sort((a, b) => {
              const av = a[col] as number;
              const bv = b[col] as number;
              return av < bv ? -1 : av > bv ? 1 : 0;
            });
          }

          return result.map((row) => ({ ...row }));
        }
      }

      return [];
    }

    getConnections() {
      return this._connections.values();
    }
  },
}));

/* ------------------------------------------------------------------ */
/*  Mock Connection (server-side WebSocket handle)                     */
/* ------------------------------------------------------------------ */

class MockConnection {
  id: string;
  closed = false;
  closeCode?: number;
  closeReason?: string;
  onSend?: (data: Uint8Array) => void;

  constructor(id: string) {
    this.id = id;
  }

  send(data: ArrayBuffer | Uint8Array) {
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
    this.onSend?.(bytes);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }
}

/* ------------------------------------------------------------------ */
/*  Mock Socket (client-side WebSocket)                                */
/* ------------------------------------------------------------------ */

class MockSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockSocket.OPEN;
  binaryType = "blob";
  sent: Uint8Array[] = [];
  onSend?: (data: Uint8Array) => void;

  send(data: Uint8Array | ArrayBuffer) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    this.sent.push(bytes);
    this.onSend?.(bytes);
  }

  close() {
    this.readyState = MockSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  receiveMessage(data: Uint8Array) {
    const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.dispatchEvent(new MessageEvent("message", { data: copy }));
  }
}

Object.defineProperty(MockSocket.prototype, "OPEN", { value: 1 });
Object.defineProperty(MockSocket.prototype, "CONNECTING", { value: 0 });

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("DocumentAgent", () => {
  let DocumentAgent: typeof import("../../../agents/document").default;
  let agent: InstanceType<typeof DocumentAgent>;
  let nextConnId: number;

  beforeEach(async () => {
    vi.stubGlobal("WebSocket", MockSocket);
    mockSqlStore = new Map();
    mockConnectionMap = new Map();
    mockTables = new Map();
    mockSetAlarm = vi.fn();
    nextConnId = 1;

    const mod = await import("../../../agents/document");
    DocumentAgent = mod.default;
    agent = new DocumentAgent({} as never, {} as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* ---- Helpers ---- */

  /** Create a bare MockConnection registered in the connection map. */
  function createConnection(): MockConnection {
    const conn = new MockConnection(`conn-${nextConnId++}`);
    mockConnectionMap.set(conn.id, conn);
    return conn;
  }

  /**
   * Builds a verified `AgentIdentity` to pass as the first argument to any
   * agent RPC. Enrollment is implicit — the first RPC call for a given
   * `id` creates its roster row (name from `name`, owner from `owner`,
   * capabilities from `caps`). Distinct `id` values are what separate
   * roster entries; give collaborating "agents" in the same test distinct
   * ids even when they share a display `name`.
   */
  function identity(over: Partial<AgentIdentity> = {}): AgentIdentity {
    return {
      kind: "principal",
      id: "email:a@x.com",
      name: "scribe",
      owner: "email:a@x.com",
      caps: ["suggest", "comment", "write"],
      ...over,
    };
  }

  /**
   * Create a new DocumentAgent backed by its own fresh, isolated SQL store
   * — simulating a distinct document (distinct Durable Object instance)
   * rather than the single `agent` from `beforeEach`. See the MockAgent
   * comment above for how isolation is achieved.
   */
  function makeAgent(): InstanceType<typeof DocumentAgent> {
    mockSqlStore = new Map();
    mockTables = new Map();
    mockConnectionMap = new Map();
    return new DocumentAgent({} as never, {} as never);
  }

  /**
   * Connect a full Yjs client through the agent.
   *
   * Wiring:
   *   agent sends → connection.send → socket.receiveMessage → YjsProvider
   *   YjsProvider sends → socket.send → agent.onMessage
   */
  function connectYjsClient(targetAgent = agent) {
    const connId = `conn-${nextConnId++}`;
    const socket = new MockSocket();
    const connection = new MockConnection(connId);

    // Wire agent → client
    connection.onSend = (data) => socket.receiveMessage(data);

    // Create provider (attaches message listener to socket)
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const provider = new YjsProvider(
      socket as unknown as WebSocket,
      doc,
      awareness,
    );

    // Wire client → agent
    socket.onSend = (data) => {
      const buf = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      );
      targetAgent.onMessage(connection as never, buf);
    };

    // Register connection so getConnections() includes it
    mockConnectionMap.set(connId, connection);

    // Trigger sync handshake
    targetAgent.onConnect(connection as never, {} as never);

    return { doc, awareness, socket, connection, provider, connId };
  }

  function cleanup(...clients: Array<{ provider: YjsProvider; doc: Y.Doc }>) {
    for (const c of clients) {
      c.provider.destroy();
      c.doc.destroy();
    }
  }

  /**
   * Waits for a call under test to register its (faked) setTimeout before
   * vi.advanceTimersByTimeAsync() runs. agentAwaitEvents awaits
   * verifyIdentity (and its own readPast query) before parking on a
   * setTimeout — advancing fake time too early would race ahead of that
   * registration and hang forever, since no further real time ever passes
   * to let the pending microtasks catch up. Polls vi.getTimerCount() via
   * real (un-faked) setImmediate ticks rather than a fixed number of
   * flushes, so it's robust regardless of how many real event-loop turns
   * that chain actually needs (which varies under system load) — capped
   * so a genuine bug still fails fast instead of hanging.
   */
  async function waitForTimerRegistered(): Promise<void> {
    for (let i = 0; i < 200 && vi.getTimerCount() === 0; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /* ================================================================ */
  /*  HTTP GET                                                         */
  /* ================================================================ */

  describe("GET /", () => {
    it("returns exists: false for a fresh agent", async () => {
      const res = await agent.onRequest(new Request("https://do/"));
      const body = await res.json();
      expect(body).toEqual({ exists: false, createdAt: null });
    });

    it("returns exists: true with createdAt after POST", async () => {
      const before = Date.now();
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const after = Date.now();

      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as { exists: boolean; createdAt: number };
      expect(body.exists).toBe(true);
      expect(body.createdAt).toBeGreaterThanOrEqual(before);
      expect(body.createdAt).toBeLessThanOrEqual(after);
    });
  });

  /* ================================================================ */
  /*  HTTP POST                                                        */
  /* ================================================================ */

  describe("POST /", () => {
    it("returns { ok: true }", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", { method: "POST" }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("stamps DOC_FORMAT_VERSION in Yjs meta map", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      const client = connectYjsClient();
      expect(client.doc.getMap<number>("meta").get("version")).toBe(
        DOC_FORMAT_VERSION,
      );
      cleanup(client);
    });

    it("sets auto-delete alarm at createdAt + DOCUMENT_TTL_MS", async () => {
      const before = Date.now();
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const after = Date.now();

      expect(mockSetAlarm).toHaveBeenCalledOnce();
      const alarmTime = mockSetAlarm.mock.calls[0][0] as number;
      expect(alarmTime).toBeGreaterThanOrEqual(before + DOCUMENT_TTL_MS);
      expect(alarmTime).toBeLessThanOrEqual(after + DOCUMENT_TTL_MS);
    });

    it("imports plain text content", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello world" }),
        }),
      );

      const client = connectYjsClient();
      const frag = client.doc.getXmlFragment("default");
      expect(frag.length).toBe(1);
      const para = frag.get(0) as Y.XmlElement;
      expect((para.get(0) as Y.XmlText).toString()).toBe("hello world");
      cleanup(client);
    });

    it("imports content with CriticMarkup marks", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello {++world++}" }),
        }),
      );

      const client = connectYjsClient();
      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      // XmlText.toString() includes formatting as XML tags, so check delta
      expect(ytext.toDelta()).toEqual([
        { insert: "hello " },
        { insert: "world", attributes: { criticAddition: {} } },
      ]);
      cleanup(client);
    });

    it("imports blank-line-separated content as separate blocks", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "line one\n\nline two\n\n# line three" }),
        }),
      );

      const client = connectYjsClient();
      const frag = client.doc.getXmlFragment("default");
      expect(frag.length).toBe(3);
      expect((frag.get(2) as Y.XmlElement).nodeName).toBe("heading");
      cleanup(client);
    });

    it("imports threads into Y.Map", async () => {
      const thread = { id: "t-1", commentText: "good point", replies: [] };
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "text", threads: [thread] }),
        }),
      );

      const client = connectYjsClient();
      const stored = JSON.parse(
        client.doc.getMap<string>("threads").get("t-1")!,
      );
      expect(stored.commentText).toBe("good point");
      cleanup(client);
    });

    it("imports CriticMarkup substitution as literal text", async () => {
      // Substitution has no mark form; the markdown parser leaves its
      // syntax in place as plain text rather than rejecting the import.
      const res = await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello {~~old~>new~~}" }),
        }),
      );
      expect(res.status).toBe(200);
      const client = connectYjsClient();
      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      // The inner ~~…~~ pair reads as GFM strikethrough; the braces stay text.
      expect((para.get(0) as Y.XmlText).toDelta()).toEqual([
        { insert: "hello {" },
        { insert: "old~>new", attributes: { strike: {} } },
        { insert: "}" },
      ]);
      cleanup(client);
    });

    it("still creates doc even with malformed JSON body", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Document should still exist
      const getRes = await agent.onRequest(new Request("https://do/"));
      const body = (await getRes.json()) as { exists: boolean };
      expect(body.exists).toBe(true);
    });
  });

  /* ================================================================ */
  /*  Unsupported HTTP methods                                         */
  /* ================================================================ */

  describe("unsupported methods", () => {
    it("returns 404 for PUT", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", { method: "PUT" }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ================================================================ */
  /*  Alarm (auto-delete)                                              */
  /* ================================================================ */

  describe("alarm", () => {
    it("clears all SQL data", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      expect(mockSqlStore.size).toBeGreaterThan(0);

      await agent.alarm();

      expect(mockSqlStore.size).toBe(0);
    });

    it("closes all active connections with code 1000", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const conn1 = createConnection();
      const conn2 = createConnection();

      await agent.alarm();

      expect(conn1.closed).toBe(true);
      expect(conn1.closeCode).toBe(1000);
      expect(conn1.closeReason).toBe("Document expired");
      expect(conn2.closed).toBe(true);
    });

    it("resets agent to fresh state (exists: false after alarm)", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const client = connectYjsClient();
      cleanup(client);

      await agent.alarm();

      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as { exists: boolean };
      expect(body.exists).toBe(false);
    });
  });

  /* ================================================================ */
  /*  Yjs sync through the agent                                       */
  /* ================================================================ */

  describe("Yjs sync", () => {
    it("syncs content from client A to client B", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "hello from A");

      const b = connectYjsClient();
      expect(b.doc.getText("default").toString()).toBe("hello from A");
      cleanup(a, b);
    });

    it("syncs live edits bidirectionally", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.doc.getText("default").insert(0, "AAA");
      expect(b.doc.getText("default").toString()).toBe("AAA");

      b.doc.getText("default").insert(3, " BBB");
      expect(a.doc.getText("default").toString()).toBe("AAA BBB");
      cleanup(a, b);
    });

    it("persists state in SQL and restores on new agent instance", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "persisted data");
      cleanup(a);
      // Persistence is debounced (1s quiet edge); production flushes when
      // the last connection closes — invoke that flush directly here.
      (agent as unknown as { flushDocState: () => void }).flushDocState();
      mockConnectionMap.clear();

      // Simulate DO restart: new agent instance, same SQL store
      const agent2 = new DocumentAgent({} as never, {} as never);
      const b = connectYjsClient(agent2);
      expect(b.doc.getText("default").toString()).toBe("persisted data");
      cleanup(b);
    });

    it("propagates awareness state between clients", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.awareness.setLocalStateField("user", {
        name: "Alice",
        color: "#E57373",
      });

      const stateA = b.awareness.getStates().get(a.doc.clientID);
      expect(stateA?.user).toEqual({ name: "Alice", color: "#E57373" });
      cleanup(a, b);
    });

    it("new client receives content after first client disconnects", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "before disconnect");
      a.provider.destroy();
      a.socket.close();
      mockConnectionMap.delete(a.connId);
      a.doc.destroy();

      const b = connectYjsClient();
      expect(b.doc.getText("default").toString()).toBe("before disconnect");
      cleanup(b);
    });

    it("handles rapid sequential edits", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      const text = a.doc.getText("default");
      for (let i = 0; i < 50; i++) {
        text.insert(text.length, `${i} `);
      }

      const expected = Array.from({ length: 50 }, (_, i) => `${i} `).join("");
      expect(b.doc.getText("default").toString()).toBe(expected);
      cleanup(a, b);
    });

    it("handles deletions synced between clients", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.doc.getText("default").insert(0, "hello world");
      expect(b.doc.getText("default").toString()).toBe("hello world");

      a.doc.getText("default").delete(6, 5);
      expect(b.doc.getText("default").toString()).toBe("hello ");
      cleanup(a, b);
    });

    it("propagates an instant agent mutation to an already-connected client without reconnecting", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "# Title\n\nBody." }),
        }),
      );
      const id = identity({ caps: ["write"] });

      const client = connectYjsClient(agent);
      expect(yDocToMarkdown(client.doc)).toBe("# Title\n\nBody.");

      const result = await agent.agentInsert(id, {
        where: "append",
        markdown: "Agent wrote this.",
        pace: "instant",
      });
      expect(result).toEqual({ ok: true });

      // No reconnect, no re-sync — the client's live replica must already
      // reflect the agent's mutation via a broadcast update.
      expect(yDocToMarkdown(client.doc)).toContain("Agent wrote this.");
      cleanup(client);
    });

    it("propagates a paced (natural) agent mutation to a connected client tick by tick", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        await agent.onRequest(
          new Request("https://do/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "# Title\n\nBody." }),
          }),
        );
        const id = identity({ caps: ["write"] });

        const client = connectYjsClient(agent);
        // A connected human is required for a non-instant pace to queue
        // rather than apply immediately.
        createConnection();

        const result = await agent.agentInsert(id, {
          where: "append",
          markdown: "Typed live to the client.",
          pace: "natural",
        });
        expect(result).toEqual({ ok: true });

        await vi.runAllTimersAsync();

        expect(yDocToMarkdown(client.doc)).toContain("Typed live to the client.");
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  /* ================================================================ */
  /*  onMessage edge cases                                             */
  /* ================================================================ */

  describe("onMessage", () => {
    it("ignores string messages gracefully", async () => {
      const conn = createConnection();
      await agent.onConnect(conn as never, {} as never);
      // Should not throw
      await agent.onMessage(conn as never, "some string message");
    });
  });

  /* ================================================================ */
  /*  onClose                                                          */
  /* ================================================================ */

  describe("onClose", () => {
    it("does not throw when awareness is not initialised", async () => {
      const conn = createConnection();
      // Agent has never been initialised — awareness is null
      await agent.onClose(conn as never, 1000, "normal", true);
    });

    it("does not throw after agent is initialised", async () => {
      const conn = createConnection();
      await agent.onConnect(conn as never, {} as never);
      await agent.onClose(conn as never, 1000, "normal", true);
    });
  });

  /* ================================================================ */
  /*  Agent identity roster (implicit enrollment)                      */
  /* ================================================================ */

  describe("agent roster", () => {
    it("enrolls a new identity on its first RPC call and lists it", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      const id = identity({ caps: ["suggest", "comment"] });
      expect(await agent.agentJoin(id)).toEqual({ ok: true });
      expect((await agent.getAgentRoster())[0]).toMatchObject({
        name: "scribe",
        capabilities: ["suggest", "comment"],
      });

      // Default grant lacks write.
      const denied = await agent.agentInsert(id, { where: "append", markdown: "x" });
      expect(denied).toMatchObject({ error: { code: "capability_denied" } });

      await agent.revokeAgentEntry("scribe");
      expect(await agent.getAgentRoster()).toHaveLength(0);
    });

    it("enrolls distinct identities into distinct roster rows, oldest first", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      for (let i = 0; i < 3; i++) {
        await agent.agentJoin(identity({ id: `email:agent-${i}@x.com`, name: `agent-${i}` }));
      }

      const roster = await agent.getAgentRoster();
      expect(roster.map((r) => r.name)).toEqual(["agent-0", "agent-1", "agent-2"]);
    });

    it("suffixes a name collision from a different identity id with -2, -3, …", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      await agent.agentJoin(identity({ id: "email:a@x.com", name: "claude-code" }));
      const second = await agent.agentJoin(identity({ id: "email:b@x.com", name: "claude-code" }));
      const third = await agent.agentJoin(identity({ id: "email:c@x.com", name: "claude-code" }));
      expect(second).toEqual({ ok: true });
      expect(third).toEqual({ ok: true });

      const roster = await agent.getAgentRoster();
      expect(roster.map((r) => r.name)).toEqual(["claude-code", "claude-code-2", "claude-code-3"]);
    });

    it("reuses the same roster row on repeat calls from the same identity id", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      const id = identity({ id: "email:a@x.com", name: "claude-code" });
      await agent.agentJoin(id);
      await agent.agentJoin(id);

      expect(await agent.getAgentRoster()).toHaveLength(1);
    });

    it("falls back to the 'agent' base name when the identity name fails AGENT_NAME_RE", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      await agent.agentJoin(identity({ name: "Bad Name" }));
      expect((await agent.getAgentRoster())[0].name).toBe("agent");
    });

    it("caps the roster at MAX_AGENTS_PER_DOC", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      for (let i = 0; i < MAX_AGENTS_PER_DOC; i++) {
        const id = identity({ id: `email:agent-${i}@x.com`, name: `agent-${i}` });
        expect(await agent.agentJoin(id)).toEqual({ ok: true });
      }

      const oneTooMany = identity({ id: "email:one-too-many@x.com", name: "one-too-many" });
      expect(await agent.agentJoin(oneTooMany)).toMatchObject({
        error: { code: "rate_limited", message: expect.stringContaining("maximum") },
      });
      expect(await agent.getAgentRoster()).toHaveLength(MAX_AGENTS_PER_DOC);

      // Revoking frees a slot.
      await agent.revokeAgentEntry("agent-0");
      expect(await agent.agentJoin(oneTooMany)).toEqual({ ok: true });
    });

    it("returns doc_not_found when enrolling before the doc exists", async () => {
      expect(await agent.agentJoin(identity())).toMatchObject({
        error: { code: "doc_not_found" },
      });
    });

    it("returns invalid_token for a malformed identity", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const v = await agent.agentJoin({} as never);
      expect(v).toMatchObject({ error: { code: "invalid_token" } });
    });

    it("verifies a granted capability and updates lastSeenAt", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const id = identity({ caps: ["suggest", "comment"] });

      const read = await agent.agentRead(id);
      expect("markdown" in read).toBe(true);

      const [entry] = await agent.getAgentRoster();
      expect(entry.lastSeenAt).not.toBeNull();
    });

    it("updates lastSeenAt even when the capability check denies the call", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const id = identity({ caps: ["suggest", "comment"] }); // no write
      expect(await agent.getAgentRoster()).toHaveLength(0);

      const denied = await agent.agentInsert(id, { where: "append", markdown: "x" });
      expect(denied).toMatchObject({ error: { code: "capability_denied" } });

      // The agent was here — a denied call is still a sighting, and presence
      // is derived from lastSeenAt.
      expect((await agent.getAgentRoster())[0].lastSeenAt).not.toBeNull();
    });

    it("assigns roster colors round-robin by roster size", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      await agent.agentJoin(identity({ id: "email:first@x.com", name: "first" }));
      await agent.agentJoin(identity({ id: "email:second@x.com", name: "second" }));

      const roster = await agent.getAgentRoster();
      expect(roster[0].color).not.toBe(roster[1].color);
    });

    it("enrolls an anonymous identity with owner null and its given capabilities", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      const anon = identity({
        kind: "anonymous",
        id: "anon:session-1",
        name: "claude-code",
        owner: null,
        caps: ["suggest", "comment"],
      });
      expect(await agent.agentJoin(anon)).toEqual({ ok: true });

      const roster = await agent.getAgentRoster();
      expect(roster).toHaveLength(1);
      expect(roster[0]).toMatchObject({
        name: "claude-code",
        owner: null,
        capabilities: ["suggest", "comment"],
      });
    });

    it("clears the roster on doc expiry (alarm), and a subsequent RPC re-enrolls fresh", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const id = identity();
      await agent.agentJoin(id);

      await agent.alarm();

      expect(await agent.getAgentRoster()).toEqual([]);

      // The document itself is gone too, so a bare re-enrollment attempt
      // still needs a fresh doc before it can succeed.
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      expect(await agent.agentJoin(id)).toEqual({ ok: true });
      expect(await agent.getAgentRoster()).toHaveLength(1);
    });
  });

  /* ================================================================ */
  /*  Agent read + instant mutations                                   */
  /* ================================================================ */

  describe("agent mutations", () => {
    async function setup(caps: AgentCapability[] = ["suggest", "comment"]) {
      const agent = makeAgent();
      await agent.onRequest(new Request("https://do/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# Title\n\nBody." }),
      }));
      const id = identity({ caps });
      return { agent, id };
    }

    it("reads markdown with anchors", async () => {
      const { agent, id } = await setup();
      const r = await agent.agentRead(id);
      expect("markdown" in r && r.markdown).toBe("# Title\n\nBody.");
      expect("blocks" in r && r.blocks[0].anchor).toMatch(/^[a-z0-9]{8}-[0-9a-f]{8}$/);
    });

    it("exportMarkdown returns the document's markdown with no identity", async () => {
      const { agent } = await setup();
      const r = await agent.exportMarkdown();
      expect(r).toEqual({ markdown: "# Title\n\nBody." });
    });

    it("exportMarkdown errors doc_not_found for a document never created", async () => {
      const agent = makeAgent();
      const r = await agent.exportMarkdown();
      expect(r).toMatchObject({ error: { code: "doc_not_found" } });
    });

    it("denies write without capability, allows with it", async () => {
      const { agent, id } = await setup();                       // default: no write
      const denied = await agent.agentInsert(id, { where: "append", markdown: "More." });
      expect(denied).toMatchObject({ error: { code: "capability_denied" } });
      const { agent: a2, id: id2 } = await setup(["write"]);
      await a2.agentInsert(id2, { where: "append", markdown: "More." });
      const r = await a2.agentRead(id2);
      expect("markdown" in r && r.markdown).toContain("More.");
    });

    it("suggest lays critic marks", async () => {
      const { agent, id } = await setup(["suggest"]);
      const read = await agent.agentRead(id);
      const anchor = ("blocks" in read ? read.blocks : [])[1].anchor;   // "Body."
      await agent.agentSuggest(id, { anchor, find: "Body.", replacement: "Better body." });
      const after = await agent.agentRead(id);
      expect("markdown" in after && after.markdown).toContain("{--Body.--}{++Better body.++}");
    });

    it("rejects a missing anchor without spending the rate-limit budget", async () => {
      const { agent, id } = await setup(["write"]);

      const result = await agent.agentInsert(id, { where: "after", markdown: "Orphan." });
      expect(result).toMatchObject({ error: { code: "stale_anchor" } });

      const row = (mockTables.get("roster") ?? []).find((r) => r.name === "scribe")!;
      expect(row.recent_mutations ?? null).toBeNull();
    });

    it("stale anchor errors after concurrent edit", async () => {
      const { agent, id } = await setup(["write"]);
      const read = await agent.agentRead(id);
      const anchor = ("blocks" in read ? read.blocks : [])[0].anchor;
      await agent.agentReplace(id, { from: anchor, markdown: "# New title" });
      const stale = await agent.agentReplace(id, { from: anchor, markdown: "# Again" });
      expect(stale).toMatchObject({ error: { code: "stale_anchor" } });
    });

    it("rejects an inverted range when to resolves before from", async () => {
      const { agent, id } = await setup(["write"]);
      // Append two blocks with identical text ("Same") so they share a
      // content hash. resolveAnchor's nearest-index heuristic then lets us
      // pick out either occurrence by fabricating an anchor whose *stated*
      // index is far from one occurrence and close to the other.
      await agent.agentInsert(id, { where: "append", markdown: "Same\n\nOther\n\nSame\n\nEnd" });

      const before = await agent.agentRead(id);
      const beforeMarkdown = "markdown" in before ? before.markdown : "";
      const blocks = "blocks" in before ? before.blocks : [];
      const sameBlocks = blocks.filter((b) => b.text === "Same");
      expect(sameBlocks).toHaveLength(2); // real indices 2 and 4

      const hash = sameBlocks[0].anchor.split("-").pop()!;
      // "from" resolves to the later occurrence (nearest to stated index 100).
      const fromAnchor = `b100-${hash}`;
      // "to" resolves to the earlier occurrence (nearest to stated index 0).
      const toAnchor = `b0-${hash}`;

      const result = await agent.agentReplace(id, { from: fromAnchor, to: toAnchor, markdown: "Nope" });
      expect(result).toMatchObject({ error: { code: "stale_anchor" } });

      const after = await agent.agentRead(id);
      expect("markdown" in after && after.markdown).toBe(beforeMarkdown);
    });

    /* ================================================================ */
    /*  Performance engine (pacing)                                      */
    /* ================================================================ */

    describe("pacing", () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it("applies instantly when there are no human connections, even at natural pace", async () => {
        const { agent, id } = await setup(["write"]);
        const result = await agent.agentInsert(id, {
          where: "append",
          markdown: "Typed live.",
          pace: "natural",
        });
        expect(result).toEqual({ ok: true });

        const read = await agent.agentRead(id);
        expect("markdown" in read && read.markdown).toContain("Typed live.");
      });

      it("applies instantly regardless of pace when pace is 'instant'", async () => {
        const { agent, id } = await setup(["write"]);
        createConnection();
        const result = await agent.agentInsert(id, {
          where: "append",
          markdown: "Pasted in.",
          pace: "instant",
        });
        expect(result).toEqual({ ok: true });

        const read = await agent.agentRead(id);
        expect("markdown" in read && read.markdown).toContain("Pasted in.");
      });

      it("enqueues and types out a natural-pace insert while a human is connected", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { agent, id } = await setup(["write"]);
        createConnection();

        // No punctuation, so no sentence pauses — keeps the timing math
        // below simple. 78 chars.
        const fullText = "abcdefghijklmnopqrstuvwxyz".repeat(3);
        const result = await agent.agentInsert(id, {
          where: "append",
          markdown: fullText,
          pace: "natural",
        });
        expect(result).toEqual({ ok: true });

        // The insert's slot (an empty paragraph) is claimed synchronously
        // before agentInsert resolves, but nothing has been typed into it
        // yet — the first character requires the first tick's delay to
        // elapse.
        const beforeAnyTick = await agent.agentRead(id);
        const blocksBefore = "blocks" in beforeAnyTick ? beforeAnyTick.blocks : [];
        expect(blocksBefore[2]?.text ?? "").toBe("");

        // Advance past at least the first tick (maximum natural-pace delay
        // is 320ms), but nowhere near enough for the fastest possible full
        // typing (78 chars / 4 chars-per-tick max * 180ms-per-tick min =
        // 3510ms) — so this is genuinely partial, not a fluke of timing.
        await vi.advanceTimersByTimeAsync(400);

        const afterFirstTick = await agent.agentRead(id);
        const partialBlock = ("blocks" in afterFirstTick ? afterFirstTick.blocks : [])[2];
        const partialLength = partialBlock?.text.length ?? 0;
        expect(partialLength).toBeGreaterThan(0);
        expect(partialLength).toBeLessThan(fullText.length);

        await vi.runAllTimersAsync();

        const after = await agent.agentRead(id);
        expect("markdown" in after && after.markdown).toContain(fullText);
      });

      it("applies a leftover queued mutation instantly on restart (eviction recovery)", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { agent, id } = await setup(["write"]);
        createConnection();

        // Busy the runner with a slow first mutation so the second one's
        // turn never comes — its row is claimed (and deleted) the instant
        // its own typing starts, which happens synchronously as part of
        // *this* call.
        await agent.agentInsert(id, {
          where: "append",
          markdown: "abcdefghijklmnopqrstuvwxyz".repeat(3),
          pace: "natural",
        });

        // This second mutation is still sitting behind the first in the
        // queue, completely untouched — pre-first-write, so its row is
        // still fully intact in `performances`.
        await agent.agentInsert(id, {
          where: "append",
          markdown: "Recovered text.",
          pace: "natural",
        });

        // Simulate a DO eviction + restart by constructing a fresh agent
        // instance over the same underlying SQL store, without ever
        // advancing time (so the busy first mutation never finishes, and
        // the second mutation's row is never touched by the runner).
        const agent2 = new DocumentAgent({} as never, {} as never);
        const read = await agent2.agentRead(id);
        expect("markdown" in read && read.markdown).toContain("Recovered text.");
      });

      it("keeps both texts present exactly once, in sane positions, despite a concurrent instant append", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { agent, id } = await setup(["write"]);
        createConnection();

        const id2 = identity({ id: "email:bot2@x.com", name: "bot2", caps: ["write"] });

        // Starts typing "Slow typed line" at natural pace — claims its
        // block slot synchronously, before any ticks fire.
        const pacedResult = await agent.agentInsert(id, {
          where: "append",
          markdown: "Slow typed line",
          pace: "natural",
        });
        expect(pacedResult).toEqual({ ok: true });

        // A second agent's instant append lands while the first is still
        // mid-typing.
        const instantResult = await agent.agentInsert(id2, {
          where: "append",
          markdown: "Instant line",
          pace: "instant",
        });
        expect(instantResult).toEqual({ ok: true });

        await vi.runAllTimersAsync();

        const after = await agent.agentRead(id);
        const markdown = "markdown" in after ? after.markdown : "";
        const blocks = "blocks" in after ? after.blocks : [];
        const texts = blocks.map((b) => b.text);

        expect(markdown.match(/Slow typed line/g)).toHaveLength(1);
        expect(markdown.match(/Instant line/g)).toHaveLength(1);
        // The typed insert claimed its slot first, so the instant append
        // lands after it instead of clobbering/reordering it.
        expect(texts.indexOf("Slow typed line")).toBeLessThan(texts.indexOf("Instant line"));
      });

      it("keeps an anchored typed insert on the correct side of its anchor despite a concurrent instant insert before it", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { agent, id } = await setup(["write"]);
        createConnection();

        const id2 = identity({ id: "email:bot2@x.com", name: "bot2", caps: ["write"] });

        const before = await agent.agentRead(id);
        const anchor0 = ("blocks" in before ? before.blocks : [])[0].anchor; // "# Title"

        // Starts typing "Slow typed line" right after the title, at
        // natural pace. This claims its slot (right after block 0)
        // synchronously, before any ticks fire — the block index it
        // resolved to is only valid up to that point.
        const pacedResult = await agent.agentInsert(id, {
          where: "after",
          anchor: anchor0,
          markdown: "Slow typed line",
          pace: "natural",
        });
        expect(pacedResult).toEqual({ ok: true });

        // A second agent inserts *before* the same anchor, instantly, while
        // the first is still mid-typing. If the typed insert's write used
        // its originally-resolved raw index instead of tracking the
        // paragraph itself, this would land the typed text *before* the
        // title it was supposed to follow.
        const instantResult = await agent.agentInsert(id2, {
          where: "before",
          anchor: anchor0,
          markdown: "Preamble",
          pace: "instant",
        });
        expect(instantResult).toEqual({ ok: true });

        await vi.runAllTimersAsync();

        const after = await agent.agentRead(id);
        const markdown = "markdown" in after ? after.markdown : "";
        const blocks = "blocks" in after ? after.blocks : [];
        const texts = blocks.map((b) => b.text);

        expect(markdown.match(/Slow typed line/g)).toHaveLength(1);
        expect(markdown.match(/Preamble/g)).toHaveLength(1);
        const titleIndex = texts.indexOf("# Title");
        const preambleIndex = texts.indexOf("Preamble");
        const slowIndex = texts.indexOf("Slow typed line");
        expect(preambleIndex).toBeLessThan(titleIndex);
        // "Slow typed line" was requested as "after # Title" — it must
        // stay after it even though "Preamble" was inserted before the
        // title while it was still mid-flight.
        expect(slowIndex).toBeGreaterThan(titleIndex);
      });

      it("drops a queued mutation whose anchor goes stale before its turn", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { agent, id } = await setup(["write"]);
        createConnection();

        const before = await agent.agentRead(id);
        const anchor0 = ("blocks" in before ? before.blocks : [])[0].anchor; // "# Title"

        // Busy the runner with a slow natural-pace insert.
        await agent.agentInsert(id, {
          where: "append",
          markdown: "Long enough text to take a few typing ticks.",
          pace: "natural",
        });

        // Queue a replace behind it, targeting the still-fresh anchor0.
        const queuedReplace = agent.agentReplace(id, {
          from: anchor0,
          markdown: "Replaced!",
          pace: "natural",
        });
        expect(await queuedReplace).toEqual({ ok: true });

        // An instant edit invalidates anchor0 before the queued replace
        // gets its turn.
        const instantEdit = await agent.agentReplace(id, {
          from: anchor0,
          markdown: "Changed first!",
          pace: "instant",
        });
        expect(instantEdit).toEqual({ ok: true });

        await vi.runAllTimersAsync();

        const after = await agent.agentRead(id);
        const markdown = "markdown" in after ? after.markdown : "";
        expect(markdown).toContain("Changed first!");
        expect(markdown).not.toContain("Replaced!");
      });
    });

    /* ================================================================ */
    /*  Unsupported markup: errors as values, never a throw              */
    /* ================================================================ */

    describe("substitution markup", () => {
      /**
       * CriticMarkup substitution has no mark form. The markdown parser
       * leaves its syntax in place as literal text — mutations succeed and
       * the syntax reads back verbatim (unsupported_markup remains only as
       * the parser-failure backstop).
       */
      const SUBSTITUTION = "A {~~old~>new~~} B";

      /**
       * The performance queue's internals. Tests reach in to plant the kind
       * of payload the RPCs now reject up front, standing in for a row
       * written by an older build (or corrupted in storage).
       */
      function asQueue(a: InstanceType<typeof DocumentAgent>) {
        return a as unknown as {
          enqueuePerformance(name: string, pace: string, mutation: unknown): { ok: true };
          isPerforming: boolean;
        };
      }

      afterEach(() => {
        vi.useRealTimers();
      });

      it("agentInsert imports substitution syntax as literal text", async () => {
        const { agent, id } = await setup(["write"]);

        const result = await agent.agentInsert(id, {
          where: "append",
          markdown: SUBSTITUTION,
          pace: "instant",
        });

        expect(result).toEqual({ ok: true });
        const after = await agent.agentRead(id);
        expect("markdown" in after && after.markdown).toContain("{~~old\\~>new~~}");
      });

      it("agentReplace with substitution text keeps the document consistent", async () => {
        const { agent, id } = await setup(["write"]);
        const before = await agent.agentRead(id);
        const anchor = ("blocks" in before ? before.blocks : [])[0].anchor;

        const result = await agent.agentReplace(id, {
          from: anchor,
          markdown: SUBSTITUTION,
          pace: "instant",
        });

        expect(result).toEqual({ ok: true });
        const after = await agent.agentRead(id);
        expect("markdown" in after && after.markdown).toContain("{~~old\\~>new~~}");
        expect("markdown" in after && after.markdown).toContain("Body.");
      });

      it("types a queued substitution as literal text and drains the queue", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { agent, id } = await setup(["write"]);
        createConnection();

        asQueue(agent).enqueuePerformance("scribe", "fast", {
          kind: "insert",
          where: "append",
          markdown: SUBSTITUTION,
        });
        await agent.agentInsert(id, {
          where: "append",
          markdown: "Good text.",
          pace: "fast",
        });

        await vi.runAllTimersAsync();

        const after = await agent.agentRead(id);
        const markdown = "markdown" in after ? after.markdown : "";
        expect(markdown).toContain("Good text.");
        expect(markdown).toContain("old\\~>new");
        expect(asQueue(agent).isPerforming).toBe(false);
        expect(mockTables.get("performances") ?? []).toEqual([]);
      });

      it("does not wedge the queue when a queued mutation throws", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const { agent, id } = await setup(["write"]);
        createConnection();

        // A payload no code path can apply: `markdown` isn't a string, so
        // the first thing performTypedInsert does with it throws. Before the
        // runner caught this, isPerforming stayed true forever and every
        // later mutation queued behind it was never performed.
        asQueue(agent).enqueuePerformance("scribe", "fast", {
          kind: "insert",
          where: "append",
          markdown: null,
        });
        await vi.runAllTimersAsync();

        expect(asQueue(agent).isPerforming).toBe(false);
        expect(mockTables.get("performances") ?? []).toEqual([]);

        await agent.agentInsert(id, {
          where: "append",
          markdown: "Still working.",
          pace: "fast",
        });
        await vi.runAllTimersAsync();

        const after = await agent.agentRead(id);
        expect("markdown" in after && after.markdown).toContain("Still working.");
      });

      it("recovers from a poisoned leftover performance row on restart", async () => {
        const { agent, id } = await setup(["write"]);

        // An eviction mid-queue leaves rows behind. This one can't be
        // applied at all — a throw here used to abort ensureInitialised with
        // doc/awareness already set, leaving the Yjs observers unregistered
        // (no mentions, no events, ever) and the row alive to collide with a
        // performance id counter that restarts at 1.
        mockTables.set("performances", [
          { id: 1, agent_name: "scribe", kind: "insert", payload: "{ not json", created_at: Date.now() },
        ]);

        const agent2 = new DocumentAgent({} as never, {} as never);
        const read = await agent2.agentRead(id);
        expect("markdown" in read).toBe(true);
        expect(mockTables.get("performances") ?? []).toEqual([]);

        // Observers registered: a human mention still fires.
        const client = connectYjsClient(agent2);
        const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
        const ytext = para.get(0) as Y.XmlText;
        ytext.insert(ytext.length, " ping @scribe");
        const events = await agent2.agentAwaitEvents(id, {});
        expect(("events" in events ? events.events : []).some((e) => e.type === "mention")).toBe(true);

        // And the reused performance id no longer collides with a survivor.
        const queued = await agent2.agentInsert(id, {
          where: "append",
          markdown: "After recovery.",
          pace: "natural",
        });
        expect(queued).toEqual({ ok: true });
        cleanup(client);
        void agent;
      });
    });

    /* ================================================================ */
    /*  Corrupt stored JSON: typed errors, never a throw                 */
    /* ================================================================ */

    describe("corrupt stored state", () => {
      it("agentRead skips an unparseable thread rather than throwing", async () => {
        const { agent, id } = await setup(["comment"]);
        const read = await agent.agentRead(id);
        const anchor = ("blocks" in read ? read.blocks : [])[0].anchor;
        await agent.agentComment(id, { anchor, text: "fine" });

        const client = connectYjsClient(agent);
        client.doc.getMap<string>("threads").set("broken", "{ not json");

        const after = await agent.agentRead(id);
        expect("threads" in after && after.threads).toHaveLength(1);
        expect("threads" in after && after.threads[0].commentText).toBe("fine");
        cleanup(client);
      });

      it("agentReply returns thread_not_found for an unparseable thread", async () => {
        const { agent, id } = await setup(["comment"]);
        const client = connectYjsClient(agent);
        client.doc.getMap<string>("threads").set("broken", "{ not json");

        const result = await agent.agentReply(id, { threadId: "broken", text: "hi" });
        expect(result).toMatchObject({ error: { code: "thread_not_found" } });
        cleanup(client);
      });

      it("treats an unparseable rate-limit log as empty and rewrites it", async () => {
        const { agent, id } = await setup(["write"]);
        await agent.agentJoin(id); // enroll first — the roster row doesn't exist until an RPC lands
        const row = (mockTables.get("roster") ?? []).find((r) => r.name === "scribe")!;
        row.recent_mutations = "{ not json";

        const result = await agent.agentInsert(id, {
          where: "append",
          markdown: "Fine.",
          pace: "instant",
        });

        expect(result).toEqual({ ok: true });
        expect(JSON.parse(row.recent_mutations as string)).toHaveLength(1);
      });
    });
  });

  /* ================================================================ */
  /*  Agent presence in awareness                                      */
  /* ================================================================ */

  describe("agent presence", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function setup(caps: AgentCapability[] = ["suggest", "comment"]) {
      const agent = makeAgent();
      await agent.onRequest(new Request("https://do/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# Title\n\nBody." }),
      }));
      const id = identity({ caps });
      return { agent, id };
    }

    /** Finds the (at most one) agent presence state among a client's awareness states. */
    function findAgentState(awareness: awarenessProtocol.Awareness) {
      return Array.from(awareness.getStates().values()).find(
        (s) => (s as { user?: { isAgent?: boolean } }).user?.isAgent,
      ) as { user: { name: string; isAgent: boolean }; status?: string; cursor?: { anchor: unknown; head: unknown } } | undefined;
    }

    it("broadcasts a presence state every connected client can decode", async () => {
      const { agent, id } = await setup();
      const a = connectYjsClient(agent);
      const b = connectYjsClient(agent);

      const result = await agent.agentJoin(id, "typing");
      expect(result).toEqual({ ok: true });

      for (const client of [a, b]) {
        expect(findAgentState(client.awareness)).toMatchObject({
          user: { name: "scribe", isAgent: true },
          status: "typing",
        });
      }
      cleanup(a, b);
    });

    it("replays current agent presence to a client that connects after join", async () => {
      const { agent, id } = await setup();
      await agent.agentJoin(id);

      const late = connectYjsClient(agent);
      expect(findAgentState(late.awareness)).toMatchObject({
        user: { name: "scribe", isAgent: true },
      });
      cleanup(late);
    });

    it("replays nothing for an agent that never joined", async () => {
      const { agent } = await setup();
      const late = connectYjsClient(agent);
      expect(findAgentState(late.awareness)).toBeUndefined();
      cleanup(late);
    });

    it("removes presence for all connections immediately on leave", async () => {
      const { agent, id } = await setup();
      const a = connectYjsClient(agent);
      await agent.agentJoin(id);
      expect(findAgentState(a.awareness)).toBeDefined();

      const result = await agent.agentLeave(id);
      expect(result).toEqual({ ok: true });
      expect(findAgentState(a.awareness)).toBeUndefined();
      cleanup(a);
    });

    it("rejects join/leave for a malformed identity", async () => {
      const { agent } = await setup();
      expect(await agent.agentJoin({} as never)).toMatchObject({
        error: { code: "invalid_token" },
      });
      expect(await agent.agentLeave({} as never)).toMatchObject({
        error: { code: "invalid_token" },
      });
    });

    it("removes presence automatically after 5 minutes of inactivity", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { agent, id } = await setup();
      const a = connectYjsClient(agent);
      await agent.agentJoin(id);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
      expect(findAgentState(a.awareness)).toBeDefined();

      await vi.advanceTimersByTimeAsync(2);
      expect(findAgentState(a.awareness)).toBeUndefined();
      cleanup(a);
    });

    it("resets the idle timer on every performance, keeping a busy agent present", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { agent, id } = await setup(["write"]);
      const a = connectYjsClient(agent);
      await agent.agentJoin(id);

      // Just under the idle window, perform a (quick) mutation — its
      // typing ticks call onPerformanceCursor, which resets the timer. Only
      // advance far enough to finish typing "hi" (well under 5 minutes) —
      // vi.runAllTimersAsync() would also drain the *freshly reset* 5-minute
      // idle timeout in the same call, defeating the point of the test.
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      await agent.agentInsert(id, { where: "append", markdown: "hi", pace: "natural" });
      await vi.advanceTimersByTimeAsync(200);

      // Another 4 minutes — past the original 5-minute mark from join, but
      // well within 5 minutes of the reset above.
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(findAgentState(a.awareness)).toBeDefined();
      cleanup(a);
    });

    it("populates a y-tiptap-shaped cursor field during a performance, even for an agent that never joined", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { agent, id } = await setup(["write"]);
      const a = connectYjsClient(agent);

      // Bounded advance, not vi.runAllTimersAsync(): each tick's
      // onPerformanceCursor resets a fresh 5-minute idle timeout, which
      // runAllTimersAsync() would drain too, removing presence again before
      // this assertion runs.
      await agent.agentInsert(id, { where: "append", markdown: "abcdefghij", pace: "natural" });
      await vi.advanceTimersByTimeAsync(800);

      const state = findAgentState(a.awareness);
      expect(state).toMatchObject({ user: { name: "scribe", isAgent: true } });
      expect(state?.cursor).toBeDefined();
      // Both fields must be decodable Y.RelativePosition JSON (the shape
      // @tiptap/y-tiptap's cursor plugin expects — see agent-awareness.ts).
      expect(() => Y.createRelativePositionFromJSON(state!.cursor!.anchor as never)).not.toThrow();
      expect(() => Y.createRelativePositionFromJSON(state!.cursor!.head as never)).not.toThrow();
      cleanup(a);
    });

    it("clears agent presence and idle timers on alarm", async () => {
      const { agent, id } = await setup();
      const a = connectYjsClient(agent);
      await agent.agentJoin(id);
      expect(findAgentState(a.awareness)).toBeDefined();

      await agent.alarm();

      mockConnectionMap.clear();
      const b = connectYjsClient(agent);
      expect(findAgentState(b.awareness)).toBeUndefined();
      cleanup(a, b);
    });
  });

  /* ================================================================ */
  /*  Events: mentions, thread replies, await_events long-poll         */
  /* ================================================================ */

  describe("agent events", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function setup(caps: AgentCapability[] = ["suggest", "comment"]) {
      const agent = makeAgent();
      await agent.onRequest(new Request("https://do/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hello there." }),
      }));
      const id = identity({ caps });
      // Enrollment is implicit on an agent's first RPC call — the mention/
      // thread_reply/doc_changed observers only fire once the roster is
      // non-empty, so this agent must be on it *before* any human edit the
      // test makes, exactly as an explicit mint used to guarantee.
      await agent.agentJoin(id);
      return { agent, id };
    }

    it("records a mention through the real Yjs sync path when a human edits an existing block", async () => {
      const { agent, id } = await setup();
      const client = connectYjsClient(agent);

      // A human types more text into the already-synced first paragraph —
      // this is a real edit to an *existing* Y.XmlText, applied through the
      // agent's onMessage/syncProtocol path with a null (human) origin.
      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      ytext.insert(ytext.length, " ping @scribe please");

      const result = await agent.agentAwaitEvents(id, {});
      expect("events" in result).toBe(true);
      const events = "events" in result ? result.events : [];
      const mention = events.find((e) => e.type === "mention");
      expect(mention).toBeDefined();
      expect(mention).toMatchObject({
        type: "mention",
        payload: { agent: "scribe", text: expect.stringContaining("@scribe") },
      });
      expect(typeof mention?.seq).toBe("number");
      expect("cursor" in result && result.cursor).toBe(events[events.length - 1].seq);
      cleanup(client);
    });

    it("records exactly one mention when a human types @scribe one character at a time", async () => {
      const { agent, id } = await setup();
      const client = connectYjsClient(agent);

      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      // Real typing: one Yjs transaction per keystroke. No single delta op
      // ever contains "@scribe", so per-op matching never fires at all.
      for (const ch of " @scribe") {
        ytext.insert(ytext.length, ch);
      }

      const result = await agent.agentAwaitEvents(id, {});
      const events = "events" in result ? result.events : [];
      const mentions = events.filter((e) => e.type === "mention");
      expect(mentions).toHaveLength(1);
      expect(mentions[0].payload).toMatchObject({
        agent: "scribe",
        text: expect.stringContaining("@scribe"),
      });

      // Typing on in the same block must not re-fire the same mention.
      const cursor = "cursor" in result ? result.cursor : 0;
      for (const ch of ", please") {
        ytext.insert(ytext.length, ch);
      }
      const second = await agent.agentAwaitEvents(id, { cursor, timeoutMs: 20 });
      const secondEvents = "events" in second ? second.events : [];
      expect(secondEvents.filter((e) => e.type === "mention")).toHaveLength(0);

      cleanup(client);
    });

    it("re-fires a mention after it is deleted and retyped", async () => {
      const { agent, id } = await setup();
      const client = connectYjsClient(agent);

      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      const base = ytext.length;
      for (const ch of " @scribe") {
        ytext.insert(ytext.length, ch);
      }
      const first = await agent.agentAwaitEvents(id, {});
      const cursor = "cursor" in first ? first.cursor : 0;

      ytext.delete(base, ytext.length - base);
      for (const ch of " @scribe") {
        ytext.insert(ytext.length, ch);
      }

      const second = await agent.agentAwaitEvents(id, { cursor });
      const mentions = ("events" in second ? second.events : []).filter(
        (e) => e.type === "mention",
      );
      expect(mentions).toHaveLength(1);
      cleanup(client);
    });

    it("records no events at all while the roster is empty", async () => {
      const agent = makeAgent();
      await agent.onRequest(new Request("https://do/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hello there." }),
      }));
      const client = connectYjsClient(agent);

      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      ytext.insert(ytext.length, " a human edit");

      // doc_changed digests used to be recorded above the roster check, so
      // every agentless document accrued rows nobody could ever read.
      expect(mockTables.get("events") ?? []).toEqual([]);

      // With an agent on the roster, the digest is recorded as before.
      await agent.agentJoin(identity());
      ytext.insert(ytext.length, " and another");
      expect((mockTables.get("events") ?? []).map((r) => r.type)).toContain("doc_changed");

      cleanup(client);
    });

    it("delivers a mention only to the agent it names", async () => {
      const { agent, id } = await setup();
      const museId = identity({ id: "email:muse@x.com", name: "muse" });

      const client = connectYjsClient(agent);
      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      for (const ch of " @scribe") {
        ytext.insert(ytext.length, ch);
      }

      const forScribe = await agent.agentAwaitEvents(id, {});
      const scribeEvents = "events" in forScribe ? forScribe.events : [];
      expect(scribeEvents.filter((e) => e.type === "mention")).toHaveLength(1);

      const forMuse = await agent.agentAwaitEvents(museId, { timeoutMs: 20 });
      const museEvents = "events" in forMuse ? forMuse.events : [];
      expect(museEvents.some((e) => e.type === "mention")).toBe(false);
      // The broadcast digest still reaches everyone.
      expect(museEvents.some((e) => e.type === "doc_changed")).toBe(true);
      // ...and muse's cursor advanced past scribe's mention regardless.
      expect("cursor" in forMuse && forMuse.cursor).toBe(
        "cursor" in forScribe ? forScribe.cursor : -1,
      );

      cleanup(client);
    });

    it("delivers a thread_reply only to the agent that authored the thread", async () => {
      const { agent, id } = await setup(["comment"]);
      const museId = identity({ id: "email:muse@x.com", name: "muse", caps: ["comment"] });

      const read = await agent.agentRead(id);
      const anchor = ("blocks" in read ? read.blocks : [])[0].anchor;
      const created = await agent.agentComment(id, { anchor, text: "needs work" });
      const threadId = "threadId" in created ? created.threadId : "";

      const client = connectYjsClient(agent);
      const threadsMap = client.doc.getMap<string>("threads");
      const thread = JSON.parse(threadsMap.get(threadId)!);
      thread.replies.push({
        id: "r1",
        author: { name: "Nick", color: "#000", colorLight: "#000" },
        text: "thanks!",
        createdAt: Date.now(),
      });
      threadsMap.set(threadId, JSON.stringify(thread));

      const forScribe = await agent.agentAwaitEvents(id, {});
      expect(("events" in forScribe ? forScribe.events : []).some((e) => e.type === "thread_reply"))
        .toBe(true);

      const forMuse = await agent.agentAwaitEvents(museId, { timeoutMs: 20 });
      expect(("events" in forMuse ? forMuse.events : []).some((e) => e.type === "thread_reply"))
        .toBe(false);

      cleanup(client);
    });

    it("resolves empty after the timeout when no events occur (fake timers)", async () => {
      const { agent, id } = await setup();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const promise = agent.agentAwaitEvents(id, { timeoutMs: 50 });
      await waitForTimerRegistered();
      await vi.advanceTimersByTimeAsync(50);
      const result = await promise;

      expect(result).toEqual({ events: [], cursor: 0, retryAfterMs: 30_000 });
    });

    it("excludes already-seen events once the cursor advances past them", async () => {
      const { agent, id } = await setup();
      const client = connectYjsClient(agent);

      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      ytext.insert(ytext.length, " ping @scribe please");

      const first = await agent.agentAwaitEvents(id, {});
      const cursor = "cursor" in first ? first.cursor : -1;
      expect(cursor).toBeGreaterThan(0);

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const secondPromise = agent.agentAwaitEvents(id, { cursor, timeoutMs: 50 });
      await waitForTimerRegistered();
      await vi.advanceTimersByTimeAsync(50);
      const second = await secondPromise;

      expect(second).toEqual({ events: [], cursor, retryAfterMs: 30_000 });
      cleanup(client);
    });

    it("round-trips a comment and reply, and records a thread_reply event for a human reply", async () => {
      const { agent, id } = await setup(["comment"]);
      const read = await agent.agentRead(id);
      const anchor = ("blocks" in read ? read.blocks : [])[0].anchor;

      const created = await agent.agentComment(id, { anchor, quote: "Hello", text: "needs work" });
      expect("threadId" in created).toBe(true);
      const threadId = "threadId" in created ? created.threadId : "";

      const afterCreate = await agent.agentRead(id);
      const threads = "threads" in afterCreate ? afterCreate.threads : [];
      expect(threads).toHaveLength(1);
      expect(threads[0]).toMatchObject({
        id: threadId,
        commentText: "needs work",
        highlightText: "Hello",
        author: { name: "scribe" },
        resolved: false,
        replies: [],
      });

      // A human replies directly on the shared Y.Map, the same way
      // useThreads.addReply does client-side (an untagged — human-origin —
      // transaction).
      const client = connectYjsClient(agent);
      const threadsMap = client.doc.getMap<string>("threads");
      const raw = threadsMap.get(threadId)!;
      const thread = JSON.parse(raw);
      thread.replies.push({
        id: "r1",
        author: { name: "Nick", color: "#000", colorLight: "#000" },
        text: "thanks!",
        createdAt: Date.now(),
      });
      threadsMap.set(threadId, JSON.stringify(thread));

      const result = await agent.agentAwaitEvents(id, {});
      const events = "events" in result ? result.events : [];
      const threadReply = events.find((e) => e.type === "thread_reply");
      expect(threadReply).toMatchObject({
        type: "thread_reply",
        payload: { agent: "scribe", threadId },
      });

      cleanup(client);
    });

    it("agentComment requires the comment capability", async () => {
      const { agent, id } = await setup([]);
      const read = await agent.agentRead(id);
      const anchor = ("blocks" in read ? read.blocks : [])[0].anchor;
      const result = await agent.agentComment(id, { anchor, text: "hi" });
      expect(result).toMatchObject({ error: { code: "capability_denied" } });
    });

    it("agentReply appends a reply, attributed to the replying agent", async () => {
      const { agent, id } = await setup(["comment"]);
      const read = await agent.agentRead(id);
      const anchor = ("blocks" in read ? read.blocks : [])[0].anchor;
      const created = await agent.agentComment(id, { anchor, text: "hi" });
      const threadId = "threadId" in created ? created.threadId : "";

      const result = await agent.agentReply(id, { threadId, text: "reply text" });
      expect(result).toEqual({ ok: true });

      const after = await agent.agentRead(id);
      const threads = "threads" in after ? after.threads : [];
      expect(threads[0].replies).toHaveLength(1);
      expect(threads[0].replies[0]).toMatchObject({ text: "reply text", author: { name: "scribe" } });
    });

    it("agentReply returns thread_not_found for an unknown thread", async () => {
      const { agent, id } = await setup(["comment"]);
      const result = await agent.agentReply(id, { threadId: "nope", text: "x" });
      expect(result).toMatchObject({ error: { code: "thread_not_found" } });
    });

    it("records a thread_reply event only when a reply is actually added, not on a resolve toggle", async () => {
      const { agent, id } = await setup(["comment"]);
      const read = await agent.agentRead(id);
      const anchor = ("blocks" in read ? read.blocks : [])[0].anchor;
      const created = await agent.agentComment(id, { anchor, text: "needs work" });
      const threadId = "threadId" in created ? created.threadId : "";

      const client = connectYjsClient(agent);
      const threadsMap = client.doc.getMap<string>("threads");

      // Human resolves the thread (no reply added) — an untagged, human-
      // origin edit to an agent-authored thread that must NOT be mistaken
      // for a reply.
      const beforeResolve = JSON.parse(threadsMap.get(threadId)!);
      threadsMap.set(threadId, JSON.stringify({ ...beforeResolve, resolved: true }));

      const afterResolve = await agent.agentAwaitEvents(id, { timeoutMs: 20 });
      const eventsAfterResolve = "events" in afterResolve ? afterResolve.events : [];
      expect(eventsAfterResolve.some((e) => e.type === "thread_reply")).toBe(false);
      const cursorAfterResolve = "cursor" in afterResolve ? afterResolve.cursor : 0;

      // Now a real reply is added.
      const beforeReply = JSON.parse(threadsMap.get(threadId)!);
      beforeReply.replies.push({
        id: "r1",
        author: { name: "Nick", color: "#000", colorLight: "#000" },
        text: "thanks!",
        createdAt: Date.now(),
      });
      threadsMap.set(threadId, JSON.stringify(beforeReply));

      const afterReply = await agent.agentAwaitEvents(id, { cursor: cursorAfterResolve });
      const eventsAfterReply = "events" in afterReply ? afterReply.events : [];
      const threadReplyEvents = eventsAfterReply.filter((e) => e.type === "thread_reply");
      expect(threadReplyEvents).toHaveLength(1);
      expect(threadReplyEvents[0]).toMatchObject({ payload: { agent: "scribe", threadId } });

      cleanup(client);
    });

    it("agentComment and agentReply are rate-limited like the other mutation RPCs", async () => {
      const { agent, id } = await setup(["comment"]);
      const read = await agent.agentRead(id);
      const anchor = ("blocks" in read ? read.blocks : [])[0].anchor;

      // Pre-fill this agent's rate-limit log at the per-minute mutation
      // cap, driving checkRateLimit's denial path directly rather than via
      // 10 real calls.
      const rosterRows = mockTables.get("roster") ?? [];
      const row = rosterRows.find((r) => r.name === "scribe")!;
      const now = Date.now();
      row.recent_mutations = JSON.stringify(
        Array.from({ length: 10 }, () => ({ at: now, chars: 1 })),
      );

      const commentResult = await agent.agentComment(id, { anchor, text: "hi" });
      expect(commentResult).toMatchObject({ error: { code: "rate_limited" } });

      const replyResult = await agent.agentReply(id, { threadId: "whatever", text: "hi" });
      expect(replyResult).toMatchObject({ error: { code: "rate_limited" } });
    });

    it("prunes events on doc expiry (alarm)", async () => {
      const { agent, id } = await setup();
      const client = connectYjsClient(agent);
      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      ytext.insert(ytext.length, " ping @scribe please");
      await agent.agentAwaitEvents(id, {});
      cleanup(client);

      await agent.alarm();

      expect(mockTables.get("events") ?? []).toEqual([]);
    });
  });
});
