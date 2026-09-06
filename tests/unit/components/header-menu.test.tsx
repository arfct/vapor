// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { renderWithDocument } from "../../helpers/document-context";
import HeaderMenu from "~/components/HeaderMenu";
import type { ThreadData } from "~/shared/types";

const thread = (id: string, resolved = false): ThreadData =>
  ({ id, resolved, replies: [], author: { name: "A", color: "#000" }, text: "t", createdAt: 1 }) as unknown as ThreadData;

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

    expect(screen.getByText("VAPOR")).toBeTruthy();
    expect(screen.getByLabelText("Light")).toBeTruthy();
    expect(screen.getByLabelText("Dark")).toBeTruthy();
    expect(screen.getByLabelText("Auto")).toBeTruthy();
  });

  it("shows the email and a Sign out row when signed in", async () => {
    const fetchMock = mockFetch({
      "/auth/me": { signedIn: true, displayName: "Ada", email: "ada@example.com" },
      "POST /auth/logout": { ok: true },
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithDocument(createElement(HeaderMenu));
    fireEvent.click(screen.getByLabelText("Menu"));

    expect(await screen.findByText("ada@example.com")).toBeTruthy();
    fireEvent.click(screen.getByText("Sign out"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/auth/logout", { method: "POST" }),
    );
  });

  it("offers a Sign in row while signed out that opens the dialog, and none without a handler", async () => {
    const onSignIn = vi.fn();
    renderWithDocument(createElement(HeaderMenu, { onSignIn }));
    fireEvent.click(screen.getByLabelText("Menu"));
    fireEvent.click(await screen.findByText("Sign in"));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    // Rows close the menu when chosen.
    await waitFor(() => expect(screen.queryByText("Sign in")).toBeNull());

    renderWithDocument(createElement(HeaderMenu));
    fireEvent.click(screen.getAllByLabelText("Menu").at(-1)!);
    await waitFor(() => expect(screen.getAllByRole("group", { name: "Editing mode" }).length).toBeGreaterThan(0));
    expect(screen.queryByText("Sign in")).toBeNull();
  });

  it("trigger shows the mode when it isn't plain Edit", () => {
    renderWithDocument(createElement(HeaderMenu), { context: { mode: "suggest" } });
    expect(screen.getByLabelText("Menu").getAttribute("title")).toBe("Suggest");
  });

  it("switches mode and starts a comment from the menu", async () => {
    const { contextValue } = renderWithDocument(createElement(HeaderMenu));
    fireEvent.click(screen.getByLabelText("Menu"));
    fireEvent.click(await screen.findByText("Suggest"));
    expect(contextValue.setMode).toHaveBeenCalledWith("suggest");
    fireEvent.click(screen.getByLabelText("Menu"));
    fireEvent.click(await screen.findByText("New comment"));
    expect(contextValue.openCommentInput).toHaveBeenCalled();
  });

  it("offers the comments toggle, with the open count, only when given one", async () => {
    const onToggle = vi.fn();
    renderWithDocument(createElement(HeaderMenu, { comments: { open: false, onToggle } }), {
      context: { threads: [thread("a"), thread("b"), thread("c", true)] },
    });
    fireEvent.click(screen.getByLabelText("Menu"));
    const row = await screen.findByText("Show comments");
    expect(row.parentElement?.textContent).toContain("2");
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalled();
  });

  it("has no comments toggle without one", async () => {
    renderWithDocument(createElement(HeaderMenu));
    fireEvent.click(screen.getByLabelText("Menu"));
    await screen.findByText("New comment");
    expect(screen.queryByText("Show comments")).toBeNull();
    expect(screen.queryByText("Invite an agent")).toBeNull();
  });

  it("asks for a version before Accept all, and offers History only on documents", async () => {
    const editor = {
      on() {},
      off() {},
      schema: { marks: {} },
      state: { selection: { empty: true } },
      chain: () => ({ focus: () => ({ command: () => ({ run() {} }) }) }),
    };
    const onHistory = vi.fn();
    const { contextValue } = renderWithDocument(createElement(HeaderMenu, { onHistory }), {
      context: { editorInstance: editor as never },
    });
    fireEvent.click(screen.getByLabelText("Menu"));
    fireEvent.click(await screen.findByText("History"));
    expect(onHistory).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText("Menu"));
    const accept = await screen.findByText("Accept all");
    expect(accept.closest("button")?.hasAttribute("disabled")).toBe(true);
    expect(contextValue.requestSnapshot).not.toHaveBeenCalled();
  });
});
