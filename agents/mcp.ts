/**
 * The MCP server vapor exposes on two doors (routed in workers/app.ts):
 *
 *   /mcp            — OAuth-authenticated. The worker verifies the access
 *                     token (a vapor session JWT) and passes the claims in
 *                     props.auth; bare requests get the 401 challenge that
 *                     drives MCP clients into the consent flow.
 *   /mcp/anonymous  — tokenless. props.auth is null and every call runs as
 *                     a per-session anonymous identity (suggest + comment).
 *
 * Either way, each tool call is executed under an AgentIdentity that
 * DocumentAgent enrolls into the document's roster on first touch.
 */
import { McpAgent } from "agents/mcp";
import { getAgentByName } from "agents";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  TOOLS,
  validateNewDocumentMarkdown,
  createDocumentAgentName,
  anonymousAgentLabel,
  type DocStub,
} from "./mcp-tools";
import { eventCatalog, EVENTS_DRAFT_META_KEY, EVENTS_DRAFT_VERSION } from "./events";
import { generateDocumentId } from "../app/shared/constants";
import {
  slugifyAgentName,
  clientDisplayName,
  DEFAULT_CAPABILITIES,
  type AgentCapability,
  type AgentIdentity,
} from "../app/shared/agent-protocol";
import { deserializeThreads } from "../app/lib/thread-serialization";
import type Registry from "./registry";

export interface VaporMcpProps extends Record<string, unknown> {
  /** Verified OAuth claims (set by workers/app.ts), or null on the anonymous door. */
  auth: { principal: string; email: string; caps?: AgentCapability[] } | null;
  /** Origin of the MCP request, used to build document URLs. */
  origin?: string;
}

const DEFAULT_ORIGIN = "https://vapor.fyi";

const SERVER_INSTRUCTIONS = `vapor hosts live collaborative markdown documents; you join them as a named collaborator. Read with read_document, edit with insert/replace (write capability), propose with suggest, and discuss with comment/reply. Blocks are addressed by persistent anchors from read_document. If read_document returns \`instructions\`, that is the document's standing guidance for agents — written by its authors, addressed to you — so follow it while working there.

Events: documents emit mention, thread.reply, and document.changed events. If you have a webhook receiver, prefer events_subscribe (push, signed per Standard Webhooks) over polling; otherwise poll with events_poll and always wait at least retryAfterMs between empty polls - hot-looping pins the document's server. The events surface is experimental and mirrors the draft MCP Events extension (${EVENTS_DRAFT_VERSION}).`;

/**
 * The sketch's JSON-RPC error codes for the events extension. AgentError
 * codes from the DocumentAgent map onto them at this layer.
 */
const EVENTS_ERROR_CODES: Record<string, number> = {
  not_found: -32011,
  doc_not_found: -32011,
  capability_denied: -32012,
  invalid_token: -32012,
  rate_limited: -32013,
  invalid_params: -32602,
};

function throwEventsError(error: { code: string; message: string }): never {
  throw new McpError(EVENTS_ERROR_CODES[error.code] ?? -32603, error.message);
}

