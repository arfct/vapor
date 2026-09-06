// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import CommentEditor from "~/components/CommentEditor";
import type { MentionSources } from "~/shared/agent-protocol";

const sources: MentionSources = {
  agents: [{ name: "scribe", label: "Ada's Agent", color: "#111", mention: "scribe~c41d7e90", client: "Claude" }],
  people: [{ name: "Ada Lovelace", color: "#222", id: "k3f0a9x2" }],
};

function paste(target: Element, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : ""), types: ["text/plain"], files: [] },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

describe("CommentEditor", () => {
  it("opens the mention popup on @, completes on Enter, then Enter sends the text", async () => {
    const onSubmit = vi.fn();
    const { getByLabelText, findByText } = render(
      createElement(CommentEditor, {
        placeholder: "Reply...",
        onSubmit,
        onCancel: vi.fn(),
        mentions: { current: sources },
      }),
    );
    const editor = getByLabelText("Reply...");

    paste(editor, "hey @sc");
    // The popup mounts on document.body, positioned by the plugin.
    expect(await findByText("Ada's Agent", {}, { container: document.body })).toBeTruthy();

    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled(); // Enter went to the popup
    // The mention shows its name; the text that is sent carries the token.
    expect(editor.textContent).toBe("hey @scribe ");

    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("hey @scribe~c41d7e90");
  });

  it("completes a person to a token showing their name and hiding their id", async () => {
    const onSubmit = vi.fn();
    const { getByLabelText, findByText } = render(
      createElement(CommentEditor, { placeholder: "Reply...", onSubmit, onCancel: vi.fn(), mentions: { current: sources } }),
    );
    const editor = getByLabelText("Reply...");
    paste(editor, "@love");
    expect(await findByText("Ada Lovelace", {}, { container: document.body })).toBeTruthy();
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(editor.textContent).toBe("@ada-lovelace ");
    expect(editor.textContent).not.toContain("@example.com");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("@ada-lovelace~k3f0a9x2");
  });

  it("resolves a typed address to the person and never writes the address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("bob%40example.org")
          ? new Response(JSON.stringify({ person: { uid: "d02e77b4", displayName: "Bob Example", avatar: null } }))
          : new Response(JSON.stringify({ person: null })),
      ),
    );
    try {
      const { getByLabelText, findByText } = render(
        createElement(CommentEditor, { placeholder: "Reply...", onSubmit: vi.fn(), onCancel: vi.fn(), mentions: { current: sources } }),
      );
      const editor = getByLabelText("Reply...");
      paste(editor, "@bob@example.org");
      expect(await findByText("Mention bob@example.org", {}, { container: document.body })).toBeTruthy();
      fireEvent.keyDown(editor, { key: "Enter" });
      await waitFor(() => expect(editor.textContent).toBe("@bob-example "));

      paste(editor, "@nobody@example.org");
      expect(await findByText("Mention nobody@example.org", {}, { container: document.body })).toBeTruthy();
      fireEvent.keyDown(editor, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 20));
      expect(editor.textContent).toBe("@bob-example @nobody@example.org");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Escape cancels", () => {
    const onCancel = vi.fn();
    const { getByLabelText } = render(
      createElement(CommentEditor, { placeholder: "Reply...", onSubmit: vi.fn(), onCancel, mentions: null }),
    );
    fireEvent.keyDown(getByLabelText("Reply..."), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
