/**
 * The Worker entry (workers/app.ts): request routing order, the /mcp auth
 * gate, and the wiring that turns each route's deps into Registry /
 * DocumentAgent / R2 calls. Route handlers are mocked to capture the deps
 * they receive; the handlers themselves are tested in their own files.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RouterContextProvider } from "react-router";
import { mintSessionToken } from "../../../app/lib/auth.server";
import { cloudflareContext } from "../../../app/lib/cloudflare.server";

const h = vi.hoisted(() => {
  const registry = {
    lookupAccessToken: vi.fn(),
    getProfile: vi.fn(),
    upsertProfile: vi.fn(),
    resolveEmail: vi.fn(),
    getWakeTarget: vi.fn(),
    setWakeTarget: vi.fn(),
    deleteWakeTarget: vi.fn(),
    wake: vi.fn(),
    getDevices: vi.fn(),
    setKindleEmail: vi.fn(),
    setRemarkableToken: vi.fn(),
    clearRemarkable: vi.fn(),
    openRemarkableToken: vi.fn(),
    allowSend: vi.fn(),
    listAccessTokens: vi.fn(),
    createAccessToken: vi.fn(),
    revokeAccessToken: vi.fn(),
  };
  return {
    registry,
    docStub: { name: "doc-stub" },
    getAgentByName: vi.fn(),
    routeAgentRequest: vi.fn(),
    requestHandler: vi.fn(),
    mcpFetch: vi.fn(),
    anonMcpFetch: vi.fn(),
    handlers: {
      handleRawMarkdown: vi.fn(),
      handleMcpHelp: vi.fn(),
      handleLlmsTxt: vi.fn(),
      handleAuth: vi.fn(),
      handleSkill: vi.fn(),
      handleEpub: vi.fn(),
      handleAppsChallenge: vi.fn(),
      handlePrint: vi.fn(),
      buildDocumentEpub: vi.fn(),
      redirectHost: vi.fn(),
      redirectLegacyDocPath: vi.fn(),
      handleOAuth: vi.fn(),
      handleAttachmentUpload: vi.fn(),
      handleAttachmentServe: vi.fn(),
      buildAttachmentDeps: vi.fn(),
      handleWakeRoutes: vi.fn(),
      handleTokenRoutes: vi.fn(),
      handleDeviceRoutes: vi.fn(),
      kindleMailerFromEnv: vi.fn(),
      sendToKindle: vi.fn(),
      pairRemarkable: vi.fn(),
      remarkableUserToken: vi.fn(),
      uploadToRemarkable: vi.fn(),
    },
  };
});

vi.mock("agents", () => ({
  getAgentByName: h.getAgentByName,
  routeAgentRequest: h.routeAgentRequest,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  createRequestHandler: () => h.requestHandler,
}));
vi.mock("../../../agents/mcp", () => ({
  VaporMcp: {
    serve: (path: string) => ({ fetch: path === "/mcp" ? h.mcpFetch : h.anonMcpFetch }),
  },
}));
vi.mock("../../../agents/document", () => ({ default: class DocumentAgent {} }));
vi.mock("../../../agents/registry", () => ({ default: class Registry {} }));
vi.mock("../../../workers/routes", () => ({
  handleRawMarkdown: h.handlers.handleRawMarkdown,
  handleMcpHelp: h.handlers.handleMcpHelp,
  handleLlmsTxt: h.handlers.handleLlmsTxt,
  handleAuth: h.handlers.handleAuth,
  handleSkill: h.handlers.handleSkill,
  handleEpub: h.handlers.handleEpub,
  handleAppsChallenge: h.handlers.handleAppsChallenge,
  handlePrint: h.handlers.handlePrint,
  buildDocumentEpub: h.handlers.buildDocumentEpub,
  redirectHost: h.handlers.redirectHost,
  redirectLegacyDocPath: h.handlers.redirectLegacyDocPath,
}));
vi.mock("../../../workers/oauth", () => ({
  handleOAuth: h.handlers.handleOAuth,
  OAUTH_CORS: { "Access-Control-Allow-Origin": "*" },
}));
vi.mock("../../../workers/attachments", () => ({
  handleAttachmentUpload: h.handlers.handleAttachmentUpload,
  handleAttachmentServe: h.handlers.handleAttachmentServe,
}));
vi.mock("../../../workers/attachment-deps", () => ({ buildAttachmentDeps: h.handlers.buildAttachmentDeps }));
vi.mock("../../../workers/wake-routes", () => ({ handleWakeRoutes: h.handlers.handleWakeRoutes }));
vi.mock("../../../workers/token-routes", () => ({ handleTokenRoutes: h.handlers.handleTokenRoutes }));
vi.mock("../../../workers/device-routes", () => ({ handleDeviceRoutes: h.handlers.handleDeviceRoutes }));
vi.mock("../../../workers/kindle", () => ({
  kindleMailerFromEnv: h.handlers.kindleMailerFromEnv,
  sendToKindle: h.handlers.sendToKindle,
}));
vi.mock("../../../workers/remarkable", () => ({
  pairRemarkable: h.handlers.pairRemarkable,
  remarkableUserToken: h.handlers.remarkableUserToken,
  uploadToRemarkable: h.handlers.uploadToRemarkable,
}));

const { default: worker } = await import("../../../workers/app");

const SECRET = "worker-app-secret";
const ORIGIN = "https://vapor.test";

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    Registry: { binding: "Registry" },
    DocumentAgent: { binding: "DocumentAgent" },
    SESSION_SECRET: SECRET,
    GOOGLE_CLIENT_ID: "g-client",
    APPLE_CLIENT_ID: "a-client",
    ATTACHMENTS: {
      get: vi.fn(async (key: string) =>
        key === "abcd1234/att1" ? { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } : null,
      ),
    },
    ...overrides,
  };
}

function makeCtx() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} };
}

async function call(path: string, init?: RequestInit, env = makeEnv(), ctx = makeCtx()) {
  // The handler is typed against the generated Env; tests pass a structural fake.
  const fetchFn = worker.fetch as unknown as (r: Request, e: unknown, c: unknown) => Promise<Response>;
  return fetchFn(new Request(`${ORIGIN}${path}`, init), env, ctx);
}

function depsOf(fn: ReturnType<typeof vi.fn>) {
  expect(fn).toHaveBeenCalled();
  return fn.mock.calls.at(-1)![1];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(h.handlers)) fn.mockReset();
  for (const name of [
    "handleRawMarkdown",
    "handleAuth",
    "handleEpub",
    "handlePrint",
    "handleOAuth",
    "handleAttachmentUpload",
    "handleAttachmentServe",
    "handleWakeRoutes",
    "handleTokenRoutes",
    "handleDeviceRoutes",
  ] as const) {
    h.handlers[name].mockResolvedValue(null);
  }
  for (const name of ["handleMcpHelp", "handleLlmsTxt", "handleSkill", "handleAppsChallenge", "redirectHost", "redirectLegacyDocPath"] as const) {
    h.handlers[name].mockReturnValue(null);
  }
  h.getAgentByName.mockImplementation(async (ns: { binding: string }) =>
    ns.binding === "Registry" ? h.registry : h.docStub,
  );
  h.routeAgentRequest.mockResolvedValue(null);
  h.requestHandler.mockImplementation(async () => new Response("react-router"));
  h.mcpFetch.mockImplementation(async () => new Response("mcp"));
  h.anonMcpFetch.mockImplementation(async () => new Response("anon-mcp"));
  h.registry.getProfile.mockResolvedValue({ profile: { displayName: "Ada", uid: "u1" } });
});

describe("worker fetch routing", () => {
  it("returns the host redirect before anything else", async () => {
    h.handlers.redirectHost.mockReturnValue(new Response(null, { status: 301 }));
    const res = await call("/anything");
    expect(res.status).toBe(301);
    expect(h.handlers.redirectLegacyDocPath).not.toHaveBeenCalled();
  });

  it("returns the legacy /docs/:id redirect", async () => {
    h.handlers.redirectLegacyDocPath.mockReturnValue(new Response(null, { status: 308 }));
    const res = await call("/docs/abcd1234");
    expect(res.status).toBe(308);
  });

  it("falls through to React Router with the cloudflare context", async () => {
    const res = await call("/");
    expect(await res.text()).toBe("react-router");
    expect(h.requestHandler).toHaveBeenCalledTimes(1);
    const provider = h.requestHandler.mock.calls[0][1] as RouterContextProvider;
    expect(provider.get(cloudflareContext)).toMatchObject({ env: { SESSION_SECRET: SECRET } });
  });

  it("prefers routeAgentRequest over React Router", async () => {
    h.routeAgentRequest.mockResolvedValue(new Response("agent"));
    const res = await call("/agents/document-agent/abcd1234");
    expect(await res.text()).toBe("agent");
    expect(h.requestHandler).not.toHaveBeenCalled();
  });

  it("serves raw markdown through a DocumentAgent stub", async () => {
    h.handlers.handleRawMarkdown.mockImplementation(async (_req: Request, getStub: (id: string) => Promise<unknown>) => {
      expect(await getStub("abcd1234")).toBe(h.docStub);
      return new Response("# md");
    });
    const res = await call("/abcd1234.md");
    expect(await res.text()).toBe("# md");
  });

  it("returns help, challenge and skill responses", async () => {
    h.handlers.handleAppsChallenge.mockReturnValueOnce(new Response("challenge"));
    expect(await (await call("/.well-known/openai-apps-challenge")).text()).toBe("challenge");

    h.handlers.handleSkill.mockReturnValueOnce(new Response("skill"));
    expect(await (await call("/skill.md")).text()).toBe("skill");
    expect(h.handlers.handleMcpHelp).toHaveBeenCalled();
    expect(h.handlers.handleLlmsTxt).toHaveBeenCalled();
  });
});

describe("oauth and auth wiring", () => {
  it("passes Registry-backed deps to handleOAuth", async () => {
    h.handlers.handleOAuth.mockResolvedValue(new Response("oauth"));
    const res = await call("/oauth/authorize");
    expect(await res.text()).toBe("oauth");
    const deps = depsOf(h.handlers.handleOAuth);
    expect(deps.secret).toBe(SECRET);
    expect(deps.registry).toBe(h.registry);

    h.registry.lookupAccessToken.mockResolvedValue({ grant: null });
    await deps.lookupAccessToken("vpt_x");
    expect(h.registry.lookupAccessToken).toHaveBeenCalledWith("vpt_x");

    expect(await deps.displayName("p1")).toBe("Ada");
    h.registry.getProfile.mockResolvedValue({ profile: null });
    expect(await deps.displayName("p2")).toBeNull();
  });

  it("falls through when handleOAuth declines, for every discovery prefix", async () => {
    for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
      const res = await call(path);
      expect(await res.text()).toBe("react-router");
    }
    expect(h.handlers.handleOAuth).toHaveBeenCalledTimes(2);
  });

  it("uses an empty secret when SESSION_SECRET is unset", async () => {
    await call("/oauth/token", undefined, makeEnv({ SESSION_SECRET: undefined }));
    expect(depsOf(h.handlers.handleOAuth).secret).toBe("");
  });

  it("passes Registry-backed deps to handleAuth", async () => {
    h.handlers.handleAuth.mockResolvedValue(new Response("auth"));
    expect(await (await call("/auth/google")).text()).toBe("auth");
    const deps = depsOf(h.handlers.handleAuth);
    expect(deps.googleClientId).toBe("g-client");
    expect(deps.appleClientId).toBe("a-client");

    await deps.upsertProfile("p1", { email: "a@b.c" });
    expect(h.registry.upsertProfile).toHaveBeenCalledWith("p1", { email: "a@b.c" });
    await deps.getProfile("p1");
    expect(h.registry.getProfile).toHaveBeenCalledWith("p1");
    await deps.resolveEmail("p1", "x@y.z");
    expect(h.registry.resolveEmail).toHaveBeenCalledWith("p1", "x@y.z");
  });

  it("defaults auth config to empty strings and falls through", async () => {
    const env = makeEnv({ SESSION_SECRET: undefined, GOOGLE_CLIENT_ID: undefined, APPLE_CLIENT_ID: undefined });
    const res = await call("/auth/session", undefined, env);
    expect(await res.text()).toBe("react-router");
    const deps = depsOf(h.handlers.handleAuth);
    expect([deps.secret, deps.googleClientId, deps.appleClientId]).toEqual(["", "", ""]);
  });
});

describe("wake, token and device wiring", () => {
  it("wires /me/wake to the Registry", async () => {
    h.handlers.handleWakeRoutes.mockResolvedValue(new Response("wake"));
    expect(await (await call("/me/wake")).text()).toBe("wake");
    const deps = depsOf(h.handlers.handleWakeRoutes);

    expect(await deps.agentNameFor("p1")).toMatch(/^ada\+agent~/);
    h.registry.getProfile.mockResolvedValue({ profile: null });
    expect(await deps.agentNameFor("p2")).toBe("agent");

    await deps.getTarget("p1");
    await deps.setTarget("p1", { url: "https://x" });
    await deps.deleteTarget("p1");
    await deps.wake({ principal: "p1" });
    expect(h.registry.getWakeTarget).toHaveBeenCalledWith("p1");
    expect(h.registry.setWakeTarget).toHaveBeenCalledWith("p1", { url: "https://x" });
    expect(h.registry.deleteWakeTarget).toHaveBeenCalledWith("p1");
    expect(h.registry.wake).toHaveBeenCalledWith({ principal: "p1" });
  });

  it("falls through /me/wake/test when the wake handler declines", async () => {
    expect(await (await call("/me/wake/test", undefined, makeEnv({ SESSION_SECRET: undefined }))).text()).toBe(
      "react-router",
    );
    expect(depsOf(h.handlers.handleWakeRoutes).secret).toBe("");
  });

  it("wires /me/tokens to the Registry", async () => {
    h.handlers.handleTokenRoutes.mockResolvedValue(new Response("tokens"));
    expect(await (await call("/me/tokens")).text()).toBe("tokens");
    const deps = depsOf(h.handlers.handleTokenRoutes);
    await deps.list("p1");
    await deps.create({ principal: "p1", label: "x" });
    await deps.revoke("p1", "t1");
    expect(h.registry.listAccessTokens).toHaveBeenCalledWith("p1");
    expect(h.registry.createAccessToken).toHaveBeenCalledWith({ principal: "p1", label: "x" });
    expect(h.registry.revokeAccessToken).toHaveBeenCalledWith("p1", "t1");
  });

  it("falls through /me/tokens when the handler declines", async () => {
    expect(await (await call("/me/tokens", undefined, makeEnv({ SESSION_SECRET: undefined }))).text()).toBe(
      "react-router",
    );
    expect(depsOf(h.handlers.handleTokenRoutes).secret).toBe("");
  });

  it("wires /me/devices and /:id/send to the Registry and device clients", async () => {
    h.handlers.handleDeviceRoutes.mockResolvedValue(new Response("devices"));
    h.handlers.kindleMailerFromEnv.mockReturnValue({ kind: "mailer" });
    expect(await (await call("/abcd1234/send", { method: "POST" })).text()).toBe("devices");
    const deps = depsOf(h.handlers.handleDeviceRoutes);
    expect(deps.mailer).toEqual({ kind: "mailer" });

    await deps.getDevices("p1");
    await deps.setKindleEmail("p1", "me@kindle.com");
    await deps.pairRemarkable("code");
    await deps.setRemarkableToken("p1", "tok");
    await deps.clearRemarkable("p1");
    await deps.openRemarkableToken("p1");
    await deps.allowSend("p1");
    expect(await deps.displayName("p1")).toBe("Ada");
    await deps.buildEpub("abcd1234", ORIGIN);
    await deps.sendKindle({ kind: "mailer" }, { to: "x" });
    await deps.remarkableUserToken("dev");
    await deps.uploadRemarkable("user", { name: "f" });

    expect(h.registry.getDevices).toHaveBeenCalledWith("p1");
    expect(h.registry.setKindleEmail).toHaveBeenCalledWith("p1", "me@kindle.com");
    expect(h.handlers.pairRemarkable).toHaveBeenCalledWith("code");
    expect(h.registry.setRemarkableToken).toHaveBeenCalledWith("p1", "tok");
    expect(h.registry.clearRemarkable).toHaveBeenCalledWith("p1");
    expect(h.registry.openRemarkableToken).toHaveBeenCalledWith("p1");
    expect(h.registry.allowSend).toHaveBeenCalledWith("p1");
    expect(h.handlers.buildDocumentEpub).toHaveBeenCalledWith("abcd1234", expect.any(Object), ORIGIN);
    expect(h.handlers.sendToKindle).toHaveBeenCalledWith({ kind: "mailer" }, { to: "x" });
    expect(h.handlers.remarkableUserToken).toHaveBeenCalledWith("dev");
    expect(h.handlers.uploadToRemarkable).toHaveBeenCalledWith("user", { name: "f" });

    h.registry.getProfile.mockResolvedValue({ profile: undefined });
    expect(await deps.displayName("p2")).toBeNull();
  });

  it("falls through /me/devices when the handler declines", async () => {
    expect(await (await call("/me/devices", undefined, makeEnv({ SESSION_SECRET: undefined }))).text()).toBe(
      "react-router",
    );
    expect(depsOf(h.handlers.handleDeviceRoutes).secret).toBe("");
  });
});

describe("epub and attachment wiring", () => {
  it("serves EPUBs with DocumentAgent stubs and R2 attachments", async () => {
    h.handlers.handleEpub.mockResolvedValue(new Response("epub"));
    expect(await (await call("/abcd1234.epub")).text()).toBe("epub");
    const deps = depsOf(h.handlers.handleEpub);
    expect(await deps.getStub("abcd1234")).toBe(h.docStub);
    expect(await deps.getAttachment("abcd1234", "att1")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await deps.getAttachment("abcd1234", "missing")).toBeNull();
    expect(h.handlers.handlePrint).not.toHaveBeenCalled();
  });

  it("falls back to the print view when handleEpub declines", async () => {
    h.handlers.handlePrint.mockResolvedValue(new Response("print"));
    expect(await (await call("/abcd1234/print")).text()).toBe("print");
  });

  it("builds attachment deps only for attachment paths and tries upload then serve", async () => {
    h.handlers.buildAttachmentDeps.mockReturnValue({ kind: "deps" });
    h.handlers.handleAttachmentServe.mockResolvedValue(new Response("file"));
    expect(await (await call("/abcd1234/attachments/abcdefghijklmnop")).text()).toBe("file");
    expect(h.handlers.buildAttachmentDeps).toHaveBeenCalledWith(expect.any(Object), h.registry);
    expect(h.handlers.handleAttachmentUpload).toHaveBeenCalledWith(expect.any(Request), { kind: "deps" });

    vi.clearAllMocks();
    h.handlers.handleAttachmentServe.mockResolvedValue(null);
    expect(await (await call("/abcd1234/attachments")).text()).toBe("react-router");

    vi.clearAllMocks();
    await call("/abcd1234/other");
    expect(h.handlers.buildAttachmentDeps).not.toHaveBeenCalled();
  });

  it("returns the upload response without trying serve", async () => {
    h.handlers.handleAttachmentUpload.mockResolvedValue(new Response("uploaded", { status: 201 }));
    const res = await call("/abcd1234/attachments", { method: "POST" });
    expect(res.status).toBe(201);
    expect(h.handlers.handleAttachmentServe).not.toHaveBeenCalled();
  });
});

describe("/mcp endpoints", () => {
  it("routes /mcp/anonymous without auth and forwards ctx methods", async () => {
    const ctx = makeCtx();
    const res = await call("/mcp/anonymous", { method: "POST" }, makeEnv(), ctx);
    expect(await res.text()).toBe("anon-mcp");
    const mcpCtx = h.anonMcpFetch.mock.calls[0][2];
    expect(mcpCtx.props).toEqual({ auth: null, origin: ORIGIN });
    const p = Promise.resolve();
    mcpCtx.waitUntil(p);
    mcpCtx.passThroughOnException();
    expect(ctx.waitUntil).toHaveBeenCalledWith(p);
    expect(ctx.passThroughOnException).toHaveBeenCalled();

    await call("/mcp/anonymous/sse");
    expect(h.anonMcpFetch).toHaveBeenCalledTimes(2);
  });

  it("challenges /mcp without a bearer token", async () => {
    const res = await call("/mcp", { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
    expect(h.mcpFetch).not.toHaveBeenCalled();
  });

  it("challenges /mcp with an invalid session token", async () => {
    const res = await call("/mcp/sse", { headers: { Authorization: "Bearer not-a-jwt" } });
    expect(res.status).toBe(401);
  });

  it("challenges an unknown personal access token", async () => {
    h.registry.lookupAccessToken.mockResolvedValue({ grant: null });
    const res = await call("/mcp", { method: "POST", headers: { Authorization: "Bearer vpt_unknown" } });
    expect(res.status).toBe(401);
    expect(h.registry.lookupAccessToken).toHaveBeenCalledWith("vpt_unknown");
  });

  it("accepts a personal access token and plumbs its caps into props", async () => {
    h.registry.lookupAccessToken.mockResolvedValue({
      grant: { principal: "p1", email: "a@b.c", caps: ["suggest"] },
    });
    const ctx = makeCtx();
    const res = await call("/mcp", { method: "POST", headers: { Authorization: "bearer vpt_good" } }, makeEnv(), ctx);
    expect(await res.text()).toBe("mcp");
    const mcpCtx = h.mcpFetch.mock.calls[0][2];
    expect(mcpCtx.props).toEqual({ auth: { principal: "p1", email: "a@b.c", caps: ["suggest"] }, origin: ORIGIN });
    mcpCtx.waitUntil(Promise.resolve());
    mcpCtx.passThroughOnException();
    expect(ctx.waitUntil).toHaveBeenCalled();
    expect(ctx.passThroughOnException).toHaveBeenCalled();
  });

  it("accepts a valid session JWT", async () => {
    const token = await mintSessionToken({ principal: "p9", email: "p9@x.y" }, SECRET);
    const res = await call("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(await res.text()).toBe("mcp");
    expect(h.mcpFetch.mock.calls[0][2].props.auth).toMatchObject({ principal: "p9", email: "p9@x.y" });
  });

  it("rejects a session JWT signed with another secret", async () => {
    const token = await mintSessionToken({ principal: "p9", email: "p9@x.y" }, "some-other-secret");
    const res = await call("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });
});
