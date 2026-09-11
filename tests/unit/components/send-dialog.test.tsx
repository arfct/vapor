// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import SendDialog from "~/components/SendDialog";

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url, "https://vapor.example").pathname;
    const key = `${init?.method ?? "GET"} ${path}`;
    const body = routes[key] ?? routes[path] ?? {};
    return { ok: !(body as { error?: string }).error, json: async () => body } as Response;
  });
}

describe("SendDialog (#100)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers the EPUB to everyone and asks a signed-out person to sign in for sending", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/auth/me": { signedIn: false } }));
    renderWithDocument(createElement(SendDialog, { open: true, onClose: () => {}, docId: "abcd1234" }));
    expect(await screen.findByText(/Sign in to save your Send to Kindle address/)).toBeTruthy();
    expect(screen.getByText("Download EPUB").closest("a")?.getAttribute("href")).toBe("/abcd1234.epub");
  });

  it("saves a Kindle address, then sends, and pairs a reMarkable", async () => {
    const fetchMock = mockFetch({
      "/auth/me": { signedIn: true, displayName: "Ada", email: "ada@example.com" },
      "GET /me/devices": { devices: { kindleEmail: null, remarkable: null }, kindleMail: { from: "kindle@vapor.example" } },
      "PUT /me/devices": { devices: { kindleEmail: "ada@kindle.com", remarkable: null }, kindleMail: { from: "kindle@vapor.example" } },
      "POST /me/devices": { devices: { kindleEmail: "ada@kindle.com", remarkable: { pairedAt: Date.now() } }, kindleMail: { from: "kindle@vapor.example" } },
      "POST /abcd1234/send": { ok: true, target: "kindle", to: "ada@kindle.com", title: "A plan" },
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithDocument(createElement(SendDialog, { open: true, onClose: () => {}, docId: "abcd1234" }));

    expect(await screen.findByText(/Add/)).toBeTruthy();
    expect(screen.getAllByText("kindle@vapor.example").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Send to Kindle address"), { target: { value: "ada@kindle.com" } });
    fireEvent.click(screen.getByText("Save"));
    const sendKindle = await screen.findByText("Send to Kindle");
    fireEvent.click(sendKindle);
    await waitFor(() => expect(screen.getByText(/Sent to ada@kindle.com/)).toBeTruthy());
    const sendCall = fetchMock.mock.calls.find((c) => c[0] === "/abcd1234/send")!;
    expect(JSON.parse((sendCall[1] as RequestInit).body as string)).toEqual({ target: "kindle" });

    fireEvent.change(screen.getByLabelText("reMarkable one-time code"), { target: { value: "abcd1234" } });
    fireEvent.click(screen.getByText("Pair"));
    expect(await screen.findByText("Send to reMarkable")).toBeTruthy();
    const pairCall = fetchMock.mock.calls.find((c) => c[0] === "/me/devices" && (c[1] as RequestInit)?.method === "POST")!;
    expect(JSON.parse((pairCall[1] as RequestInit).body as string)).toEqual({ remarkable: { code: "abcd1234" } });
  });

  it("explains when the instance cannot send email", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/auth/me": { signedIn: true, displayName: "Ada", email: "ada@example.com" },
        "GET /me/devices": { devices: { kindleEmail: null, remarkable: null }, kindleMail: null },
      }),
    );
    renderWithDocument(createElement(SendDialog, { open: true, onClose: () => {}, docId: "abcd1234" }));
    expect(await screen.findByText(/This vapor cannot send email/)).toBeTruthy();
  });
});
