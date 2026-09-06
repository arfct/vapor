// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import { createElement } from "react";
import { renderWithDocument } from "../../helpers/document-context";
import SignInDialog from "~/components/SignInDialog";

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${init?.method ?? "GET"} ${new URL(url, "https://vapor.example").pathname}`;
    const body = routes[key] ?? routes[new URL(url, "https://vapor.example").pathname] ?? {};
    return { ok: true, json: async () => body } as Response;
  });
}

describe("SignInDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch({ "/auth/me": { signedIn: false } }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete window.AppleID;
    delete window.google;
  });

  it("renders nothing while closed and a titled dialog when open", () => {
    const { rerender } = renderWithDocument(createElement(SignInDialog, { open: false, onClose: () => {} }));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(createElement(SignInDialog, { open: true, onClose: () => {} }));
    expect(screen.getByRole("dialog", { name: "Sign in" })).toBeTruthy();
  });

  it("falls back to a note when Google Identity Services never loads", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/auth/me": { signedIn: false }, "/auth/config": { googleClientId: "client-id", appleClientId: "" } }),
    );
    renderWithDocument(createElement(SignInDialog, { open: true, onClose: () => {} }));
    // Let /auth/me settle first; a session change re-runs the mount effect
    // and would restart the fallback timer mid-test.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });
    expect(screen.queryByText(/Sign-in needs a full browser/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByText("Sign-in needs a full browser — open this page in Safari or Chrome.")).toBeTruthy();
  });

  it("offers Sign in with Apple only when configured, and posts the popup result", async () => {
    const fetchMock = mockFetch({
      "/auth/me": { signedIn: false },
      "/auth/config": { googleClientId: "", appleClientId: "example.vapor.web" },
      "POST /auth/apple": { signedIn: true },
    });
    vi.stubGlobal("fetch", fetchMock);
    const init = vi.fn();
    const signIn = vi.fn(async () => ({
      authorization: { id_token: "apple-tok", code: "c" },
      user: { name: { firstName: "Ada", lastName: "Lovelace" } },
    }));
    window.AppleID = { auth: { init, signIn } };

    renderWithDocument(createElement(SignInDialog, { open: true, onClose: () => {} }));
    fireEvent.click(await screen.findByRole("button", { name: /Sign in with Apple/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/auth/apple",
        expect.objectContaining({ method: "POST", body: expect.stringContaining('"id_token":"apple-tok"') }),
      ),
    );
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "example.vapor.web", usePopup: true, redirectURI: `${window.location.origin}/auth/apple` }),
    );
    const posted = JSON.parse((fetchMock.mock.calls.find((c) => c[0] === "/auth/apple")?.[1] as RequestInit).body as string);
    expect(posted.user.name.firstName).toBe("Ada");
  });

  it("shows no Apple button when only Google is configured, and says so when nothing is", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/auth/me": { signedIn: false }, "/auth/config": { googleClientId: "client-id", appleClientId: "" } }),
    );
    const first = renderWithDocument(createElement(SignInDialog, { open: true, onClose: () => {} }));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /Sign in with Apple/ })).toBeNull();
    first.unmount();

    vi.stubGlobal("fetch", mockFetch({ "/auth/me": { signedIn: false }, "/auth/config": { googleClientId: "", appleClientId: "" } }));
    renderWithDocument(createElement(SignInDialog, { open: true, onClose: () => {} }));
    expect(await screen.findByText("This instance has no sign-in provider configured.")).toBeTruthy();
  });

  it("closes itself once a session exists", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/auth/me": { signedIn: true, displayName: "Ada", email: "ada@example.com" } }));
    const onClose = vi.fn();
    renderWithDocument(createElement(SignInDialog, { open: true, onClose }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
