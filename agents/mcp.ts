/**
 * The MCP server vapor exposes at /mcp. Each tool is backed by a
 * `DocumentAgent` agent* RPC; the bearer token from the HTTP request arrives
 * as `props.bearer` (set in workers/app.ts) and is passed straight through —
 * the DocumentAgent is the only thing that validates it.
 *
 * A session with no bearer token isn't turned away: it operates in
 * anonymous mode instead (see agents/mcp-anonymous.ts and the "Anonymous
 * agents" section of docs/plans/2026-08-30-agent-collaborators-design.md).
 * The per-(session, doc) identity it auto-enrolls lives in this DO's
 * persisted `state`, so reconnects and replayed calls reuse it.
 */
import { McpAgent } from "agents/mcp";
import { getAgentByName } from "agents";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  TOOLS,
  validateNewDocumentMarkdown,
  createDocumentAgentName,
  type DocStub,
} from "./mcp-tools";
import { runAnonymousTool, type AnonymousAgentState } from "./mcp-anonymous";
import { generateDocumentId } from "../app/shared/constants";
import { slugifyAgentName } from "../app/shared/agent-protocol";
import { deserializeThreads } from "../app/lib/thread-serialization";

export interface VaporMcpProps extends Record<string, unknown> {
  /** The Authorization: Bearer token, or null when none was presented. */
  bearer: string | null;
  /** Origin of the MCP request, used to build document URLs. */
  origin?: string;
}

const DEFAULT_ORIGIN = "https://vapor.fyi";

/** Every tool — errors included — returns its result as JSON text content. */
function jsonContent(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

export class VaporMcp extends McpAgent<Env, AnonymousAgentState, VaporMcpProps> {
  server = new McpServer({ name: "vapor", version: "1.0.0" });

  /** Per-doc anonymous identities this session has auto-enrolled, keyed by doc_id. */
  initialState: AnonymousAgentState = {};

  async init() {
    const getStub = (docId: string) =>
      getAgentByName(this.env.DocumentAgent, docId) as unknown as Promise<DocStub>;

    for (const tool of TOOLS) {
      this.server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.schema },
        async (args: Record<string, unknown>) => {
          const token = this.props?.bearer ?? null;

          if (token) {
            const result = await tool.run({ getStub, token }, args);
            return jsonContent(result);
          }

          // No bearer: run in anonymous mode, auto-enrolling (and reusing)
          // an agent identity per document for the lifetime of this
          // session. The client's declared name seeds the agent's name.
          const clientInfo = this.server.server.getClientVersion();
          const baseName = slugifyAgentName(clientInfo?.name ?? "agent");
          const result = await runAnonymousTool({
            tool,
            args,
            getStub,
            baseName,
            state: this.state,
            setState: (next) => this.setState(next),
          });
          return jsonContent(result);
        },
      );
    }

    // create_document needs env and no token, so it lives here rather than in
    // the (deliberately dependency-free) tool table.
    this.server.registerTool(
      "create_document",
      {
        description:
          "Create a new vapor document, optionally with starting markdown. Returns its id, URL, and a fresh agent token for it (suggest + comment capabilities).",
        inputSchema: {
          markdown: z.string().optional().describe("Optional starting markdown for the document."),
        },
      },
      async ({ markdown }: { markdown?: string }) => {
        // Same guards POST /new applies to uploaded content — this tool
        // reaches the same document store, unauthenticated.
        const invalid = validateNewDocumentMarkdown(markdown);
        if (invalid) return jsonContent(invalid);

        const id = generateDocumentId();
        const stub = await getAgentByName(this.env.DocumentAgent, id);

        const init: RequestInit = { method: "POST" };
        if (markdown?.trim()) {
          const { body, threads } = deserializeThreads(markdown);
          init.headers = { "Content-Type": "application/json" };
          init.body = JSON.stringify({ content: body, threads });
        }

        const res = await stub.fetch(new Request("https://do/", init));
        if (!res.ok) {
          return jsonContent({
            error: { code: "doc_not_found", message: "Failed to create document" },
          });
        }

        // Same clientInfo-derived naming as the anonymous tool path, for the
        // same reason: the doc is brand new, so there's no roster to
        // collide with and no retry loop is needed.
        const clientInfo = this.server.server.getClientVersion();
        const minted = await stub.mintAgentToken({ name: createDocumentAgentName(clientInfo?.name) });
        if ("error" in minted) return jsonContent(minted);

        // create_document is tokenless for everyone, but an anonymous
        // session should keep using this same minted token for follow-up
        // tool calls on the new doc rather than enrolling a second agent.
        if (!this.props?.bearer) {
          this.setState({ ...this.state, [id]: { token: minted.token, name: minted.entry.name } });
        }

        const origin = this.props?.origin ?? DEFAULT_ORIGIN;
        return jsonContent({ id, url: `${origin}/${id}`, token: minted.token });
      },
    );
  }
}
