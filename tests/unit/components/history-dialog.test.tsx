// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import HistoryDialog from "~/components/HistoryDialog";
import type { VersionSummary } from "~/shared/version-policy";

const versions: VersionSummary[] = [
  {
    id: 2,
    createdAt: Date.now() - 60_000,
    reason: "pre_replace",
    author: { kind: "agent", id: "a1", name: "Ada's Agent", color: "#123" },
    contributors: [],
    bytes: 140,
    restoredFrom: null,
  },
  {
    id: 1,
    createdAt: Date.now() - 3_600_000,
    reason: "idle",
    author: { kind: "human", id: "u1", name: "Quiet Otter", color: "#abc", animal: "🦦" },
    contributors: [],
    bytes: 100,
    restoredFrom: null,
  },
];

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${init?.method ?? "GET"} ${new URL(url, "https://vapor.fyi").pathname}`;
    const handler = handlers[key];
    if (!handler) return new Response("not found", { status: 404 });
    return handler(init);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("HistoryDialog", () => {
  it("lists versions with author, reason, and size delta, newest first", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "GET /agents/document-agent/test-doc/versions": () => Response.json(versions) }),
    );
    renderWithDocument(createElement(HistoryDialog, { open: true, onClose: vi.fn() }));
    expect(await screen.findByText("Ada's Agent")).toBeTruthy();
    expect(screen.getByText("Before Ada's Agent replaced blocks")).toBeTruthy();
    expect(screen.getByText("Quiet Otter")).toBeTruthy();
    expect(screen.getByText("+40")).toBeTruthy();
    expect(screen.getByText("Now")).toBeTruthy();
  });

  it("previews a selected version and restores it after confirming", async () => {
    const restore = vi.fn(() => Response.json({ ok: true }));
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "GET /agents/document-agent/test-doc/versions": () => Response.json(versions),
        "GET /agents/document-agent/test-doc/versions/1": () => new Response("# Older text"),
        "POST /agents/document-agent/test-doc/versions/1/restore": restore,
      }),
    );
    renderWithDocument(createElement(HistoryDialog, { open: true, onClose: vi.fn() }));
    fireEvent.click(await screen.findByText("Quiet Otter"));
    expect(await screen.findByText("# Older text")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByText(/Restore this version\?/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" }).pop()!);
    await waitFor(() => expect(restore).toHaveBeenCalled());
    const body = JSON.parse((restore.mock.calls[0][0] as RequestInit).body as string) as { user: { name: string } };
    expect(body.user.name).toBe("Test User");
    expect(await screen.findByText(/Restored\./)).toBeTruthy();
  });

  it("explains when a manual save changes nothing", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "GET /agents/document-agent/test-doc/versions": () => Response.json([]),
        "POST /agents/document-agent/test-doc/versions": () => Response.json({ error: "unchanged" }),
      }),
    );
    renderWithDocument(createElement(HistoryDialog, { open: true, onClose: vi.fn() }));
    fireEvent.click(await screen.findByText("Save version now"));
    expect(await screen.findByText(/Nothing has changed/)).toBeTruthy();
  });
});
