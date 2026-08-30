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
import type { AgentCapability } from "~/shared/agent-protocol";

/* ------------------------------------------------------------------ */
/*  Mock Agent base class                                              */
/* ------------------------------------------------------------------ */

let mockSqlStore: Map<string, ArrayBuffer>;
let mockConnectionMap: Map<string, MockConnection>;
let mockSetAlarm: ReturnType<typeof vi.fn>;
/**
 * Generic in-memory table store for tables other than `doc_state`
 * (currently `agent_tokens`; later tasks add `performances`/`events`).
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
          const whereMatch = /where\s+(\w+)\s*=/i.exec(raw);
          let result = whereMatch
            ? rows.filter((row) => row[whereMatch[1]] === values[0])
            : rows;

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

    it("imports multiline content as separate paragraphs", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "line one\nline two\nline three" }),
        }),
      );

      const client = connectYjsClient();
      expect(client.doc.getXmlFragment("default").length).toBe(3);
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

    it("returns 400 for unsupported CriticMarkup (substitution)", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello {~~old~>new~~}" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain("Unsupported CriticMarkup");
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
  /*  Agent token roster                                               */
  /* ================================================================ */

  describe("agent roster", () => {
    /** verifyAgentToken is private on DocumentAgent; cast to call it from tests. */
    function asVerifier(a: InstanceType<typeof DocumentAgent>) {
      return a as unknown as {
        verifyAgentToken(
          token: string,
          needs?: string,
        ): Promise<{ entry: unknown } | { error: { code: string } }>;
      };
    }

    it("mints, lists, verifies capability, revokes", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      const minted = await agent.mintAgentToken({ name: "scribe" });
      expect("token" in minted && minted.token).toMatch(/^vpr_/);
      expect((await agent.getAgentRoster())[0]).toMatchObject({
        name: "scribe",
        capabilities: ["suggest", "comment"],
      });

      // Default grant lacks write.
      const v = await asVerifier(agent).verifyAgentToken(
        (minted as { token: string }).token,
        "write",
      );
      expect(v).toMatchObject({ error: { code: "capability_denied" } });

      await agent.revokeAgentToken("scribe");
      expect(await agent.getAgentRoster()).toHaveLength(0);
    });

    it("rejects bad names and duplicates", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      expect(await agent.mintAgentToken({ name: "Bad Name" })).toMatchObject({
        error: { code: "invalid_name" },
      });

      await agent.mintAgentToken({ name: "scribe" });
      expect(await agent.mintAgentToken({ name: "scribe" })).toMatchObject({
        error: { code: "invalid_name" },
      });
    });

    it("returns doc_not_found when minting before the doc exists", async () => {
      expect(await agent.mintAgentToken({ name: "scribe" })).toMatchObject({
        error: { code: "doc_not_found" },
      });
    });

    it("returns invalid_token for an unknown token", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const v = await asVerifier(agent).verifyAgentToken("vpr_nonexistent");
      expect(v).toMatchObject({ error: { code: "invalid_token" } });
    });

    it("verifies a granted capability and updates lastSeenAt", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const minted = await agent.mintAgentToken({ name: "scribe" });
      const token = (minted as { token: string }).token;

      const v = await asVerifier(agent).verifyAgentToken(token, "suggest");
      expect(v).toMatchObject({ entry: { name: "scribe" } });

      const [entry] = await agent.getAgentRoster();
      expect(entry.lastSeenAt).not.toBeNull();
    });

    it("assigns roster colors round-robin by roster size", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      await agent.mintAgentToken({ name: "first" });
      await agent.mintAgentToken({ name: "second" });

      const roster = await agent.getAgentRoster();
      expect(roster[0].color).not.toBe(roster[1].color);
    });

    it("clears the roster and invalidates tokens on doc expiry (alarm)", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const minted = await agent.mintAgentToken({ name: "scribe" });
      const token = (minted as { token: string }).token;

      await agent.alarm();

      expect(await agent.getAgentRoster()).toEqual([]);
      const v = await asVerifier(agent).verifyAgentToken(token);
      expect(v).toMatchObject({ error: { code: "invalid_token" } });
    });
  });

  /* ================================================================ */
  /*  Agent read + instant mutations                                   */
  /* ================================================================ */

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

    it("rejects an inverted range when to resolves before from", async () => {
      const { agent, token } = await setup(["write"]);
      // Append two blocks with identical text ("Same") so they share a
      // content hash. resolveAnchor's nearest-index heuristic then lets us
      // pick out either occurrence by fabricating an anchor whose *stated*
      // index is far from one occurrence and close to the other.
      await agent.agentInsert(token, { where: "append", markdown: "Same\nOther\nSame\nEnd" });

      const before = await agent.agentRead(token);
      const beforeMarkdown = "markdown" in before ? before.markdown : "";
      const blocks = "blocks" in before ? before.blocks : [];
      const sameBlocks = blocks.filter((b) => b.text === "Same");
      expect(sameBlocks).toHaveLength(2); // real indices 3 and 5

      const hash = sameBlocks[0].anchor.split("-")[1];
      // "from" resolves to the later occurrence (nearest to stated index 100).
      const fromAnchor = `b100-${hash}`;
      // "to" resolves to the earlier occurrence (nearest to stated index 0).
      const toAnchor = `b0-${hash}`;

      const result = await agent.agentReplace(token, { from: fromAnchor, to: toAnchor, markdown: "Nope" });
      expect(result).toMatchObject({ error: { code: "stale_anchor" } });

      const after = await agent.agentRead(token);
      expect("markdown" in after && after.markdown).toBe(beforeMarkdown);
    });
  });
});
