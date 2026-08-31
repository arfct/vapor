import { describe, it, expect, vi } from "vitest";
import { handleOAuth, type OAuthRegistry } from "../../../workers/oauth";
import { mintSessionToken, verifySessionToken, SESSION_COOKIE } from "../../../app/lib/auth.server";
import type { AuthCode, OAuthClient, RefreshGrant } from "../../../agents/registry";

const SECRET = "oauth-test-secret";

/** In-memory OAuthRegistry fake mirroring the real Registry semantics. */
function fakeRegistry(): OAuthRegistry & { codes: Map<string, AuthCode> } {
  const clients = new Map<string, OAuthClient>();
  const codes = new Map<string, AuthCode>();
  const refresh = new Map<string, RefreshGrant>();
  let n = 0;
  return {
    codes,
    async registerClient(info) {
      const client: OAuthClient = {
        clientId: `client-${++n}`,
        name: info.name,
        redirectUris: info.redirectUris,
        createdAt: 0,
      };
      clients.set(client.clientId, client);
      return { client };
    },
    async getClient(clientId) {
      return { client: clients.get(clientId) ?? null };
    },
    async putCode(data) {
      const code = `code-${++n}`;
      codes.set(code, { ...data, exp: Date.now() + 60_000 });
      return { code };
    },
    async takeCode(code) {
      const data = codes.get(code) ?? null;
      codes.delete(code);
      return { data };
    },
    async putRefresh(data) {
      const token = `refresh-${++n}`;
      refresh.set(token, { ...data, exp: Date.now() + 60_000 });
      return { token };
    },
    async rotateRefresh(oldToken) {
      const data = refresh.get(oldToken);
      refresh.delete(oldToken);
      if (!data) return { error: { code: "invalid_grant", message: "unknown" } };
      const token = `refresh-${++n}`;
      refresh.set(token, data);
      return { token, data };
    },
    async revokeRefresh(token) {
      refresh.delete(token);
      return { ok: true };
    },
  };
}

async function pkcePair() {
  const verifier = "v".repeat(43);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

function deps(registry: OAuthRegistry) {
  return { secret: SECRET, registry };
}

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

async function registeredClient(registry: OAuthRegistry): Promise<string> {
  const res = await handleOAuth(
    new Request("https://vapor.fyi/oauth/register", {
      method: "POST",
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }),
    }),
    deps(registry),
  );
  const body = (await res?.json()) as { client_id: string };
  return body.client_id;
}

