import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const { mockRoster, mockRevoke } = vi.hoisted(() => ({
  mockRoster: vi.fn(),
  mockRevoke: vi.fn(),
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({
    getAgentRoster: mockRoster,
    revokeAgentEntry: mockRevoke,
  }),
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({
    env: { DocumentAgent: {} },
  }),
}));

import { action, loader } from "~/routes/doc.$id.agents";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const context = {} as Parameters<typeof action>[0]["context"];

function loaderArgs(id: string) {
  return {
    params: { id },
    context,
    request: new Request(`https://vapor.example.com/${id}/agents`),
  } as unknown as Parameters<typeof loader>[0];
}

function actionArgs(id: string, body: unknown) {
  return {
    params: { id },
    context,
    request: new Request(`https://vapor.example.com/${id}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<typeof action>[0];
}

const rosterEntry = {
  name: "scribe",
  color: "#E57373",
  owner: null,
  capabilities: ["suggest", "comment"],
  createdAt: 1000,
  lastSeenAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("GET /:id/agents (loader)", () => {
  it("returns 404 for an invalid document id", async () => {
    const response = (await loader(loaderArgs("bad"))) as Response;
    expect(response.status).toBe(404);
  });

  it("returns the roster as JSON", async () => {
    mockRoster.mockResolvedValue([rosterEntry]);
    const response = (await loader(loaderArgs("abcd1234"))) as Response;
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual([rosterEntry]);
  });
});

describe("POST /:id/agents (action)", () => {
  it("returns 404 for an invalid document id", async () => {
    const response = (await action(
      actionArgs("bad", { intent: "revoke", name: "scribe" }),
    )) as Response;
    expect(response.status).toBe(404);
  });

  it("returns 410 Gone for the retired mint intent", async () => {
    const response = (await action(
      actionArgs("abcd1234", { intent: "mint", name: "scribe" }),
    )) as Response;
    expect(response.status).toBe(410);
  });

  it("revokes an agent entry", async () => {
    mockRevoke.mockResolvedValue({ ok: true });
    const response = (await action(
      actionArgs("abcd1234", { intent: "revoke", name: "scribe" }),
    )) as Response;
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ ok: true });
    expect(mockRevoke).toHaveBeenCalledWith("scribe");
  });

  it("returns 404 with the DO error for doc_not_found on revoke", async () => {
    mockRevoke.mockResolvedValue({
      error: { code: "doc_not_found", message: "Document does not exist" },
    });
    const response = (await action(
      actionArgs("abcd1234", { intent: "revoke", name: "scribe" }),
    )) as Response;
    expect(response.status).toBe(404);
  });

  it("returns 400 for an unknown intent", async () => {
    const response = (await action(actionArgs("abcd1234", { intent: "bogus" }))) as Response;
    expect(response.status).toBe(400);
  });

  it("returns 400 for a missing name on revoke", async () => {
    const response = (await action(actionArgs("abcd1234", { intent: "revoke" }))) as Response;
    expect(response.status).toBe(400);
  });
});
