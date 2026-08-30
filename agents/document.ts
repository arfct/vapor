import { Agent } from "agents";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS, DOCUMENT_TTL_MS, DOC_FORMAT_VERSION, USER_COLOURS } from "../app/shared/constants";
import type { AgentCapability, AgentRosterEntry, AgentError, Pace } from "../app/shared/agent-protocol";
import {
  AGENT_NAME_RE,
  DEFAULT_CAPABILITIES,
  formatAnchor,
  RATE_LIMIT_MUTATIONS_PER_MIN,
  RATE_LIMIT_CHARS_PER_HOUR,
} from "../app/shared/agent-protocol";
import { generateAgentToken, hashToken } from "../app/lib/agent-tokens";
import { getBlocks, yDocToMarkdown, resolveAnchor, insertMarkdownBlocks, deleteBlocks } from "../app/lib/y-markdown";
import type { ThreadData } from "../app/shared/types";

/**
 * Durable Objects SQLite accepts Uint8Array for BLOB columns via the
 * template literal API, but the type signature expects string. This
 * helper makes the cast explicit and grep-able.
 */
function sqlBlob(data: Uint8Array): string {
  return data as unknown as string;
}

interface AgentTokenRow {
  token_hash: string;
  name: string;
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

function rowToRosterEntry(row: AgentTokenRow): AgentRosterEntry {
  return {
    name: row.name,
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
      CREATE TABLE IF NOT EXISTS agent_tokens (
        token_hash TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        color TEXT,
        owner TEXT,
        capabilities TEXT,
        created_at INTEGER,
        last_seen_at INTEGER,
        recent_mutations TEXT
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

    // Persist on every update
    this.doc.on("update", () => {
      const state = Y.encodeStateAsUpdate(this.doc!);
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('state', ${sqlBlob(state)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
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
  }

  override readonly alarm = async (): Promise<void> => {
    // Auto-delete: remove all document data
    this.sql`DELETE FROM doc_state`;
    // Revoke every minted agent token along with the document — a token
    // must not stay valid against whatever content lands at this doc id
    // if it's recreated after expiry.
    this.sql`DELETE FROM agent_tokens`;
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
          if (body.content) {
            // Parse CriticMarkup and apply as marks on XmlText
            const { parseCriticMarkupToContent } = await import("../app/lib/critic-parser");
            const frag = doc.getXmlFragment("default");
            if (frag.length === 0) {
              const lines = body.content.split("\n");
              for (const line of lines) {
                const { cleanText, marks } = parseCriticMarkupToContent(line);
                const para = new Y.XmlElement("paragraph");
                const ytext = new Y.XmlText(cleanText);
                // Apply marks via Yjs formatting attributes
                for (const mark of marks) {
                  const attrs: Record<string, Record<string, unknown>> = {};
                  attrs[mark.type] = mark.attrs ?? {};
                  ytext.format(mark.from, mark.to - mark.from, attrs);
                }
                para.insert(0, [ytext]);
                frag.insert(frag.length, [para]);
              }
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
        } catch (err) {
          // If it's an unsupported CriticMarkup error, return it
          if (err instanceof Error && err.message.includes("Unsupported CriticMarkup")) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          // Ignore other malformed JSON — document is still created
        }
      }

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
   * Mints a new agent token for this document, assigning it a slug name,
   * a roster color (round-robin over USER_COLOURS), and a set of
   * capabilities. Only the SHA-256 hash of the token is stored.
   */
  async mintAgentToken(opts: {
    name: string;
    owner?: string;
    capabilities?: AgentCapability[];
  }): Promise<{ token: string; entry: AgentRosterEntry } | { error: AgentError }> {
    this.ensureInitialised();

    if (!this.docExists()) {
      return { error: { code: "doc_not_found", message: "Document does not exist" } };
    }

    if (!AGENT_NAME_RE.test(opts.name)) {
      return {
        error: { code: "invalid_name", message: `Invalid agent name: ${opts.name}` },
      };
    }

    const existing = this.sql<{ name: string }>`
      SELECT name FROM agent_tokens WHERE name = ${opts.name}
    `;
    if (existing.length > 0) {
      return {
        error: { code: "invalid_name", message: `Agent name already taken: ${opts.name}` },
      };
    }

    const roster = this.sql<{ name: string }>`SELECT name FROM agent_tokens`;
    const color = USER_COLOURS[roster.length % USER_COLOURS.length].color;

    const token = generateAgentToken();
    const tokenHash = await hashToken(token);
    const capabilities = opts.capabilities ?? DEFAULT_CAPABILITIES;
    const owner = opts.owner ?? null;
    const createdAt = Date.now();

    this.sql`
      INSERT INTO agent_tokens (token_hash, name, color, owner, capabilities, created_at, last_seen_at)
      VALUES (${tokenHash}, ${opts.name}, ${color}, ${owner}, ${JSON.stringify(capabilities)}, ${createdAt}, ${null})
    `;

    return {
      token,
      entry: {
        name: opts.name,
        color,
        owner,
        capabilities,
        createdAt,
        lastSeenAt: null,
      },
    };
  }

  /** Lists all agents minted for this document, oldest first. */
  async getAgentRoster(): Promise<AgentRosterEntry[]> {
    this.ensureInitialised();
    const rows = this.sql<AgentTokenRow>`
      SELECT * FROM agent_tokens ORDER BY created_at ASC
    `;
    return rows.map(rowToRosterEntry);
  }

  /** Revokes an agent's token by name. Idempotent. */
  async revokeAgentToken(name: string): Promise<{ ok: true } | { error: AgentError }> {
    this.ensureInitialised();
    this.sql`DELETE FROM agent_tokens WHERE name = ${name}`;
    return { ok: true };
  }

  /**
   * Verifies a presented agent token, optionally checking it carries a
   * needed capability. `read` is implied by any valid token and is never
   * stored in `capabilities`, so omit `needs` to check validity only.
   * Updates `last_seen_at` on success. Used internally by every
   * agent-facing RPC method.
   */
  private async verifyAgentToken(
    token: string,
    needs?: AgentCapability,
  ): Promise<{ entry: AgentRosterEntry } | { error: AgentError }> {
    this.ensureInitialised();

    const tokenHash = await hashToken(token);
    const rows = this.sql<AgentTokenRow>`
      SELECT * FROM agent_tokens WHERE token_hash = ${tokenHash}
    `;
    if (rows.length === 0) {
      return { error: { code: "invalid_token", message: "Invalid or unknown agent token" } };
    }

    const row = rows[0];
    const capabilities = JSON.parse(row.capabilities) as AgentCapability[];
    if (needs && !capabilities.includes(needs)) {
      return {
        error: { code: "capability_denied", message: `Agent lacks capability: ${needs}` },
      };
    }

    const now = Date.now();
    this.sql`UPDATE agent_tokens SET last_seen_at = ${now} WHERE token_hash = ${tokenHash}`;

    return { entry: rowToRosterEntry({ ...row, last_seen_at: now }) };
  }

  /**
   * Checks and records rate-limit usage for a token ahead of a mutation of
   * `chars` characters. Denies with `rate_limited` when the token has made
   * more than `RATE_LIMIT_MUTATIONS_PER_MIN` mutations in the last 60s, or
   * written more than `RATE_LIMIT_CHARS_PER_HOUR` characters in the last
   * hour. On success, records this attempt. The log is pruned to the last
   * hour on every check regardless of outcome.
   */
  private async checkRateLimit(token: string, chars: number): Promise<{ error: AgentError } | null> {
    const tokenHash = await hashToken(token);
    const rows = this.sql<{ recent_mutations: string | null }>`
      SELECT recent_mutations FROM agent_tokens WHERE token_hash = ${tokenHash}
    `;

    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const minuteAgo = now - 60 * 1000;

    const raw = rows[0]?.recent_mutations;
    const log = (raw ? JSON.parse(raw) : []) as MutationLogEntry[];
    const pruned = log.filter((e) => e.at > hourAgo);

    const recentCount = pruned.filter((e) => e.at > minuteAgo).length;
    const totalChars = pruned.reduce((sum, e) => sum + e.chars, 0);

    if (recentCount >= RATE_LIMIT_MUTATIONS_PER_MIN || totalChars + chars > RATE_LIMIT_CHARS_PER_HOUR) {
      this.sql`UPDATE agent_tokens SET recent_mutations = ${JSON.stringify(pruned)} WHERE token_hash = ${tokenHash}`;
      return { error: { code: "rate_limited", message: "Agent mutation rate limit exceeded" } };
    }

    pruned.push({ at: now, chars });
    this.sql`UPDATE agent_tokens SET recent_mutations = ${JSON.stringify(pruned)} WHERE token_hash = ${tokenHash}`;
    return null;
  }

  /**
   * Returns the document's full markdown, per-block anchors, current
   * presence (humans from awareness, agents from the roster), and comment
   * threads. Any valid token can read; no capability is required.
   */
  async agentRead(token: string): Promise<
    | {
        markdown: string;
        blocks: { anchor: string; text: string }[];
        presence: { name: string; isAgent: boolean }[];
        threads: ThreadData[];
      }
    | { error: AgentError }
  > {
    const verified = await this.verifyAgentToken(token);
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
        presence.push({ name: entry.name, isAgent: true });
      }
    }

    const threadsMap = doc.getMap<string>("threads");
    const threads: ThreadData[] = [];
    threadsMap.forEach((value) => {
      threads.push(JSON.parse(value) as ThreadData);
    });

    return { markdown, blocks, presence, threads };
  }

  /**
   * Inserts markdown as new blocks. `where: "append"` needs no anchor;
   * otherwise the anchor is resolved and the blocks are inserted directly
   * before or after it. Requires `write`.
   */
  async agentInsert(
    token: string,
    args: { anchor?: string; where: "before" | "after" | "append"; markdown: string; pace?: Pace },
  ): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyAgentToken(token, "write");
    if ("error" in verified) return verified;

    const rateLimited = await this.checkRateLimit(token, args.markdown.length);
    if (rateLimited) return rateLimited;

    const { doc } = this.ensureInitialised();

    let index: number;
    if (args.where === "append") {
      index = getBlocks(doc).length;
    } else {
      if (!args.anchor) {
        return {
          error: { code: "stale_anchor", message: `An anchor is required for where: "${args.where}"` },
        };
      }
      const resolved = resolveAnchor(doc, args.anchor);
      if ("error" in resolved) {
        return { error: { code: resolved.error, message: "Anchor not found", snippet: resolved.snippet } };
      }
      index = args.where === "before" ? resolved.index : resolved.index + 1;
    }

    doc.transact(() => {
      insertMarkdownBlocks(doc, index, args.markdown);
    });

    return { ok: true };
  }

  /**
   * Replaces the block range [from, to] (anchors, `to` defaults to `from`)
   * with new markdown, in one transaction. Requires `write`.
   */
  async agentReplace(
    token: string,
    args: { from: string; to?: string; markdown: string; pace?: Pace },
  ): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyAgentToken(token, "write");
    if ("error" in verified) return verified;

    const rateLimited = await this.checkRateLimit(token, args.markdown.length);
    if (rateLimited) return rateLimited;

    const { doc } = this.ensureInitialised();

    const fromResolved = resolveAnchor(doc, args.from);
    if ("error" in fromResolved) {
      return { error: { code: fromResolved.error, message: "Anchor not found", snippet: fromResolved.snippet } };
    }
    const toResolved = resolveAnchor(doc, args.to ?? args.from);
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

    doc.transact(() => {
      deleteBlocks(doc, fromIndex, toIndex);
      insertMarkdownBlocks(doc, fromIndex, args.markdown);
    });

    return { ok: true };
  }

  /**
   * Suggests a replacement inside a block: marks `find` as a critic
   * deletion and inserts `replacement` as a critic addition, mirroring the
   * marks TipTap's suggest-mode plugin applies for human edits (no
   * author-metadata attrs — see app/lib/suggest-mode.ts). Requires
   * `suggest`.
   */
  async agentSuggest(
    token: string,
    args: { anchor: string; find: string; replacement: string; pace?: Pace },
  ): Promise<{ ok: true } | { error: AgentError }> {
    const verified = await this.verifyAgentToken(token, "suggest");
    if ("error" in verified) return verified;

    const rateLimited = await this.checkRateLimit(token, args.find.length + args.replacement.length);
    if (rateLimited) return rateLimited;

    const { doc } = this.ensureInitialised();

    const resolved = resolveAnchor(doc, args.anchor);
    if ("error" in resolved) {
      return { error: { code: resolved.error, message: "Anchor not found", snippet: resolved.snippet } };
    }

    const frag = doc.getXmlFragment("default");
    const el = frag.get(resolved.index);
    const ytext = el instanceof Y.XmlElement
      ? el.toArray().find((child): child is Y.XmlText => child instanceof Y.XmlText)
      : undefined;

    const block = getBlocks(doc)[resolved.index];
    if (!ytext) {
      return { error: { code: "find_not_matched", message: "Block has no text", snippet: block?.text ?? "" } };
    }

    const cleanText = (ytext.toDelta() as { insert: string }[]).map((op) => op.insert).join("");
    const pos = cleanText.indexOf(args.find);
    if (pos === -1) {
      return {
        error: { code: "find_not_matched", message: "Could not find text to suggest a change on", snippet: block.text },
      };
    }

    doc.transact(() => {
      ytext.format(pos, args.find.length, { criticDeletion: {} });
      ytext.insert(pos + args.find.length, args.replacement, { criticAddition: {} });
    });

    return { ok: true };
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
