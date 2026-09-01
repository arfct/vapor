/**
 * The MCP tool table: one entry per document tool in the agent-collaborators
 * spec, each mapping tool arguments onto a `DocumentAgent` agent* RPC.
 *
 * This module deliberately imports nothing from the `agents` package (which
 * uses `cloudflare:` protocol imports) so it stays unit-testable in plain
 * Vitest. `agents/mcp.ts` supplies the real stubs and verified identity.
 */
import { z } from "zod";
import { isValidDocumentId } from "../app/shared/constants";
import { slugifyAgentName, blockHash, type AgentError, type AgentIdentity } from "../app/shared/agent-protocol";
import { ANON_ANIMALS } from "../app/shared/anon-animals";

/** The subset of the DocumentAgent RPC surface the tools call. */
export interface DocStub {
  agentRead(identity: AgentIdentity): Promise<unknown>;
  agentInsert(identity: AgentIdentity, args: unknown): Promise<unknown>;
  agentReplace(identity: AgentIdentity, args: unknown): Promise<unknown>;
  agentSuggest(identity: AgentIdentity, args: unknown): Promise<unknown>;
  agentComment(identity: AgentIdentity, args: unknown): Promise<unknown>;
  agentReply(identity: AgentIdentity, args: unknown): Promise<unknown>;
  agentJoin(identity: AgentIdentity, status?: string): Promise<unknown>;
  agentLeave(identity: AgentIdentity): Promise<unknown>;
  agentAwaitEvents(identity: AgentIdentity, args: unknown): Promise<unknown>;
  eventsList(identity: AgentIdentity): Promise<unknown>;
  eventsPoll(identity: AgentIdentity, args: unknown): Promise<unknown>;
  eventsSubscribe(identity: AgentIdentity, args: unknown): Promise<unknown>;
  eventsUnsubscribe(identity: AgentIdentity, args: unknown): Promise<unknown>;
}

export interface ToolDeps {
  /** Resolves a document id to its DocumentAgent stub. */
  getStub(docId: string): Promise<DocStub>;
  /** The verified identity of the caller (principal or anonymous session). */
  identity: AgentIdentity;
}

/** A zod raw shape, as `McpServer.registerTool` accepts for `inputSchema`. */
export type ToolSchema = Record<string, z.ZodType>;

export interface ToolDef {
  name: string;
  description: string;
  schema: ToolSchema;
  run(deps: ToolDeps, args: Record<string, unknown>): Promise<unknown>;
}

/** Errors are return values, never throws — same convention as the RPCs. */
function errorResult(code: AgentError["code"], message: string): { error: AgentError } {
  return { error: { code, message } };
}

/** Matches MAX_CONTENT_BYTES in app/routes/new.ts — the same document store. */
const MAX_CONTENT_BYTES = 1_000_000; // 1 MB

/**
 * Guards for markdown handed to create_document, mirroring the checks POST
 * /new applies to an uploaded file: a size ceiling, and a NUL-byte check that
 * catches a binary file pasted in as if it were text. Lives here (rather than
 * inline in agents/mcp.ts, which can't be imported in plain Vitest) so it can
 * be tested directly. Returns null when the markdown is acceptable.
 */
export function validateNewDocumentMarkdown(
  markdown: string | undefined,
): { error: AgentError } | null {
  if (markdown === undefined) return null;
  if (markdown.length > MAX_CONTENT_BYTES) {
    return errorResult("rate_limited", "markdown too large (max 1MB)");
  }
  if (markdown.includes("\0")) {
    return errorResult("unsupported_markup", "content appears to be binary, not text");
  }
  return null;
}

/**
 * The base agent name create_document enrolls its creator under, derived
 * from the connecting MCP client's declared name — the same rule the
 * anonymous identity path uses for the same reason:
 * "agent" for every client made every doc's first collaborator look
 * identical, with no way to tell which client created it. Lives here
 * (rather than inline in agents/mcp.ts, which can't be imported in plain
 * Vitest) so the naming rule is unit-testable directly.
 */
export function createDocumentAgentName(clientName: string | undefined): string {
  return slugifyAgentName(clientName ?? "agent");
}

/**
 * Display label for an anonymous agent: "Agentic <Animal>", with the animal
 * picked deterministically from the MCP session key so the same session is
 * the same creature in every document and on every call.
 */
