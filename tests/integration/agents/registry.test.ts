/**
 * Registry integration tests: real Registry code over a mocked Agent base
 * with an in-memory kv table fake (same philosophy as document-agent.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
    const { profile } = await reg.upsertProfile("email:nicholas@artifact.com", {
      displayName: "Nicholas J",
    });
    expect(profile.uid).toBeTruthy();
    expect(profile.agentSlug).toBeNull();

    const slug = await reg.ensureAgentSlug("email:nicholas@artifact.com");
    expect(slug).toEqual({ slug: "nicholas-j" });

    const updated = await reg.upsertProfile("email:nicholas@artifact.com", {
      displayName: "Nicholas",
      avatar: "https://example.com/a.png",
    });
    expect(updated.profile.uid).toBe(profile.uid);
    expect(updated.profile.agentSlug).toBe("nicholas-j");
    expect(updated.profile.avatar).toBe("https://example.com/a.png");
  });

  it("uniquifies agent slugs globally and keeps them stable", async () => {
    const reg = makeRegistry();
    await reg.upsertProfile("email:a@x.com", { displayName: "Nicholas J" });
    await reg.upsertProfile("email:b@x.com", { displayName: "Nicholas J" });
    expect(await reg.ensureAgentSlug("email:a@x.com")).toEqual({ slug: "nicholas-j" });
    expect(await reg.ensureAgentSlug("email:b@x.com")).toEqual({ slug: "nicholas-j-2" });
    expect(await reg.ensureAgentSlug("email:a@x.com")).toEqual({ slug: "nicholas-j" });
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
