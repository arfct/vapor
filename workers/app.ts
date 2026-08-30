import { createRequestHandler, RouterContextProvider } from "react-router";
import { routeAgentRequest } from "agents";
import { cloudflareContext } from "../app/lib/cloudflare.server";
import { VaporMcp, type VaporMcpProps } from "../agents/mcp";

export { default as DocumentAgent } from "../agents/document";
export { VaporMcp };

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

const mcpHandler = VaporMcp.serve("/mcp", { binding: "VaporMcp" });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // The MCP server lives at /mcp (streamable HTTP). The bearer token rides
    // along as props so the VaporMcp DO can pass it to DocumentAgent RPCs.
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const auth = request.headers.get("Authorization");
      const props: VaporMcpProps = {
        bearer: auth?.startsWith("Bearer ") ? auth.slice(7) : null,
        origin: url.origin,
      };
      // ExecutionContext.props is readonly, so hand the MCP handler its own
      // context carrying the props it plumbs through to the Durable Object.
      const mcpCtx: ExecutionContext<VaporMcpProps> = {
        props,
        waitUntil: (promise) => ctx.waitUntil(promise),
        passThroughOnException: () => ctx.passThroughOnException(),
      };
      return mcpHandler.fetch(request, env, mcpCtx);
    }

    // routeAgentRequest will route to available agents using the
    // /agents/:agent/:name pattern, otherwise hand off to react-router
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    // Create context provider with cloudflare bindings for middleware mode
    const contextProvider = new RouterContextProvider();
    contextProvider.set(cloudflareContext, { env, ctx });

    return requestHandler(request, contextProvider);
  },
} satisfies ExportedHandler<Env>;
