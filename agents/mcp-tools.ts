/**
 * The MCP tool table: one entry per document tool in the agent-collaborators
 * spec, each mapping tool arguments onto a `DocumentAgent` agent* RPC.
 *
 * This module deliberately imports nothing from the `agents` package (which
 * uses `cloudflare:` protocol imports) so it stays unit-testable in plain
 * Vitest. `agents/mcp.ts` supplies the real stubs and bearer token.
 */
import { z } from "zod";
import { isValidDocumentId } from "../app/shared/constants";
import type { AgentError, AgentRosterEntry } from "../app/shared/agent-protocol";

/** The subset of the DocumentAgent RPC surface the tools call. */
export interface DocStub {
  agentRead(token: string): Promise<unknown>;
  agentInsert(token: string, args: unknown): Promise<unknown>;
  agentReplace(token: string, args: unknown): Promise<unknown>;
  agentSuggest(token: string, args: unknown): Promise<unknown>;
  agentComment(token: string, args: unknown): Promise<unknown>;
  agentReply(token: string, args: unknown): Promise<unknown>;
  agentJoin(token: string, status?: string): Promise<unknown>;
  agentLeave(token: string): Promise<unknown>;
  agentAwaitEvents(token: string, args: unknown): Promise<unknown>;
  /**
   * Mints an anonymous roster entry (DEFAULT_CAPABILITIES, owner null) for a
   * tokenless MCP session, retrying with `-2`, `-3`, … on a name collision.
   * Used only by the anonymous-mode wrapper in agents/mcp-anonymous.ts.
   */
  enrollAnonymousAgent(
    baseName: string,
  ): Promise<{ token: string; entry: AgentRosterEntry } | { error: AgentError }>;
}

export interface ToolDeps {
  /** Resolves a document id to its DocumentAgent stub. */
  getStub(docId: string): Promise<DocStub>;
  /** The bearer token presented on the MCP request. */
  token: string;
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

const docId = z.string().describe("The 8-character document id (from its URL).");
const pace = z
  .enum(["natural", "fast", "instant"])
  .optional()
  .describe("How the edit is performed: natural (human-paced typing), fast, or instant.");
const anchorDesc = "A block anchor from read_document, e.g. b3-a91f0c2d.";

/**
 * Builds a tool that resolves `doc_id` to a stub before calling an RPC.
 * A malformed id is rejected without touching a Durable Object.
 */
function docTool(spec: {
  name: string;
  description: string;
  schema: ToolSchema;
  call(stub: DocStub, token: string, args: Record<string, unknown>): Promise<unknown>;
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
      return spec.call(stub, deps.token, args);
    },
  };
}

export const TOOLS: ToolDef[] = [
  docTool({
    name: "read_document",
    description:
      "Read a vapor document: its full markdown, per-block anchors for editing, who is present, and open comment threads.",
    schema: {},
    call: (stub, token) => stub.agentRead(token),
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
    call: (stub, token, args) =>
      stub.agentInsert(token, {
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
    call: (stub, token, args) =>
      stub.agentReplace(token, {
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
      find: z.string().describe("The exact text within that block to replace."),
      replacement: z.string().describe("The suggested replacement text (empty string to delete)."),
      pace,
    },
    call: (stub, token, args) =>
      stub.agentSuggest(token, {
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
    call: (stub, token, args) =>
      stub.agentComment(token, {
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
    call: (stub, token, args) =>
      stub.agentReply(token, {
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
    call: (stub, token, args) => stub.agentJoin(token, args.status as string | undefined),
  }),

  docTool({
    name: "leave",
    description: "Remove this agent's presence from the document. The token stays valid.",
    schema: {},
    call: (stub, token) => stub.agentLeave(token),
  }),

  docTool({
    name: "await_events",
    description:
      "Long-poll for document events (mentions, thread replies, change digests) after a cursor. Returns as soon as anything is waiting, or empty when the timeout elapses.",
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
    call: (stub, token, args) => {
      const timeoutS = args.timeout_s as number | undefined;
      return stub.agentAwaitEvents(token, {
        cursor: args.since_cursor as number | undefined,
        timeoutMs: timeoutS === undefined ? undefined : timeoutS * 1000,
      });
    },
  }),
];
