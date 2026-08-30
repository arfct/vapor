// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import InviteAgentDialog from "~/components/InviteAgentDialog";

const rosterEntry = {
  name: "scribe",
  color: "#E57373",
  owner: null,
  capabilities: ["suggest", "comment"],
  createdAt: Date.now(),
  lastSeenAt: null,
};

function mockFetchSequence(responses: Array<{ body: unknown; status?: number }>) {
  const fn = vi.fn();
  for (const { body, status = 200 } of responses) {
    fn.mockImplementationOnce(
      () =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
        ) as unknown as Promise<Response>,
    );
  }
  return fn;
}

// jsdom has no ResizeObserver; @radix-ui/react-switch's useSize hook needs one
// for its Thumb. Real behaviour doesn't depend on actual measurements here.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("InviteAgentDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens with default capability switches: suggest+comment on, write off", async () => {
    global.fetch = mockFetchSequence([{ body: [] }]);

    const { getByText, getByRole } = renderWithDocument(
      createElement(InviteAgentDialog),
    );

    fireEvent.click(getByText("Invite agent"));

    await waitFor(() => {
      expect(getByRole("switch", { name: /suggest/i })).toBeTruthy();
    });

    expect(getByRole("switch", { name: /suggest/i }).getAttribute("data-state")).toBe(
      "checked",
    );
    expect(getByRole("switch", { name: /comment/i }).getAttribute("data-state")).toBe(
      "checked",
    );
    expect(getByRole("switch", { name: /write/i }).getAttribute("data-state")).toBe(
      "unchecked",
    );
  });

  it("shows inline validation error for an invalid name", async () => {
    global.fetch = mockFetchSequence([{ body: [] }]);

    const { getByText, getByLabelText } = renderWithDocument(
      createElement(InviteAgentDialog),
    );

    fireEvent.click(getByText("Invite agent"));
    await waitFor(() => getByLabelText("Name"));

    const nameInput = getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Not Valid!" } });
    fireEvent.click(getByText("Create"));

    await waitFor(() => {
      expect(getByText("Lowercase letters, digits, and hyphens")).toBeTruthy();
    });
  });

  it("submits the typed name and shows the token screen once", async () => {
    global.fetch = mockFetchSequence([
      { body: [] },
      {
        body: { token: "secret-once-token", entry: rosterEntry },
        status: 201,
      },
      { body: [rosterEntry] },
    ]);

    const { getByText, getByLabelText } = renderWithDocument(
      createElement(InviteAgentDialog),
      { context: { docId: "abcd1234" } },
    );

    fireEvent.click(getByText("Invite agent"));
    await waitFor(() => getByLabelText("Name"));

    const nameInput = getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "muse" } });

    await act(async () => {
      fireEvent.click(getByText("Create"));
    });

    await waitFor(() => {
      expect(getByText("secret-once-token")).toBeTruthy();
    });

    expect(
      getByText("This token is shown once. Revoke and re-mint to replace it."),
    ).toBeTruthy();

    const postCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]: [unknown, RequestInit | undefined]) => init?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    const [url, init] = postCall as [string, RequestInit];
    expect(url).toBe("/abcd1234/agents");
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody).toMatchObject({ intent: "mint", name: "muse" });
  });
});
