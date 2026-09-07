import { describe, it, expect, vi } from "vitest";
import {
  handleRawMarkdown,
  handleMcpHelp,
  handleLlmsTxt,
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

  it("accepts a slugged address and resolves by its id", async () => {
    const getStub = vi.fn(async () => ({ exportMarkdown: async () => ({ markdown: "# Hi" }) }));
    const res = await handleRawMarkdown(new Request("https://vapor.fyi/some-title-abcd1234.md"), getStub);
    expect(res?.status).toBe(200);
    expect(getStub).toHaveBeenCalledWith("abcd1234");
    expect(await handleRawMarkdown(new Request("https://vapor.fyi/some-title.md"), getStub)).toBeNull();
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

  it("returns null for the Streamable HTTP event stream GET (MCP clients)", () => {
    const res = handleMcpHelp(
      new Request("https://vapor.fyi/mcp", {
        headers: { Accept: "application/json, text/event-stream" },
      }),
    );

    expect(res).toBeNull();
  });

  it("returns the guide as markdown for curl and agent fetch tools", async () => {
    const res = handleMcpHelp(new Request("https://vapor.fyi/mcp", { headers: { Accept: "*/*" } }));

    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toContain("text/markdown");
    const body = await res!.text();
    expect(body).toContain("claude mcp add --transport http vapor https://vapor.fyi/mcp");
    expect(body).toContain("~/.agents/skills/vapor/SKILL.md");
    expect(body).not.toContain("<html");
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

describe("handleLlmsTxt", () => {
  it("serves the markdown guide at /llms.txt", async () => {
    const res = handleLlmsTxt(new Request("https://vapor.fyi/llms.txt"));

    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toContain("text/markdown");
    expect(await res!.text()).toContain("# vapor");
  });

  it("ignores other paths and methods", () => {
    expect(handleLlmsTxt(new Request("https://vapor.fyi/other.txt"))).toBeNull();
    expect(handleLlmsTxt(new Request("https://vapor.fyi/llms.txt", { method: "POST" }))).toBeNull();
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
  const env = {
    PUBLIC_ORIGIN: "https://vapor.example",
    REDIRECT_HOSTS: "www.vapor.example, vpr.example,WWW.VPR.EXAMPLE",
  };

  it("301s a listed alias to PUBLIC_ORIGIN with path and query preserved", () => {
    const res = redirectHost(new Request("https://vpr.example/abc?x=1"), env);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(301);
    expect(res!.headers.get("Location")).toBe("https://vapor.example/abc?x=1");
  });

  it("matches aliases case-insensitively and ignores whitespace in the list", () => {
    expect(redirectHost(new Request("https://www.vapor.example/"), env)!.headers.get("Location")).toBe(
      "https://vapor.example/",
    );
    expect(redirectHost(new Request("https://www.vpr.example/doc?id=123"), env)!.headers.get("Location")).toBe(
      "https://vapor.example/doc?id=123",
    );
  });

  it("returns null for the canonical host, localhost, and workers.dev", () => {
    expect(redirectHost(new Request("https://vapor.example/abc"), env)).toBeNull();
    expect(redirectHost(new Request("https://localhost:3000/abc"), env)).toBeNull();
    expect(redirectHost(new Request("https://vapor.someone.workers.dev/abc"), env)).toBeNull();
  });

  it("never redirects when the vars are unset — a fresh deploy has no aliases", () => {
    expect(redirectHost(new Request("https://www.vapor.example/"))).toBeNull();
    expect(redirectHost(new Request("https://www.vapor.example/"), { REDIRECT_HOSTS: "www.vapor.example" })).toBeNull();
    expect(redirectHost(new Request("https://www.vapor.example/"), { PUBLIC_ORIGIN: "https://vapor.example" })).toBeNull();
  });

  it("refuses to loop when the canonical host is itself listed as an alias", () => {
    const res = redirectHost(new Request("https://vapor.example/x"), {
      PUBLIC_ORIGIN: "https://vapor.example",
      REDIRECT_HOSTS: "vapor.example",
    });
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
        sub: "10769150350006150715113082367",
        email: "Ada@Example.com",
        name: "Ada",
        picture: "https://p/x.png",
      })),
      upsertProfile: vi.fn(async () => ({
        profile: { uid: "k3f0a9x2", displayName: "Ada", avatar: null },
      })),
      getProfile: vi.fn(async () => ({
        profile: { uid: "k3f0a9x2", displayName: "Ada", avatar: null },
      })),
      resolveEmail: vi.fn(async (_requester: string, email: string) =>
        email === "grace@example.com"
          ? { person: { uid: "d02e77b4", displayName: "Grace Hopper", avatar: null } }
          : { person: null },
      ),
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

  it("config returns the public client ids, empty for a provider that is off", async () => {
    const res = await handleAuth(new Request("https://vapor.fyi/auth/config"), deps());
    expect(await res?.json()).toEqual({ googleClientId: "client-123", appleClientId: "" });
    const both = await handleAuth(new Request("https://vapor.fyi/auth/config"), deps({ appleClientId: "example.vapor.web" }));
    expect(await both?.json()).toEqual({ googleClientId: "client-123", appleClientId: "example.vapor.web" });
  });

  it("google happy path sets a secure session cookie and keys the profile on the Google sub", async () => {
    const d = deps();
    const res = await handleAuth(googlePost(), d);
    expect(res?.status).toBe(200);
    const cookie = res?.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("vp_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(d.upsertProfile).toHaveBeenCalledWith(
      "google:10769150350006150715113082367",
      expect.objectContaining({ displayName: "Ada", email: "ada@example.com", legacyPrincipal: "email:ada@example.com" }),
    );
    const body = (await res?.json()) as Record<string, unknown>;
    expect(body.uid).toBe("k3f0a9x2");
    expect(body.principal).toBeUndefined();
  });

  it("rejects cross-origin sign-in", async () => {
    const res = await handleAuth(googlePost("https://evil.example"), deps());
    expect(res?.status).toBe(403);
  });

  describe("apple", () => {
    const appleIdentity = { sub: "001234.abcd.5678", email: "Ada@Example.com", name: "ada@example.com" };
    function appleDeps(overrides: Partial<Parameters<typeof handleAuth>[1]> = {}) {
      return deps({
        appleClientId: "example.vapor.web",
        verifyApple: vi.fn(async () => appleIdentity),
        getProfile: vi.fn(async () => ({ profile: null })),
        ...overrides,
      });
    }
    function applePost(body: unknown, origin = "https://vapor.fyi") {
      return new Request("https://vapor.fyi/auth/apple", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("first authorization: keys the profile on the Apple sub and takes the name from the response", async () => {
      const d = appleDeps();
      const res = await handleAuth(
        applePost({ id_token: "tok", user: { name: { firstName: " Ada ", lastName: "Lovelace" }, email: "ada@example.com" } }),
        d,
      );
      expect(res?.status).toBe(200);
      expect(res?.headers.get("Set-Cookie")).toContain("vp_session=");
      expect(d.verifyApple).toHaveBeenCalledWith("tok", "example.vapor.web");
      expect(d.upsertProfile).toHaveBeenCalledWith("apple:001234.abcd.5678", {
        displayName: "Ada Lovelace",
        email: "ada@example.com",
      });
      // No legacy email principal: Apple accounts never existed under one.
      const info = (d.upsertProfile as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
      expect(info.legacyPrincipal).toBeUndefined();
      expect(info.avatar).toBeUndefined();
    });

    it("later sign-ins carry no name: the stored profile name is kept", async () => {
      const d = appleDeps({
        getProfile: vi.fn(async () => ({ profile: { uid: "k3f0a9x2", displayName: "Ada Lovelace", avatar: null } })),
      });
      await handleAuth(applePost({ id_token: "tok" }), d);
      expect(d.upsertProfile).toHaveBeenCalledWith(
        "apple:001234.abcd.5678",
        expect.objectContaining({ displayName: "Ada Lovelace" }),
      );
    });

    it("a brand-new account with no name falls back to the address", async () => {
      const d = appleDeps();
      await handleAuth(applePost({ id_token: "tok", user: { name: {} } }), d);
      expect(d.upsertProfile).toHaveBeenCalledWith(
        "apple:001234.abcd.5678",
        expect.objectContaining({ displayName: "ada@example.com" }),
      );
    });

    it("rejects cross-origin, missing token, bad token, and an instance without Apple configured", async () => {
      expect((await handleAuth(applePost({ id_token: "tok" }, "https://evil.example"), appleDeps()))?.status).toBe(403);
      expect((await handleAuth(applePost({}), appleDeps()))?.status).toBe(400);
      expect((await handleAuth(applePost({ id_token: "tok" }), appleDeps({ verifyApple: vi.fn(async () => null) })))?.status).toBe(401);
      expect((await handleAuth(applePost({ id_token: "tok" }), deps()))?.status).toBe(404);
    });
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
    expect(body.uid).toBe("k3f0a9x2");
    expect(body.email).toBe("ada@example.com");
    expect(body.principal).toBeUndefined();
    expect(body.agentSlug).toBeUndefined();
  });

  it("resolve needs a session, validates the address, and returns name and uid only", async () => {
    const d = deps();
    const anonymous = await handleAuth(new Request("https://vapor.fyi/auth/resolve?email=grace@example.com"), d);
    expect(anonymous?.status).toBe(401);

    const signIn = await handleAuth(googlePost(), d);
    const cookie = (signIn?.headers.get("Set-Cookie") ?? "").split(";")[0];
    const bad = await handleAuth(new Request("https://vapor.fyi/auth/resolve?email=grace", { headers: { Cookie: cookie } }), d);
    expect(bad?.status).toBe(400);

    const found = await handleAuth(
      new Request("https://vapor.fyi/auth/resolve?email=Grace@Example.com", { headers: { Cookie: cookie } }),
      d,
    );
    expect(await found?.json()).toEqual({ person: { uid: "d02e77b4", displayName: "Grace Hopper", avatar: null } });
    expect(d.resolveEmail).toHaveBeenCalledWith("google:10769150350006150715113082367", "grace@example.com");

    const missing = await handleAuth(
      new Request("https://vapor.fyi/auth/resolve?email=nobody@example.com", { headers: { Cookie: cookie } }),
      d,
    );
    expect(await missing?.json()).toEqual({ person: null });
  });

  it("logout clears the cookie", async () => {
    const res = await handleAuth(
      new Request("https://vapor.fyi/auth/logout", { method: "POST" }),
      deps(),
    );
    expect(res?.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
