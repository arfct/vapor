import { createRequestHandler, RouterContextProvider } from "react-router";
import { routeAgentRequest, getAgentByName } from "agents";
import { cloudflareContext } from "../app/lib/cloudflare.server";
import { VaporMcp, type VaporMcpProps } from "../agents/mcp";
import {
  handleRawMarkdown,
  handleMcpHelp,
  handleLlmsTxt,
  handleAuth,
  handleSkill,
  redirectHost,
  redirectLegacyDocPath,
  type MarkdownStub,
} from "./routes";
import { verifyAppleIdToken, verifyGoogleIdToken, verifySessionToken } from "../app/lib/auth.server";
import { handleOAuth, OAUTH_CORS } from "./oauth";
import { handleAttachmentUpload, handleAttachmentServe } from "./attachments";
import { buildAttachmentDeps } from "./attachment-deps";
import { handleWakeRoutes } from "./wake-routes";
import { agentMention } from "../app/shared/agent-protocol";
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

    // Redirect alias hostnames (REDIRECT_HOSTS) to the canonical origin
    // (PUBLIC_ORIGIN). Must run before all other handlers since it operates
    // on the hostname level. A no-op unless both vars are set.
    const redirectResponse = redirectHost(request, env);
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

    // /auth/* — sign-in sessions (Google, Apple). Optional everywhere; only mints and
    // reads the vp_session cookie.
    if (url.pathname.startsWith("/auth/")) {
      const registry = (await getAgentByName(
        env.Registry,
        "global",
      )) as unknown as Registry;
      const authResponse = await handleAuth(request, {
        secret: env.SESSION_SECRET ?? "",
        googleClientId: env.GOOGLE_CLIENT_ID ?? "",
        appleClientId: env.APPLE_CLIENT_ID ?? "",
        verifyGoogle: verifyGoogleIdToken,
        verifyApple: verifyAppleIdToken,
        upsertProfile: (principal, info) => registry.upsertProfile(principal, info),
        getProfile: (principal) => registry.getProfile(principal),
        resolveEmail: (requester, email) => registry.resolveEmail(requester, email),
      });
      if (authResponse) {
        return authResponse;
      }
    }

    // /me/wake — the signed-in person's wake target (how vapor wakes their
    // agent on a mention). Same-origin cookie routes over Registry RPCs.
    if (url.pathname === "/me/wake" || url.pathname === "/me/wake/test") {
      const registry = (await getAgentByName(env.Registry, "global")) as unknown as Registry;
      const wakeResponse = await handleWakeRoutes(request, {
        secret: env.SESSION_SECRET ?? "",
        agentNameFor: async (principal) => {
          const { profile } = await registry.getProfile(principal);
          return profile ? agentMention(profile.displayName, profile.uid) : "agent";
        },
        getTarget: (principal) => registry.getWakeTarget(principal),
        setTarget: (principal, input) => registry.setWakeTarget(principal, input),
        deleteTarget: (principal) => registry.deleteWakeTarget(principal),
        wake: (args) => registry.wake(args),
      });
      if (wakeResponse) return wakeResponse;
    }

    // Anyone landing on /mcp with a GET gets the how-to-connect guide (HTML
    // for browsers, markdown otherwise) instead of a protocol error; only the
    // event-stream GET a real MCP client makes falls through to VaporMcp.serve
    // below. /llms.txt is the same guide where agents look for it first.
    // /skill.md is the plugin's skill with its URLs pointed at this instance.
    const helpResponse = handleMcpHelp(request, env) ?? handleLlmsTxt(request, env) ?? handleSkill(request, env);
    if (helpResponse) {
      return helpResponse;
    }

    // /:id/attachments — upload (signed-in people and write-capable agents)
    // and serve (public by URL, like the document). Only built when the
    // path matches, so every other request skips the Registry lookup.
    if (/^\/[a-z0-9]{8}\/attachments(\/|$)/.test(url.pathname)) {
      const registry = (await getAgentByName(env.Registry, "global")) as unknown as Registry;
      const deps = buildAttachmentDeps(env, registry);
      const attachmentResponse =
        (await handleAttachmentUpload(request, deps)) ?? (await handleAttachmentServe(request, deps));
      if (attachmentResponse) {
        return attachmentResponse;
      }
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

    // The MCP server has two endpoints. /mcp/anonymous never challenges:
    // tokenless sessions run as per-session anonymous identities.
    if (url.pathname === "/mcp/anonymous" || url.pathname.startsWith("/mcp/anonymous/")) {
      const props: VaporMcpProps = { auth: null, origin: url.origin };
      // tracing/abort (new in recent workers-types) are unused by the MCP
      // handler, so a structural cast keeps this shim minimal.
      const mcpCtx = {
        props,
        waitUntil: (promise: Promise<unknown>) => ctx.waitUntil(promise),
        passThroughOnException: () => ctx.passThroughOnException(),
      } as unknown as ExecutionContext<VaporMcpProps>;
      return anonMcpHandler.fetch(request, env, mcpCtx);
    }

    // /mcp is the signed-in endpoint: it accepts exactly one credential type — a
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
      // tracing/abort (new in recent workers-types) are unused by the MCP
      // handler, so a structural cast keeps this shim minimal.
      const mcpCtx = {
        props,
        waitUntil: (promise: Promise<unknown>) => ctx.waitUntil(promise),
        passThroughOnException: () => ctx.passThroughOnException(),
      } as unknown as ExecutionContext<VaporMcpProps>;
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
