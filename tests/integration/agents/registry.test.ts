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

  it("upserts and reads a profile, preserving uid and slug on update", async () => {
    const reg = makeRegistry();
    const { profile } = await reg.upsertProfile("email:ada@example.com", {
      displayName: "Ada L",
    });
    expect(profile.uid).toBeTruthy();
    expect(profile.agentSlug).toBeNull();

    const slug = await reg.ensureAgentSlug("email:ada@example.com");
    expect(slug).toEqual({ slug: "ada-l" });

    const updated = await reg.upsertProfile("email:ada@example.com", {
      displayName: "Ada",
      avatar: "https://example.com/a.png",
    });
    expect(updated.profile.uid).toBe(profile.uid);
    expect(updated.profile.agentSlug).toBe("ada-l");
    expect(updated.profile.avatar).toBe("https://example.com/a.png");
  });

  it("uniquifies agent slugs globally and keeps them stable", async () => {
    const reg = makeRegistry();
    await reg.upsertProfile("email:a@x.com", { displayName: "Ada L" });
    await reg.upsertProfile("email:b@x.com", { displayName: "Ada L" });
    expect(await reg.ensureAgentSlug("email:a@x.com")).toEqual({ slug: "ada-l" });
    expect(await reg.ensureAgentSlug("email:b@x.com")).toEqual({ slug: "ada-l-2" });
    expect(await reg.ensureAgentSlug("email:a@x.com")).toEqual({ slug: "ada-l" });
  });

  it("ensureAgentSlug without a profile errors", async () => {
    const reg = makeRegistry();
    expect(await reg.ensureAgentSlug("email:ghost@x.com")).toMatchObject({
      error: { code: "not_found" },
    });
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
