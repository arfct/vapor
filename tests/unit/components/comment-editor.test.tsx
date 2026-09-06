// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { render, fireEvent, act } from "@testing-library/react";
import CommentEditor from "~/components/CommentEditor";
import type { MentionSources } from "~/shared/agent-protocol";

const sources: MentionSources = {
  agents: [{ name: "scribe", label: "Ada's Agent", color: "#111" }],
  people: [{ name: "Ada Lovelace", color: "#222", id: "email:ada@example.com" }],
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
    expect(editor.textContent).toBe("hey @scribe ");

    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("hey @scribe");
  });

  it("completes a person to their email address", async () => {
    const onSubmit = vi.fn();
    const { getByLabelText, findByText } = render(
      createElement(CommentEditor, { placeholder: "Reply...", onSubmit, onCancel: vi.fn(), mentions: { current: sources } }),
    );
    const editor = getByLabelText("Reply...");
    paste(editor, "@love");
    expect(await findByText("Ada Lovelace", {}, { container: document.body })).toBeTruthy();
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(editor.textContent).toBe("@ada@example.com ");
  });

  it("offers a typed address as a row of its own", async () => {
    const { getByLabelText, findByText } = render(
      createElement(CommentEditor, { placeholder: "Reply...", onSubmit: vi.fn(), onCancel: vi.fn(), mentions: { current: sources } }),
    );
    const editor = getByLabelText("Reply...");
    paste(editor, "@bob@example.org");
    expect(await findByText("Mention bob@example.org", {}, { container: document.body })).toBeTruthy();
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(editor.textContent).toBe("@bob@example.org ");
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
