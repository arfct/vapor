import { describe, it, expect, vi } from "vitest";
import { handleVersionRequest, type VersionStub } from "../../../agents/version-routes";
import type { VersionSummary } from "../../../app/shared/version-policy";

const summary: VersionSummary = {
  id: 7,
  createdAt: 1,
  reason: "idle",
  author: { kind: "human", id: "u1", name: "Ada", color: "#000" },
  contributors: [],
  bytes: 12,
  restoredFrom: null,
};

function stub(overrides: Partial<VersionStub> = {}): VersionStub {
  return {
    listVersions: vi.fn(() => [summary]),
    getVersionMarkdown: vi.fn((id: number) => (id === 7 ? "# Seven" : null)),
    saveVersion: vi.fn(() => ({ id: 8 })),
    restoreVersion: vi.fn(() => ({ ok: true as const })),
    ...overrides,
  };
}

const base = "https://vapor.fyi/agents/document-agent/abcd1234";

describe("handleVersionRequest", () => {
  it("ignores paths that aren't about versions", async () => {
    expect(await handleVersionRequest(new Request(base), stub())).toBeNull();
    expect(await handleVersionRequest(new Request(`${base}/agents`), stub())).toBeNull();
  });

  it("answers a malformed versions path itself rather than letting it fall through", async () => {
    const s = stub();
    const res = await handleVersionRequest(
      new Request(`${base}/versions/undefined/restore`, { method: "POST", headers: { Origin: "https://vapor.fyi" } }),
      s,
    );
    expect(res!.status).toBe(404);
    expect(s.restoreVersion).not.toHaveBeenCalled();
  });

  it("lists versions as JSON without markdown", async () => {
    const res = await handleVersionRequest(new Request(`${base}/versions`), stub());
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as VersionSummary[];
    expect(body[0].id).toBe(7);
    expect("markdown" in body[0]).toBe(false);
  });

  it("serves one version as markdown, nosniff, and 404s a missing one", async () => {
    const ok = await handleVersionRequest(new Request(`${base}/versions/7`), stub());
    expect(ok!.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(ok!.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await ok!.text()).toBe("# Seven");
    const missing = await handleVersionRequest(new Request(`${base}/versions/9`), stub());
    expect(missing!.status).toBe(404);
  });

  it("restores with the requesting user as actor, same-origin only", async () => {
    const s = stub();
    const res = await handleVersionRequest(
      new Request(`${base}/versions/7/restore`, {
        method: "POST",
        headers: { Origin: "https://vapor.fyi", "Content-Type": "application/json" },
        body: JSON.stringify({ user: { id: "u2", name: "Quiet Otter", color: "#abc", animal: "🦦" } }),
      }),
      s,
    );
    expect(res!.status).toBe(200);
    expect(s.restoreVersion).toHaveBeenCalledWith(7, expect.objectContaining({ kind: "human", name: "Quiet Otter", animal: "🦦" }));

    const foreign = await handleVersionRequest(
      new Request(`${base}/versions/7/restore`, { method: "POST", headers: { Origin: "https://evil.example" } }),
      s,
    );
    expect(foreign!.status).toBe(403);
    expect(s.restoreVersion).toHaveBeenCalledTimes(1);
  });

  it("maps stub errors to statuses", async () => {
    const s = stub({ restoreVersion: vi.fn(() => ({ error: "rate_limited" })) });
    const res = await handleVersionRequest(
      new Request(`${base}/versions/7/restore`, { method: "POST", headers: { Origin: "https://vapor.fyi" } }),
      s,
    );
    expect(res!.status).toBe(429);
  });

  it("saves a manual version", async () => {
    const s = stub();
    const res = await handleVersionRequest(
      new Request(`${base}/versions`, {
        method: "POST",
        headers: { Origin: "https://vapor.fyi", "Content-Type": "application/json" },
        body: JSON.stringify({ user: { name: "Ada" } }),
      }),
      s,
    );
    expect(await res!.json()).toEqual({ id: 8 });
    expect(s.saveVersion).toHaveBeenCalledWith("manual", expect.objectContaining({ name: "Ada" }));
  });
});