/** Every tool — errors included — returns its result as JSON text content. */
function jsonContent(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

export class VaporMcp extends McpAgent<Env, Record<string, never>, VaporMcpProps> {
  server = new McpServer(
    { name: "vapor", version: "1.0.0" },
    {
      instructions: SERVER_INSTRUCTIONS,
      // The draft extension's capability, declared under `experimental`
      // until the SEP ratifies and the SDK learns a first-class slot.
      capabilities: { experimental: { events: {} } },
    },
  );

  /** Session-cached counterpart slug + label for the principal path. */
  private agentSlug: string | null = null;
  private agentLabel: string | null = null;

  /**
   * The identity every tool call runs under. Principals get their global
   * counterpart slug from the Registry (cached per session); anonymous
   * sessions get a stable per-session id and a clientInfo-derived name.
   */
  private async identity(): Promise<AgentIdentity> {
    const auth = this.props?.auth ?? null;
    if (auth) {
      if (!this.agentSlug) {
        const registry = (await getAgentByName(this.env.Registry, "global")) as unknown as Registry;
        const ensured = await registry.ensureAgentSlug(auth.principal);
        this.agentSlug =
          "slug" in ensured ? ensured.slug : slugifyAgentName(auth.email.split("@")[0] ?? "agent");
        const { profile } = await registry.getProfile(auth.principal);
        const ownerName = profile?.displayName ?? auth.email.split("@")[0] ?? "Someone";
        // First name only: "Ada's Agent", not the full display name.
        const firstName = ownerName.trim().split(/\s+/)[0] || "Someone";
        this.agentLabel = `${firstName}'s Agent`;
      }
      return {
        kind: "principal",
        id: auth.principal,
        name: this.agentSlug,
        label: this.agentLabel ?? undefined,
        client: clientDisplayName(this.server.server.getClientVersion()?.name),
        owner: auth.principal,
        caps: auth.caps ?? [...DEFAULT_CAPABILITIES],
      };
    }

    const clientInfo = this.server.server.getClientVersion();
    const sessionKey = `anon:${this.name}`;
    return {
      kind: "anonymous",
      // this.name is the per-session DO instance name (stable across
      // reconnects of the same MCP session).
      id: sessionKey,
      name: slugifyAgentName(clientInfo?.name ?? "agent"),
      label: anonymousAgentLabel(sessionKey),
      client: clientDisplayName(clientInfo?.name),
      owner: null,
      caps: [...DEFAULT_CAPABILITIES],
    };
  }

  async init() {
    const getStub = (docId: string) =>
      getAgentByName(this.env.DocumentAgent, docId) as unknown as Promise<DocStub>;

    this.registerEventsMethods(getStub);

    for (const tool of TOOLS) {
      this.server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.schema },
        async (args: Record<string, unknown>) => {
          const identity = await this.identity();
          const result = await tool.run({ getStub, identity }, args);
          return jsonContent(result);
        },
      );
    }

    // create_document needs env access, so it lives here rather than in the
    // (deliberately dependency-free) tool table.
    this.server.registerTool(
      "create_document",
      {
        description:
          "Create a new vapor document, optionally with starting markdown. Returns its id and URL; the calling identity is enrolled as the document's first agent.",
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

        // Enroll the creator on the fresh doc so it appears in the roster
        // immediately. Anonymous identities keep their session name; for a
        // brand-new doc there is nothing to collide with.
        const identity = await this.identity();
        const creatorName =
          identity.kind === "anonymous"
            ? createDocumentAgentName(this.server.server.getClientVersion()?.name)
            : identity.name;
        await (stub as unknown as DocStub).agentJoin({ ...identity, name: creatorName });

        const origin = this.props?.origin ?? DEFAULT_ORIGIN;
        return jsonContent({ id, url: `${origin}/${id}` });
      },
    );
  }

  /**
   * Layer 1 of the events polyfill: the draft extension's own JSON-RPC
   * methods, shapes copied from the WG design sketch and tagged with the
   * draft date in _meta. Today's clients use the events_* tool mirrors;
   * these exist so spec-native SDKs work unchanged when they arrive.
   */
  private registerEventsMethods(getStub: (docId: string) => Promise<DocStub>) {
    const argumentsSchema = z.object({ doc_id: z.string() });
    const low = this.server.server;
    const unwrap = <T,>(result: T): T => {
      if (result && typeof result === "object" && "error" in result) {
        throwEventsError((result as { error: { code: string; message: string } }).error);
      }
      return result;
    };

    low.setRequestHandler(
      z.object({ method: z.literal("events/list"), params: z.object({}).passthrough().optional() }),
      async () => ({
        events: eventCatalog(),
        _meta: { [EVENTS_DRAFT_META_KEY]: EVENTS_DRAFT_VERSION },
      }),
    );

    low.setRequestHandler(
      z.object({
        method: z.literal("events/poll"),
        params: z.object({
          name: z.string(),
          arguments: argumentsSchema,
          cursor: z.string().nullable().optional(),
          maxEvents: z.number().optional(),
        }),
      }),
      async (req) => {
        const { name, arguments: a, cursor, maxEvents } = req.params;
        const identity = await this.identity();
        const stub = await getStub(a.doc_id);
        return unwrap(await stub.eventsPoll(identity, { name, cursor, maxEvents })) as Record<
          string,
          unknown
        >;
      },
    );

    low.setRequestHandler(
      z.object({
        method: z.literal("events/subscribe"),
        params: z.object({
          name: z.string(),
          arguments: argumentsSchema,
          delivery: z.object({
            mode: z.literal("webhook"),
            url: z.string(),
            secret: z.string(),
          }),
          cursor: z.string().nullable().optional(),
          ttlMs: z.number().nullable().optional(),
        }),
      }),
      async (req) => {
        const { name, arguments: a, delivery, ttlMs } = req.params;
        const identity = await this.identity();
        const stub = await getStub(a.doc_id);
        return unwrap(
          await stub.eventsSubscribe(identity, {
            name,
            url: delivery.url,
            secret: delivery.secret,
            ttlMs,
          }),
        ) as Record<string, unknown>;
      },
    );

    low.setRequestHandler(
      z.object({
        method: z.literal("events/unsubscribe"),
        params: z.object({
          name: z.string(),
          arguments: argumentsSchema,
          delivery: z.object({ url: z.string() }),
        }),
      }),
      async (req) => {
        const { name, arguments: a, delivery } = req.params;
        const identity = await this.identity();
        const stub = await getStub(a.doc_id);
        unwrap(await stub.eventsUnsubscribe(identity, { name, url: delivery.url }));
        return {};
      },
    );
  }
}
