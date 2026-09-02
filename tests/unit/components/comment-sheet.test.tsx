// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import CommentSheet from "~/components/CommentSheet";

const thread = (id: string, text: string, resolved = false) => ({
  id,
  commentText: text,
  author: { name: "Alice", color: "#E57373", colorLight: "#FFCDD2" },
  createdAt: Date.now(),
  resolved,
  replies: [],
  position: 0,
});

describe("CommentSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = renderWithDocument(
      createElement(CommentSheet, { open: false, onClose: vi.fn() }),
      { context: { threads: [thread("t1", "First")] } },
    );
    expect(container.textContent).toBe("");
  });

  it("shows one thread at a time with a position counter", () => {
    const { getByText, queryByText } = renderWithDocument(
      createElement(CommentSheet, { open: true, onClose: vi.fn() }),
      { context: { threads: [thread("t1", "First"), thread("t2", "Second")], activeThreadId: "t2" } },
    );
    expect(getByText("Second")).toBeTruthy();
    expect(queryByText("First")).toBeNull();
    expect(getByText("2 of 2")).toBeTruthy();
  });

  it("arrows step through open threads and skip resolved ones", () => {
    const setActiveThreadId = vi.fn();
    const { getByLabelText } = renderWithDocument(
      createElement(CommentSheet, { open: true, onClose: vi.fn() }),
      {
        context: {
          threads: [thread("t1", "First"), thread("t2", "Done", true), thread("t3", "Third")],
          activeThreadId: "t1",
          setActiveThreadId,
        },
      },
    );
    expect((getByLabelText("Previous comment") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByLabelText("Next comment"));
    expect(setActiveThreadId).toHaveBeenCalledWith("t3");
  });

  it("selects the first thread when opened with none active", () => {
    const setActiveThreadId = vi.fn();
    renderWithDocument(createElement(CommentSheet, { open: true, onClose: vi.fn() }), {
      context: { threads: [thread("t1", "First")], activeThreadId: null, setActiveThreadId },
    });
    expect(setActiveThreadId).toHaveBeenCalledWith("t1");
  });

  it("shows the comment input instead of a thread while composing", () => {
    const { getByText, getByPlaceholderText, queryByText } = renderWithDocument(
      createElement(CommentSheet, { open: true, onClose: vi.fn() }),
      {
        context: {
          threads: [thread("t1", "First")],
          activeThreadId: "t1",
          commentActive: true,
          commentSelection: { from: 1, to: 7, text: "mobile" },
        },
      },
    );
    expect(getByText("New comment")).toBeTruthy();
    expect(getByPlaceholderText("Add a comment...")).toBeTruthy();
    expect(getByText("mobile")).toBeTruthy();
    expect(queryByText("First")).toBeNull();
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    const { getByLabelText } = renderWithDocument(
      createElement(CommentSheet, { open: true, onClose }),
      { context: { threads: [thread("t1", "First")], activeThreadId: "t1" } },
    );
    fireEvent.click(getByLabelText("Close comments"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
