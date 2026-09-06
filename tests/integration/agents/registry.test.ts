/**
 * Registry integration tests: real Registry code over a mocked Agent base
 * with an in-memory kv table fake (same philosophy as document-agent.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let kvStore: Map<string, string>;

vi.mock("agents", () => ({
  Agent: class MockAgent {
    name = "global";
    env = {};
    ctx = { storage: {} };

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("?").toLowerCase().replace(/\s+/g, " ").trim();
      if (query.includes("create table")) return [];
      if (query.startsWith("insert into kv")) {
        kvStore.set(String(values[0]), String(values[1]));
        return [];
      }
      if (query.startsWith("select value from kv")) {
        const value = kvStore.get(String(values[0]));
        return value === undefined ? [] : [{ value }];
      }
      if (query.startsWith("delete from kv")) {
        kvStore.delete(String(values[0]));
        return [];
      }
      throw new Error(`kv mock: unhandled query: ${query}`);
    }
  },
}));

import Registry from "../../../agents/registry";

function makeRegistry() {
  kvStore = new Map();
  return new Registry({} as never, {} as never);
}

describe("Registry", () => {
  beforeEach(() => {
    kvStore = new Map();
  });

  it("upserts and reads a profile, minting a short uid and keeping it on update", async () => {
    const reg = makeRegistry();
    const { profile } = await reg.upsertProfile("google:1001", { displayName: "Ada L", email: "Ada@Example.com" });
    expect(profile.uid).toMatch(/^[a-z0-9]{8}$/);
    expect(profile.email).toBe("ada@example.com");

    const updated = await reg.upsertProfile("google:1001", {
      displayName: "Ada",
      avatar: "https://example.com/a.png",
    });
    expect(updated.profile.uid).toBe(profile.uid);
    expect(updated.profile.email).toBe("ada@example.com");
    expect(updated.profile.avatar).toBe("https://example.com/a.png");
    expect((await reg.getProfile("google:1001")).profile?.displayName).toBe("Ada");
  });

  it("re-keys a legacy email principal onto the Google one, carrying the wake target and aliasing the old key", async () => {
    const reg = makeRegistry();
    (reg as unknown as { env: Record<string, string> }).env = { SESSION_SECRET: "test-secret" };
    const legacy = await reg.upsertProfile("email:ada@example.com", { displayName: "Ada L" });
    await reg.setWakeTarget("email:ada@example.com", {
      kind: "webhook",
      url: "https://example.com/wake",
      secret: "whsec_" + "a".repeat(32),
    });

    const { profile } = await reg.upsertProfile("google:1001", {
      displayName: "Ada L",
      email: "ada@example.com",
      legacyPrincipal: "email:ada@example.com",
    });
    expect(profile.principal).toBe("google:1001");
    expect(profile.uid).toMatch(/^[a-z0-9]{8}$/);
    expect(profile.uid).not.toBe(legacy.profile.uid);
    expect(kvStore.has("p:email:ada@example.com")).toBe(false);
    expect(kvStore.has(`u:${legacy.profile.uid}`)).toBe(false);

    // A session or grant minted under the old principal still resolves.
    expect((await reg.getProfile("email:ada@example.com")).profile?.uid).toBe(profile.uid);
    expect((await reg.getWakeTarget("google:1001")).target?.url).toBe("https://example.com/wake");
    expect((await reg.getWakeTarget("email:ada@example.com")).target?.url).toBe("https://example.com/wake");
  });

  it("resolves a typed address to name and uid, rate-limited per requester", async () => {
    const reg = makeRegistry();
    await reg.upsertProfile("google:1001", { displayName: "Ada L", email: "ada@example.com" });
    await reg.upsertProfile("google:2002", { displayName: "Grace H", email: "grace@example.com", avatar: "g.png" });

    const found = await reg.resolveEmail("google:1001", "Grace@Example.com");
    expect(found).toMatchObject({ person: { displayName: "Grace H", avatar: "g.png" } });
    expect("person" in found && found.person?.uid).toMatch(/^[a-z0-9]{8}$/);
    expect(JSON.stringify(found)).not.toContain("grace@example.com");
    expect(await reg.resolveEmail("google:1001", "nobody@example.com")).toEqual({ person: null });

    for (let i = 0; i < 40; i++) await reg.resolveEmail("google:2002", "ada@example.com");
    expect(await reg.resolveEmail("google:2002", "ada@example.com")).toMatchObject({ error: { code: "rate_limited" } });
    expect(await reg.resolveEmail("google:1001", "ada@example.com")).toMatchObject({ person: { displayName: "Ada L" } });
  });

  it("auth codes are single use and expire", async () => {
    const reg = makeRegistry();
    const { code } = await reg.putCode({
      clientId: "c1",
      principal: "email:a@x.com",
      email: "a@x.com",
      caps: ["suggest", "comment"],
      codeChallenge: "challenge",
      redirectUri: "https://client/cb",
    });
    const first = await reg.takeCode(code);
    expect(first.data?.principal).toBe("email:a@x.com");
    const second = await reg.takeCode(code);
    expect(second.data).toBeNull();
  });

  it("refresh tokens rotate; the old token dies; revoke kills the new one", async () => {
    const reg = makeRegistry();
    const { token } = await reg.putRefresh({
      clientId: "c1",
      principal: "email:a@x.com",
      email: "a@x.com",
      caps: ["suggest", "comment", "write"],
    });
    // hashed at rest: the raw token never appears as a storage key
    expect([...kvStore.keys()].some((k) => k.includes(token))).toBe(false);
    const rotated = await reg.rotateRefresh(token);
    expect("token" in rotated && rotated.data.caps).toContain("write");
    expect(await reg.rotateRefresh(token)).toMatchObject({ error: { code: "invalid_grant" } });
    if ("token" in rotated) {
      await reg.revokeRefresh(rotated.token);
      expect(await reg.rotateRefresh(rotated.token)).toMatchObject({
        error: { code: "invalid_grant" },
      });
    }
  });

  it("registers and fetches oauth clients", async () => {
    const reg = makeRegistry();
    const { client } = await reg.registerClient({
      name: "Claude Code",
      redirectUris: ["https://claude.ai/cb"],
    });
    const fetched = await reg.getClient(client.clientId);
    expect(fetched.client?.name).toBe("Claude Code");
    expect((await reg.getClient("nope")).client).toBeNull();
  });
});

describe("Registry wake targets", () => {
  const PRINCIPAL = "email:ada@example.com";
  const FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_abc123/fire";
  const TOKEN = "sk-ant-oat01-abcdefghijklmnop";
  const event = {
    name: "mention" as const,
    docId: "27c90a3o",
    agent: "ada-l",
    text: "@ada-l hello",
    timestamp: "2026-09-06T05:50:00.000Z",
    eventId: "27c90a3o:3",
  };

  function makeWakeRegistry() {
    const reg = makeRegistry();
    (reg as unknown as { env: Record<string, string> }).env = { SESSION_SECRET: "registry-test-secret" };
    return reg;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores a sealed secret and shows only a hint", async () => {
    const reg = makeWakeRegistry();
    expect(await reg.getWakeTarget(PRINCIPAL)).toEqual({ target: null });
    const set = await reg.setWakeTarget(PRINCIPAL, { kind: "claude-routine", url: FIRE_URL, secret: TOKEN });
    expect(set).toMatchObject({ target: { kind: "claude-routine", url: FIRE_URL, secretHint: "…mnop", firesToday: 0 } });
    const stored = JSON.parse(kvStore.get(`w:${PRINCIPAL}`)!);
    expect(stored.sealedSecret).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain(TOKEN);
    expect(await reg.deleteWakeTarget(PRINCIPAL)).toEqual({ ok: true });
    expect(await reg.getWakeTarget(PRINCIPAL)).toEqual({ target: null });
  });

  it("refuses an invalid target with the policy's message", async () => {
    const reg = makeWakeRegistry();
    const res = await reg.setWakeTarget(PRINCIPAL, { kind: "claude-routine", url: FIRE_URL, secret: "nope" });
    expect(res).toMatchObject({ error: { code: "invalid_params", message: expect.stringContaining("sk-ant-oat01-") } });
  });

  it("fires the routine with its headers and text, and records the outcome", async () => {
    const reg = makeWakeRegistry();
    await reg.setWakeTarget(PRINCIPAL, { kind: "claude-routine", url: FIRE_URL, secret: TOKEN });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await reg.wake({ principal: PRINCIPAL, event });
    expect(outcome).toEqual({ fired: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FIRE_URL);
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "anthropic-beta": expect.stringContaining("routine") });
    expect(JSON.parse(init.body as string).text).toContain("mentioned @ada-l");
    const { target } = await reg.getWakeTarget(PRINCIPAL);
    expect(target).toMatchObject({ lastStatus: 200, lastError: null, firesToday: 1 });
    expect(target!.lastFiredAt).toBeTypeOf("number");
  });

  it("throttles a second fire for the same document and reports a failed delivery without retrying", async () => {
    const reg = makeWakeRegistry();
    await reg.setWakeTarget(PRINCIPAL, { kind: "webhook", url: "https://relay.example.com/hook", secret: "tok" });
    const fetchMock = vi.fn(async () => new Response("routine paused", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await reg.wake({ principal: PRINCIPAL, event });
    expect(first).toMatchObject({ fired: false, reason: "delivery", status: 400, error: expect.stringContaining("HTTP 400") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const second = await reg.wake({ principal: PRINCIPAL, event: { ...event, eventId: "27c90a3o:4" } });
    expect(second).toEqual({ fired: false, reason: "throttled" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await reg.getWakeTarget(PRINCIPAL)).target).toMatchObject({ lastStatus: 400, lastError: expect.stringContaining("routine paused") });
  });

  it("does nothing for a principal with no target, and a test fire bypasses the per-document throttle", async () => {
    const reg = makeWakeRegistry();
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await reg.wake({ principal: PRINCIPAL, event })).toEqual({ fired: false, reason: "no_target" });
    await reg.setWakeTarget(PRINCIPAL, { kind: "webhook", url: "https://relay.example.com/hook", secret: "" });
    await reg.wake({ principal: PRINCIPAL, event });
    const test = await reg.wake({ principal: PRINCIPAL, event: { ...event, name: "test", eventId: "test:1" } });
    expect(test).toEqual({ fired: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cannot open a secret sealed under another deployment's session secret", async () => {
    const reg = makeWakeRegistry();
    await reg.setWakeTarget(PRINCIPAL, { kind: "webhook", url: "https://relay.example.com/hook", secret: "tok" });
    // Same storage, different deployment secret: construct directly so the kv store is shared.
    const other = new Registry({} as never, {} as never);
    (other as unknown as { env: Record<string, string> }).env = { SESSION_SECRET: "a-different-secret" };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await other.wake({ principal: PRINCIPAL, event })).toEqual({ fired: false, reason: "unsealable" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await other.getWakeTarget(PRINCIPAL)).target?.lastError).toMatch(/save the target again/);
  });
});
