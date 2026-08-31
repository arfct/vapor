import { describe, it, expect, vi } from "vitest";
import {
  handleRawMarkdown,
  handleMcpHelp,
  redirectHost,
  redirectLegacyDocPath,
} from "../../../workers/routes";
import * as routesModule from "../../../workers/routes";

describe("handleRawMarkdown", () => {
  it("returns 200 with text/markdown for an existing doc", async () => {
    const stub = {
      exportMarkdown: vi.fn(async () => ({ markdown: "# Hello\n\nWorld" })),
    };
    const getStub = vi.fn(async () => stub);

    const res = await handleRawMarkdown(
      new Request("https://vapor.fyi/abcd1234.md"),
      getStub,
    );

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res!.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res!.text()).toBe("# Hello\n\nWorld");
    expect(getStub).toHaveBeenCalledWith("abcd1234");
  });

  it("returns 404 for a valid-format id whose document doesn't exist", async () => {
    const stub = {
      exportMarkdown: vi.fn(async () => ({
        error: { code: "doc_not_found" as const, message: "Document does not exist" },
      })),
    };
    const getStub = vi.fn(async () => stub);

    const res = await handleRawMarkdown(
      new Request("https://vapor.fyi/zzzz9999.md"),
      getStub,
    );

    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it("returns null for an invalid document id", async () => {
    const getStub = vi.fn();

    const res = await handleRawMarkdown(new Request("https://vapor.fyi/foo.md"), getStub);

    expect(res).toBeNull();
    expect(getStub).not.toHaveBeenCalled();
  });

  it("returns null for a non-.md path", async () => {
    const getStub = vi.fn();

    const res = await handleRawMarkdown(new Request("https://vapor.fyi/abcd1234"), getStub);

    expect(res).toBeNull();
    expect(getStub).not.toHaveBeenCalled();
  });

  it("returns null for non-GET requests", async () => {
    const getStub = vi.fn();

    const res = await handleRawMarkdown(
      new Request("https://vapor.fyi/abcd1234.md", { method: "POST" }),
      getStub,
    );

    expect(res).toBeNull();
    expect(getStub).not.toHaveBeenCalled();
  });
});

describe("handleMcpHelp", () => {
  it("returns an HTML help page for a browser GET", async () => {
    const res = handleMcpHelp(
      new Request("https://vapor.fyi/mcp", { headers: { Accept: "text/html" } }),
    );

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toContain("text/html");
    const body = await res!.text();
    expect(body).toContain("claude mcp add");
  });

  it("returns null when Accept is application/json (MCP clients)", () => {
    const res = handleMcpHelp(
      new Request("https://vapor.fyi/mcp", { headers: { Accept: "application/json" } }),
    );

    expect(res).toBeNull();
  });

  it("returns null for a non-/mcp path", () => {
    const res = handleMcpHelp(
      new Request("https://vapor.fyi/other", { headers: { Accept: "text/html" } }),
    );

    expect(res).toBeNull();
  });

  it("returns null for non-GET requests", () => {
    const res = handleMcpHelp(
      new Request("https://vapor.fyi/mcp", { method: "POST", headers: { Accept: "text/html" } }),
    );

    expect(res).toBeNull();
  });
});

describe("redirectLegacyDocPath", () => {
  it("permanently redirects /docs/:id to /:id", () => {
    const res = redirectLegacyDocPath(new Request("https://vapor.fyi/docs/abcd1234"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(301);
    expect(res!.headers.get("Location")).toBe("/abcd1234");
  });

  it("permanently redirects /docs/:id.md to /:id.md", () => {
    const res = redirectLegacyDocPath(new Request("https://vapor.fyi/docs/abcd1234.md"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(301);
    expect(res!.headers.get("Location")).toBe("/abcd1234.md");
  });

  it("preserves the query string", () => {
    const res = redirectLegacyDocPath(
      new Request("https://vapor.fyi/docs/abcd1234?ref=slack&x=1"),
    );

    expect(res!.headers.get("Location")).toBe("/abcd1234?ref=slack&x=1");
  });

  it("preserves the query string on the .md form", () => {
    const res = redirectLegacyDocPath(new Request("https://vapor.fyi/docs/abcd1234.md?raw=1"));

    expect(res!.headers.get("Location")).toBe("/abcd1234.md?raw=1");
  });

  it("returns null for an id that isn't a valid document id", () => {
    expect(redirectLegacyDocPath(new Request("https://vapor.fyi/docs/nope"))).toBeNull();
    expect(redirectLegacyDocPath(new Request("https://vapor.fyi/docs/ABCD1234"))).toBeNull();
    expect(redirectLegacyDocPath(new Request("https://vapor.fyi/docs/nope.md"))).toBeNull();
  });

  it("returns null for /docs and for deeper paths", () => {
    expect(redirectLegacyDocPath(new Request("https://vapor.fyi/docs"))).toBeNull();
    expect(redirectLegacyDocPath(new Request("https://vapor.fyi/docs/"))).toBeNull();
    expect(
      redirectLegacyDocPath(new Request("https://vapor.fyi/docs/abcd1234/edit")),
    ).toBeNull();
  });

  it("returns null for unrelated paths", () => {
    expect(redirectLegacyDocPath(new Request("https://vapor.fyi/abcd1234"))).toBeNull();
    expect(redirectLegacyDocPath(new Request("https://vapor.fyi/docsomething"))).toBeNull();
  });

  it("returns null for non-GET requests", () => {
    const res = redirectLegacyDocPath(
      new Request("https://vapor.fyi/docs/abcd1234", { method: "POST" }),
    );

    expect(res).toBeNull();
  });
});

describe("redirectHost", () => {
  it("redirects vpr.fyi with path and query to https://vapor.fyi", () => {
    const res = redirectHost(new Request("https://vpr.fyi/abc?x=1"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(301);
    expect(res!.headers.get("Location")).toBe("https://vapor.fyi/abc?x=1");
  });

  it("redirects www.vpr.fyi to https://vapor.fyi", () => {
    const res = redirectHost(new Request("https://www.vpr.fyi/path?q=2"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(301);
    expect(res!.headers.get("Location")).toBe("https://vapor.fyi/path?q=2");
  });

  it("redirects vaporware.fyi to https://vapor.fyi", () => {
    const res = redirectHost(new Request("https://vaporware.fyi/test"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(301);
    expect(res!.headers.get("Location")).toBe("https://vapor.fyi/test");
  });

  it("redirects www.vaporware.fyi to https://vapor.fyi", () => {
    const res = redirectHost(new Request("https://www.vaporware.fyi/doc?id=123"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(301);
    expect(res!.headers.get("Location")).toBe("https://vapor.fyi/doc?id=123");
  });

  it("redirects www.vapor.fyi to https://vapor.fyi", () => {
    const res = redirectHost(new Request("https://www.vapor.fyi/"));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(301);
    expect(res!.headers.get("Location")).toBe("https://vapor.fyi/");
  });

  it("returns null for vapor.fyi (primary domain)", () => {
    const res = redirectHost(new Request("https://vapor.fyi/abc"));

    expect(res).toBeNull();
  });

  it("returns null for localhost", () => {
    const res = redirectHost(new Request("https://localhost:3000/abc"));

    expect(res).toBeNull();
  });

  it("returns null for workers.dev subdomain", () => {
    const res = redirectHost(new Request("https://vapor.arfct.workers.dev/abc"));

    expect(res).toBeNull();
  });
});

describe("handleAuth", () => {
  const { handleAuth } = routesModule;

  function deps(overrides: Partial<Parameters<typeof handleAuth>[1]> = {}) {
    return {
      secret: "test-secret",
      googleClientId: "client-123",
      verifyGoogle: vi.fn(async () => ({
        email: "Nicholas@Artifact.com",
        name: "Nicholas",
        picture: "https://p/x.png",
      })),
      upsertProfile: vi.fn(async () => ({
        profile: { displayName: "Nicholas", agentSlug: null },
      })),
      getProfile: vi.fn(async () => ({
        profile: { displayName: "Nicholas", agentSlug: "nicholas" },
      })),
      ...overrides,
    };
  }

  function googlePost(origin = "https://vapor.fyi") {
    return new Request("https://vapor.fyi/auth/google", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "tok" }),
    });
  }

  it("returns null for non-auth paths", async () => {
    expect(await handleAuth(new Request("https://vapor.fyi/other"), deps())).toBeNull();
  });

  it("config returns the public client id", async () => {
    const res = await handleAuth(new Request("https://vapor.fyi/auth/config"), deps());
    expect(await res?.json()).toEqual({ googleClientId: "client-123" });
  });

  it("google happy path sets a secure session cookie and lowercases the principal", async () => {
    const d = deps();
    const res = await handleAuth(googlePost(), d);
    expect(res?.status).toBe(200);
    const cookie = res?.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("vp_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(d.upsertProfile).toHaveBeenCalledWith(
      "email:nicholas@artifact.com",
      expect.objectContaining({ displayName: "Nicholas" }),
    );
  });

  it("rejects cross-origin sign-in", async () => {
    const res = await handleAuth(googlePost("https://evil.example"), deps());
    expect(res?.status).toBe(403);
  });

  it("rejects a bad credential", async () => {
    const res = await handleAuth(
      googlePost(),
      deps({ verifyGoogle: vi.fn(async () => null) }),
    );
    expect(res?.status).toBe(401);
  });

  it("me without a session reports signedIn false", async () => {
    const res = await handleAuth(new Request("https://vapor.fyi/auth/me"), deps());
    expect(await res?.json()).toEqual({ signedIn: false });
  });

  it("me with a session cookie returns the profile", async () => {
    const d = deps();
    const signIn = await handleAuth(googlePost(), d);
    const cookie = (signIn?.headers.get("Set-Cookie") ?? "").split(";")[0];
    const res = await handleAuth(
      new Request("https://vapor.fyi/auth/me", { headers: { Cookie: cookie } }),
      d,
    );
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body.signedIn).toBe(true);
    expect(body.principal).toBe("email:nicholas@artifact.com");
    expect(body.agentSlug).toBe("nicholas");
  });

  it("logout clears the cookie", async () => {
    const res = await handleAuth(
      new Request("https://vapor.fyi/auth/logout", { method: "POST" }),
      deps(),
    );
    expect(res?.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
