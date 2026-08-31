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
import { verifyGoogleIdToken, verifySessionToken } from "../app/lib/auth.server";
import { handleOAuth, OAUTH_CORS } from "./oauth";
import type Registry from "../agents/registry";

export { default as DocumentAgent } from "../agents/document";
export { default as Registry } from "../agents/registry";
export { VaporMcp };

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

const mcpHandler = VaporMcp.serve("/mcp", { binding: "VaporMcp" });
const anonMcpHandler = VaporMcp.serve("/mcp/anonymous", { binding: "VaporMcp" });

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

    // The MCP server has two doors. /mcp/anonymous never challenges:
    // tokenless sessions run as per-session anonymous identities.
    if (url.pathname === "/mcp/anonymous" || url.pathname.startsWith("/mcp/anonymous/")) {
      const props: VaporMcpProps = { auth: null, origin: url.origin };
      const mcpCtx: ExecutionContext<VaporMcpProps> = {
        props,
        waitUntil: (promise) => ctx.waitUntil(promise),
        passThroughOnException: () => ctx.passThroughOnException(),
      };
      return anonMcpHandler.fetch(request, env, mcpCtx);
    }

    // /mcp is the identity door: it accepts exactly one credential type — a
    // vapor OAuth access token (session JWT). A bare or invalid request gets
    // the 401 challenge that drives MCP clients into the consent flow.
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const header = request.headers.get("Authorization");
      const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
      const claims = bearer
        ? await verifySessionToken(bearer, env.SESSION_SECRET ?? "")
        : null;
      if (!claims) {
        return new Response(
          JSON.stringify({ error: "unauthorized", error_description: "OAuth access token required" }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              "WWW-Authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource/mcp"`,
              ...OAUTH_CORS,
            },
          },
        );
      }
      const props: VaporMcpProps = {
        auth: { principal: claims.principal, email: claims.email, caps: claims.caps },
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
