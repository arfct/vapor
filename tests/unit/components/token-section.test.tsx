// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import TokenSection from "~/components/TokenSection";

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url, "https://vapor.example").pathname;
    const key = `${init?.method ?? "GET"} ${path}`;
    const body = routes[key] ?? routes[path] ?? {};
    return { ok: true, json: async () => body } as Response;
  });
}

describe("TokenSection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks a signed-out person to sign in", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/auth/me": { signedIn: false } }));
    renderWithDocument(createElement(TokenSection, { mcpUrl: "https://vapor.example/mcp" }));
    expect(await screen.findByText(/Sign in to mint a long-lived token/)).toBeTruthy();
  });

  it("lists tokens, mints one and shows it once, and revokes", async () => {
    const existing = { id: "abcdef012345", label: "build box", caps: ["suggest", "comment"], createdAt: 1, lastUsedAt: null, hint: "wxyz" };
    const minted = { id: "0123456789ab", label: "laptop", caps: ["suggest", "comment", "write"], createdAt: 2, lastUsedAt: null, hint: "abcd" };
    const fetchMock = mockFetch({
      "/auth/me": { signedIn: true, displayName: "Ada", email: "ada@example.com" },
      "GET /me/tokens": { tokens: [existing] },
      "POST /me/tokens": { token: "vpt_freshly_minted_abcd", view: minted },
      "DELETE /me/tokens": { ok: true },
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithDocument(createElement(TokenSection, { mcpUrl: "https://vapor.example/mcp" }));

    expect(await screen.findByText("build box")).toBeTruthy();
    fireEvent.click(screen.getByText("New token"));
    fireEvent.change(screen.getByLabelText("Token label"), { target: { value: "laptop" } });
    fireEvent.change(screen.getByLabelText("Grant"), { target: { value: "write" } });
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(screen.getByText("vpt_freshly_minted_abcd")).toBeTruthy());
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ label: "laptop", grant: "write" });
    expect(screen.getByText("laptop")).toBeTruthy();

    fireEvent.click(screen.getAllByText("Revoke")[0]);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/me/tokens?id=abcdef012345", expect.objectContaining({ method: "DELETE" })),
    );
    await waitFor(() => expect(screen.queryByText("build box")).toBeNull());
  });
});
