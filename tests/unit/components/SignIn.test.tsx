// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import SignIn from "~/components/SignIn";

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${init?.method ?? "GET"} ${new URL(url, "https://vapor.fyi").pathname}`;
    const body = routes[key] ?? routes[new URL(url, "https://vapor.fyi").pathname] ?? {};
    return { ok: true, json: async () => body } as Response;
  });
}

describe("SignIn", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch({ "/auth/me": { signedIn: false } }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a Sign in button when signed out", async () => {
    render(createElement(SignIn));
    expect(await screen.findByText("Sign in")).toBeTruthy();
  });

  it("shows the display name when signed in, in a sign-out button", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/auth/me": { signedIn: true, displayName: "Nicholas" } }),
    );
    render(createElement(SignIn));
    const btn = await screen.findByTitle("Sign out");
    expect(btn.textContent).toContain("Nicholas");
  });

  it("posts to /auth/logout on sign out", async () => {
    const fetchMock = mockFetch({
      "/auth/me": { signedIn: true, displayName: "Nicholas" },
      "POST /auth/logout": { ok: true },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(SignIn));
    fireEvent.click(await screen.findByTitle("Sign out"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/auth/logout", { method: "POST" }),
    );
  });
});