export function anonymousAgentLabel(sessionKey: string): string {
  const index = parseInt(blockHash(sessionKey), 16) % ANON_ANIMALS.length;
  return `Agentic ${ANON_ANIMALS[index].name}`;
}

const docId = z.string().describe("The 8-character document id (from its URL).");
const pace = z
  .enum(["natural", "fast", "instant"])
  .optional()
  .describe("How the edit is performed: natural (human-paced typing), fast, or instant.");
const anchorDesc =
  "A block anchor from read_document, e.g. k3f0a9x2-a91f0c2d: a persistent block id plus the block's content hash. The id survives edits; a changed hash returns stale_block with the block's current state so you can retry without a full re-read.";

/**
 * Builds a tool that resolves `doc_id` to a stub before calling an RPC.
 * A malformed id is rejected without touching a Durable Object.
 */
function docTool(spec: {
  name: string;
  description: string;
  schema: ToolSchema;
  call(stub: DocStub, identity: AgentIdentity, args: Record<string, unknown>): Promise<unknown>;
}): ToolDef {
  return {
    name: spec.name,
    description: spec.description,
    schema: { doc_id: docId, ...spec.schema },
    async run(deps, args) {
      const id = args.doc_id;
      if (typeof id !== "string" || !isValidDocumentId(id)) {
        return errorResult("doc_not_found", `Not a valid document id: ${String(id)}`);
      }
      const stub = await deps.getStub(id);
      return spec.call(stub, deps.identity, args);
    },
  };
}

