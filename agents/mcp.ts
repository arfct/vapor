/**
 * The MCP server vapor exposes at /mcp. Each tool is backed by a
 * `DocumentAgent` agent* RPC; the bearer token from the HTTP request arrives
 * as `props.bearer` (set in workers/app.ts) and is passed straight through —
 * the DocumentAgent is the only thing that validates it.
 */
import { McpAgent } from "agents/mcp";
import { getAgentByName } from "agents";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TOOLS, validateNewDocumentMarkdown, type DocStub } from "./mcp-tools";
import { generateDocumentId } from "../app/shared/constants";
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

const INVALID_TOKEN = {
  error: {
    code: "invalid_token",
    message: "Missing bearer token. Connect with Authorization: Bearer <agent token>.",
  },
};

export class VaporMcp extends McpAgent<Env, never, VaporMcpProps> {
  server = new McpServer({ name: "vapor", version: "1.0.0" });

  async init() {
    for (const tool of TOOLS) {
      this.server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.schema },
        async (args: Record<string, unknown>) => {
          const token = this.props?.bearer ?? null;
          if (!token) return jsonContent(INVALID_TOKEN);
          const result = await tool.run(
            {
              getStub: (docId) =>
                getAgentByName(this.env.DocumentAgent, docId) as unknown as Promise<DocStub>,
              token,
            },
            args,
          );
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

        const minted = await stub.mintAgentToken({ name: "agent" });
        if ("error" in minted) return jsonContent(minted);

        const origin = this.props?.origin ?? DEFAULT_ORIGIN;
        return jsonContent({ id, url: `${origin}/${id}`, token: minted.token });
      },
    );
  }
}