describe("oauth authorization server", () => {
  it("serves discovery documents with CORS", async () => {
    const res = await handleOAuth(
      new Request("https://vapor.fyi/.well-known/oauth-authorization-server"),
      deps(fakeRegistry()),
    );
    const meta = (await res?.json()) as Record<string, unknown>;
    expect(meta.issuer).toBe("https://vapor.fyi");
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(res?.headers.get("access-control-allow-origin")).toBe("*");

    const resource = await handleOAuth(
      new Request("https://vapor.fyi/.well-known/oauth-protected-resource/mcp"),
      deps(fakeRegistry()),
    );
    expect(((await resource?.json()) as Record<string, unknown>).resource).toBe(
      "https://vapor.fyi/mcp",
    );
  });

  it("registers clients and rejects bad redirect uris", async () => {
    const registry = fakeRegistry();
    const clientId = await registeredClient(registry);
    expect(clientId).toMatch(/^client-/);

    const bad = await handleOAuth(
      new Request("https://vapor.fyi/oauth/register", {
        method: "POST",
        body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
      }),
      deps(registry),
    );
    expect(bad?.status).toBe(400);
  });

  it("authorize without a session serves the sign-in consent page", async () => {
    const registry = fakeRegistry();
    const clientId = await registeredClient(registry);
    const { challenge } = await pkcePair();
    const res = await handleOAuth(
      new Request(
        `https://vapor.fyi/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`,
      ),
      deps(registry),
    );
    const html = (await res?.text()) ?? "";
    expect(html).toContain("accounts.google.com/gsi/client");
    expect(html).toContain("Claude");
  });

  it("unknown client never redirects", async () => {
    const res = await handleOAuth(
      new Request("https://vapor.fyi/oauth/authorize?client_id=nope&redirect_uri=https%3A%2F%2Fevil"),
      deps(fakeRegistry()),
    );
    expect(res?.status).toBe(400);
    expect(res?.headers.get("Location")).toBeNull();
  });

  it("full code + PKCE exchange carries the chosen capabilities", async () => {
    const registry = fakeRegistry();
    const clientId = await registeredClient(registry);
    const { verifier, challenge } = await pkcePair();
    const session = await mintSessionToken(
      { principal: "email:nicholas@artifact.com", email: "nicholas@artifact.com" },
      SECRET,
    );

    const approve = await handleOAuth(
      new Request("https://vapor.fyi/oauth/authorize", {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: REDIRECT,
          response_type: "code",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: "xyz",
          decision: "approve",
          caps: "write",
        }).toString(),
      }),
      deps(registry),
    );
    expect(approve?.status).toBe(302);
    const location = new URL(approve?.headers.get("Location") ?? "");
    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("xyz");

    const tokenRes = await handleOAuth(
      new Request("https://vapor.fyi/oauth/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code ?? "",
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: REDIRECT,
        }).toString(),
      }),
      deps(registry),
    );
    const tokens = (await tokenRes?.json()) as Record<string, string>;
    expect(tokens.token_type).toBe("Bearer");
    const claims = await verifySessionToken(tokens.access_token, SECRET);
    expect(claims?.principal).toBe("email:nicholas@artifact.com");
    expect(claims?.caps).toEqual(["suggest", "comment", "write"]);

    // refresh rotation
    const refreshed = await handleOAuth(
      new Request("https://vapor.fyi/oauth/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        }).toString(),
      }),
      deps(registry),
    );
    const rotated = (await refreshed?.json()) as Record<string, string>;
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    const replay = await handleOAuth(
      new Request("https://vapor.fyi/oauth/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        }).toString(),
      }),
      deps(registry),
    );
    expect(replay?.status).toBe(400);
  });

  it("wrong PKCE verifier and code reuse both fail", async () => {
    const registry = fakeRegistry();
    const clientId = await registeredClient(registry);
    const { verifier, challenge } = await pkcePair();
    const session = await mintSessionToken(
      { principal: "email:a@x.com", email: "a@x.com" },
      SECRET,
    );
    const approve = await handleOAuth(
      new Request("https://vapor.fyi/oauth/authorize", {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: REDIRECT,
          response_type: "code",
          code_challenge: challenge,
          code_challenge_method: "S256",
          decision: "approve",
        }).toString(),
      }),
      deps(registry),
    );
    const code = new URL(approve?.headers.get("Location") ?? "").searchParams.get("code") ?? "";

    const wrongVerifier = await handleOAuth(
      new Request("https://vapor.fyi/oauth/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: "w".repeat(43),
          client_id: clientId,
          redirect_uri: REDIRECT,
        }).toString(),
      }),
      deps(registry),
    );
    expect(wrongVerifier?.status).toBe(400);

    // the code was consumed by the failed attempt (single use)
    const reuse = await handleOAuth(
      new Request("https://vapor.fyi/oauth/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: REDIRECT,
        }).toString(),
      }),
      deps(registry),
    );
    expect(reuse?.status).toBe(400);
  });

  it("deny redirects with access_denied; default caps are suggest+comment", async () => {
    const registry = fakeRegistry();
    const clientId = await registeredClient(registry);
    const { challenge } = await pkcePair();
    const session = await mintSessionToken(
      { principal: "email:a@x.com", email: "a@x.com" },
      SECRET,
    );
    const base = {
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
    };
    const deny = await handleOAuth(
      new Request("https://vapor.fyi/oauth/authorize", {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
        body: new URLSearchParams({ ...base, decision: "deny" }).toString(),
      }),
      deps(registry),
    );
    expect(new URL(deny?.headers.get("Location") ?? "").searchParams.get("error")).toBe(
      "access_denied",
    );

    const approve = await handleOAuth(
      new Request("https://vapor.fyi/oauth/authorize", {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
        body: new URLSearchParams({ ...base, decision: "approve" }).toString(),
      }),
      deps(registry),
    );
    const code = new URL(approve?.headers.get("Location") ?? "").searchParams.get("code") ?? "";
    expect(registry.codes.get(code)?.caps ?? (await registry.takeCode(code)).data?.caps).toEqual([
      "suggest",
      "comment",
    ]);
  });

  it("accepts a CIMD url client_id by fetching its metadata document", async () => {
    const registry = fakeRegistry();
    const metadataUrl = "https://claude.ai/.well-known/mcp-client";
    const stubbedFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url ?? input.toString();
      if (url === metadataUrl) {
        return {
          ok: true,
          json: async () => ({ client_id: metadataUrl, client_name: "Claude", redirect_uris: [REDIRECT] }),
          clone() {
            return this as unknown as Response;
          },
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", stubbedFetch);
    try {
      const { challenge } = await pkcePair();
      const res = await handleOAuth(
        new Request(
          `https://vapor.fyi/oauth/authorize?client_id=${encodeURIComponent(metadataUrl)}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`,
        ),
        deps(registry),
      );
      // No stored registration needed: it reached the consent page (200),
      // not the "unknown client_id" error (400).
      expect(res?.status).toBe(200);
      expect(stubbedFetch).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a CIMD document whose redirect_uris don't cover the request", async () => {
    const registry = fakeRegistry();
    const metadataUrl = "https://evil.example/meta";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ redirect_uris: ["https://elsewhere.example/cb"] }),
        clone() {
          return this as unknown as Response;
        },
      })),
    );
    try {
      const res = await handleOAuth(
        new Request(
          `https://vapor.fyi/oauth/authorize?client_id=${encodeURIComponent(metadataUrl)}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code`,
        ),
        deps(registry),
      );
      // redirect_uri not in the document → treated as unknown client, 400,
      // and it must NOT redirect.
      expect(res?.status).toBe(400);
      expect(res?.headers.get("Location")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("revoke always returns 200", async () => {
    const res = await handleOAuth(
      new Request("https://vapor.fyi/oauth/revoke", {
        method: "POST",
        body: new URLSearchParams({ token: "whatever" }).toString(),
      }),
      deps(fakeRegistry()),
    );
    expect(res?.status).toBe(200);
  });
});