export const TOOLS: ToolDef[] = [
  docTool({
    name: "read_document",
    description:
      "Read a vapor document: its full markdown, per-block anchors for editing, who is present, and open comment threads.",
    schema: {},
    call: (stub, identity) => stub.agentRead(identity),
  }),

  docTool({
    name: "insert",
    description:
      "Insert markdown as new blocks, before or after an anchored block, or appended to the end of the document. Requires the write capability.",
    schema: {
      anchor: z.string().optional().describe(`${anchorDesc} Required unless where is "append".`),
      where: z.enum(["before", "after", "append"]).describe("Where to insert relative to anchor."),
      markdown: z.string().describe("The markdown to insert."),
      pace,
    },
    call: (stub, identity, args) =>
      stub.agentInsert(identity, {
        anchor: args.anchor as string | undefined,
        where: args.where as "before" | "after" | "append",
        markdown: args.markdown as string,
        pace: args.pace as string | undefined,
      }),
  }),

  docTool({
    name: "replace",
    description:
      "Replace a range of blocks with new markdown, in one transaction. Requires the write capability.",
    schema: {
      from_anchor: z.string().describe(`First block to replace. ${anchorDesc}`),
      to_anchor: z
        .string()
        .optional()
        .describe(`Last block to replace; defaults to from_anchor. ${anchorDesc}`),
      markdown: z.string().describe("The markdown that replaces the range."),
      pace,
    },
    call: (stub, identity, args) =>
      stub.agentReplace(identity, {
        from: args.from_anchor as string,
        to: args.to_anchor as string | undefined,
        markdown: args.markdown as string,
        pace: args.pace as string | undefined,
      }),
  }),

  docTool({
    name: "suggest",
    description:
      "Suggest a change inside a block as tracked CriticMarkup: find is marked deleted and replacement is marked added, for a human to accept or reject. Requires the suggest capability.",
    schema: {
      anchor: z.string().describe(anchorDesc),
      find: z
        .string()
        .describe(
          "The exact PLAIN text within that block to replace — match against the block's rendered text, not its markdown syntax.",
        ),
      replacement: z.string().describe("The suggested replacement text (empty string to delete)."),
      pace,
    },
    call: (stub, identity, args) =>
      stub.agentSuggest(identity, {
        anchor: args.anchor as string,
        find: args.find as string,
        replacement: args.replacement as string,
        pace: args.pace as string | undefined,
      }),
  }),

  docTool({
    name: "comment",
    description:
      "Open a comment thread anchored to a block. Requires the comment capability.",
    schema: {
      anchor: z.string().describe(anchorDesc),
      quote: z.string().optional().describe("The text within the block the comment refers to."),
      text: z.string().describe("The comment body."),
    },
    call: (stub, identity, args) =>
      stub.agentComment(identity, {
        anchor: args.anchor as string,
        quote: args.quote as string | undefined,
        text: args.text as string,
      }),
  }),

  docTool({
    name: "reply",
    description: "Reply in an existing comment thread. Requires the comment capability.",
    schema: {
      thread_id: z.string().describe("The thread id, as returned by comment or read_document."),
      text: z.string().describe("The reply body."),
    },
    call: (stub, identity, args) =>
      stub.agentReply(identity, {
        threadId: args.thread_id as string,
        text: args.text as string,
      }),
  }),

  docTool({
    name: "join",
    description:
      "Appear in the document's presence stack as an agent, with an optional short activity status.",
    schema: {
      status: z.string().optional().describe('A short activity string, e.g. "drafting intro".'),
    },
    call: (stub, identity, args) => stub.agentJoin(identity, args.status as string | undefined),
  }),

  docTool({
    name: "leave",
    description: "Remove this agent's presence from the document.",
    schema: {},
    call: (stub, identity) => stub.agentLeave(identity),
  }),

  docTool({
    name: "await_events",
    description:
      "DEPRECATED — prefer events_poll (and events_subscribe for push). Long-polls for document events after a cursor; capped at 15s, empty results carry retryAfterMs.",
    schema: {
      since_cursor: z
        .number()
        .optional()
        .describe("Return events after this cursor; omit to get everything so far."),
      timeout_s: z
        .number()
        .optional()
        .describe("How long to wait for an event, in seconds (max 50)."),
    },
    call: (stub, identity, args) => {
      const timeoutS = args.timeout_s as number | undefined;
      return stub.agentAwaitEvents(identity, {
        cursor: args.since_cursor as number | undefined,
        timeoutMs: timeoutS === undefined ? undefined : timeoutS * 1000,
      });
    },
  }),

  docTool({
    name: "events_list",
    description:
      "List the document's event types (experimental — mirrors the draft MCP Events extension): name, delivery modes, argument and payload schemas. Use events_subscribe for webhook push or events_poll to pull.",
    schema: {},
    call: (stub, identity) => stub.eventsList(identity),
  }),

  docTool({
    name: "events_poll",
    description:
      "Poll one event type for occurrences after a cursor (experimental — mirrors the draft MCP Events extension). Returns events plus a new cursor; empty results include retryAfterMs — wait at least that long before polling again. Prefer events_subscribe when you have a webhook receiver.",
    schema: {
      name: z.string().describe("Event type name from events_list, e.g. mention."),
      cursor: z
        .string()
        .nullable()
        .optional()
        .describe("Opaque cursor from a previous poll; omit or null to start from the beginning of the document's log."),
      max_events: z.number().optional().describe("Cap on returned events (default 50, max 200)."),
    },
    call: (stub, identity, args) =>
      stub.eventsPoll(identity, {
        name: args.name as string,
        cursor: args.cursor as string | null | undefined,
        maxEvents: args.max_events as number | undefined,
      }),
  }),

  docTool({
    name: "events_subscribe",
    description:
      "Register a webhook for an event type (experimental — mirrors the draft MCP Events extension). The server POSTs each occurrence to your HTTPS URL, signed per Standard Webhooks with your whsec_ secret. Requires the authenticated /mcp door. Idempotent per (you, url, name): re-subscribing refreshes the TTL — which runs to the document's remaining lifetime by default — and reactivates a suspended subscription.",
    schema: {
      name: z.string().describe("Event type name from events_list, e.g. mention."),
      url: z.string().describe("HTTPS webhook URL to POST occurrences to."),
      secret: z
        .string()
        .describe("Client-generated Standard Webhooks secret: whsec_ + base64 of 24-64 random bytes. You verify deliveries with it."),
      ttl_ms: z
        .number()
        .nullable()
        .optional()
        .describe("Suggested subscription lifetime in ms; omit or null for the document's remaining lifetime."),
    },
    call: (stub, identity, args) =>
      stub.eventsSubscribe(identity, {
        name: args.name as string,
        url: args.url as string,
        secret: args.secret as string,
        ttlMs: args.ttl_ms as number | null | undefined,
      }),
  }),

  docTool({
    name: "events_unsubscribe",
    description:
      "Remove a webhook subscription created with events_subscribe (experimental — mirrors the draft MCP Events extension). Keyed by event name + url for the calling identity.",
    schema: {
      name: z.string().describe("Event type name the subscription was created for."),
      url: z.string().describe("The webhook URL the subscription delivers to."),
    },
    call: (stub, identity, args) =>
      stub.eventsUnsubscribe(identity, {
        name: args.name as string,
        url: args.url as string,
      }),
  }),
];
