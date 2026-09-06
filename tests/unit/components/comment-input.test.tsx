// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import CommentInput from "~/components/CommentInput";

describe("CommentInput", () => {
  it("hidden when not active", () => {
    const { container } = renderWithDocument(createElement(CommentInput), {
      context: { commentActive: false },
    });
    expect(container.innerHTML).toBe("");
  });

  it("shows input and buttons when active", () => {
    const { getByText, getByLabelText } = renderWithDocument(
      createElement(CommentInput),
      { context: { commentActive: true } },
    );
    expect(getByLabelText("Add a comment...")).toBeTruthy();
    expect(getByText("Add a comment...")).toBeTruthy();
    expect(getByText("Add")).toBeTruthy();
    expect(getByText("Cancel")).toBeTruthy();
  });

  it("cancel calls handleCommentActiveChange(false)", () => {
    const { contextValue, getByText } = renderWithDocument(
      createElement(CommentInput),
      { context: { commentActive: true } },
    );
    fireEvent.click(getByText("Cancel"));
    expect(contextValue.handleCommentActiveChange).toHaveBeenCalledWith(false);
  });
});
