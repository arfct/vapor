// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act } from "@testing-library/react";
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
    vi.useRealTimers();
  });

  it("opens with theme rows", async () => {
    renderWithDocument(createElement(HeaderMenu));
    fireEvent.click(screen.getByLabelText("Menu"));

    expect(screen.getByText("Theme")).toBeTruthy();
    expect(screen.getByLabelText("Light")).toBeTruthy();
    expect(screen.getByLabelText("Dark")).toBeTruthy();
    expect(screen.getByLabelText("Auto")).toBeTruthy();
  });

  it("shows display name and sign-out when signed in", async () => {
    const fetchMock = mockFetch({
      "/auth/me": { signedIn: true, displayName: "Ada" },
      "POST /auth/logout": { ok: true },
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithDocument(createElement(HeaderMenu));
    fireEvent.click(screen.getByLabelText("Menu"));

    expect(await screen.findByText("Ada")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Sign out"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/auth/logout", { method: "POST" }),
    );
  });

  it("falls back to a note when Google Identity Services never loads", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/auth/me": { signedIn: false },
        "/auth/config": { googleClientId: "client-id" },
      }),
    );
    delete window.google;

    renderWithDocument(createElement(HeaderMenu));
    // Let /auth/me settle first; a session change re-runs the mount effect
    // and would restart the fallback timer mid-test.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByLabelText("Menu"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });
    expect(screen.queryByText(/Sign-in needs a full browser/)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(
      screen.getByText("Sign-in needs a full browser — open this page in Safari or Chrome."),
    ).toBeTruthy();
  });
});
