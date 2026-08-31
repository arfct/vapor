import { createRequestHandler, RouterContextProvider } from "react-router";
import { routeAgentRequest, getAgentByName } from "agents";
import { cloudflareContext } from "../app/lib/cloudflare.server";
import { VaporMcp, type VaporMcpProps } from "../agents/mcp";
import {
  handleRawMarkdown,
  handleMcpHelp,
  handleAuth,
  redirectHost,
  redirectLegacyDocPath,
  type MarkdownStub,
} from "./routes";
import { verifyGoogleIdToken } from "../app/lib/auth.server";
import { handleOAuth } from "./oauth";
import type Registry from "../agents/registry";

export { default as DocumentAgent } from "../agents/document";
export { default as Registry } from "../agents/registry";
export { VaporMcp };

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

const mcpHandler = VaporMcp.serve("/mcp", { binding: "VaporMcp" });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Redirect secondary domains to the primary vapor.fyi domain. Must run
    // before all other handlers since it operates on the hostname level.
    const redirectResponse = redirectHost(request);
    if (redirectResponse) {
      return redirectResponse;
    }

    // Documents used to live under /docs/:id. Links shared before the move
    // are still live (docs last 99 hours), so 301 them to the root-level URL
    // rather than letting React Router 404 them.
    const legacyDocResponse = redirectLegacyDocPath(request);
    if (legacyDocResponse) {
      return legacyDocResponse;
    }

    // /oauth/* + the OAuth discovery documents — the authorization server
    // MCP clients use to connect with the user's identity.
    if (url.pathname.startsWith("/oauth") || url.pathname.startsWith("/.well-known/oauth-")) {
      const registry = (await getAgentByName(
        env.Registry,
        "global",
      )) as unknown as Registry;
      const oauthResponse = await handleOAuth(request, {
        secret: env.SESSION_SECRET ?? "",
        registry,
      });
      if (oauthResponse) {
        return oauthResponse;
      }
    }

    // /auth/* — Google sign-in sessions. Optional everywhere; only mints and
    // reads the vp_session cookie.
    if (url.pathname.startsWith("/auth/")) {
      const registry = (await getAgentByName(
        env.Registry,
        "global",
      )) as unknown as Registry;
      const authResponse = await handleAuth(request, {
        secret: env.SESSION_SECRET ?? "",
        googleClientId: env.GOOGLE_CLIENT_ID ?? "",
        verifyGoogle: verifyGoogleIdToken,
        upsertProfile: (principal, info) => registry.upsertProfile(principal, info),
        getProfile: (principal) => registry.getProfile(principal),
      });
      if (authResponse) {
        return authResponse;
      }
    }

    // A browser landing on /mcp (Accept: text/html) gets a how-to-connect
    // page instead of a protocol error. MCP clients send an
    // application/json-flavoured Accept and never match this, so they fall
    // through to VaporMcp.serve below. Must run before that branch.
    const helpResponse = handleMcpHelp(request);
    if (helpResponse) {
      return helpResponse;
    }

    // GET /:id.md serves a document's raw markdown, public by URL like the
    // rest of vapor. Falls through (null) for anything that isn't that
    // shape, so it must run before routeAgentRequest/React Router.
    const markdownResponse = await handleRawMarkdown(request, (id) =>
      getAgentByName(env.DocumentAgent, id) as unknown as Promise<MarkdownStub>,
    );
    if (markdownResponse) {
      return markdownResponse;
    }

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
