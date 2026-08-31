// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { renderWithDocument } from "../../helpers/document-context";
import HeaderMenu from "~/components/HeaderMenu";

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${init?.method ?? "GET"} ${new URL(url, "https://vapor.fyi").pathname}`;
    const body = routes[key] ?? routes[new URL(url, "https://vapor.fyi").pathname] ?? {};
    return { ok: true, json: async () => body } as Response;
  });
}

describe("HeaderMenu", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch({ "/auth/me": { signedIn: false } }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens with status, Agents, and theme rows", async () => {
    const onOpenAgents = vi.fn();
    renderWithDocument(createElement(HeaderMenu, { onOpenAgents }));
    fireEvent.click(screen.getByLabelText("Menu"));

    expect(screen.getByText("Agents")).toBeTruthy();
    expect(screen.getByText("Theme")).toBeTruthy();
    expect(screen.getByText("Connecting")).toBeTruthy();
    expect(screen.getByLabelText("Light")).toBeTruthy();
    expect(screen.getByLabelText("Dark")).toBeTruthy();
    expect(screen.getByLabelText("Auto")).toBeTruthy();
  });

  it("Agents row closes the menu and opens the panel", () => {
    const onOpenAgents = vi.fn();
    renderWithDocument(createElement(HeaderMenu, { onOpenAgents }));
    fireEvent.click(screen.getByLabelText("Menu"));
    fireEvent.click(screen.getByText("Agents"));
    expect(onOpenAgents).toHaveBeenCalledOnce();
    expect(screen.queryByText("Theme")).toBeFalsy();
  });

  it("shows display name and sign-out when signed in", async () => {
    const fetchMock = mockFetch({
      "/auth/me": { signedIn: true, displayName: "Ada" },
      "POST /auth/logout": { ok: true },
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithDocument(createElement(HeaderMenu, { onOpenAgents: vi.fn() }));
    fireEvent.click(screen.getByLabelText("Menu"));

    expect(await screen.findByText("Ada")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Sign out"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/auth/logout", { method: "POST" }),
    );
  });
});
