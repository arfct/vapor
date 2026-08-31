// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import MobilePanel from "~/components/MobilePanel";

describe("MobilePanel", () => {
  it("renders three tab buttons", () => {
    const { getAllByRole } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );
    const buttons = getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toBe("Editing");
    expect(buttons[1].textContent).toBe("Comments");
    expect(buttons[2].textContent).toBe("Preview");
  });

  it("clicking a tab shows corresponding content, clicking again collapses", () => {
    const thread = {
      id: "t1",
      commentText: "A comment",
      author: { name: "Alice", color: "#000", colorLight: "#ccc" },
      createdAt: Date.now(),
      resolved: false,
      replies: [],
    };
    const { getByText, queryByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
      { context: { threads: [thread] } },
    );

    // Click Comments tab
    fireEvent.click(getByText("Comments"));
    expect(queryByText("A comment")).toBeTruthy();

    // Click Comments tab again to collapse
    fireEvent.click(getByText("Comments"));
    expect(queryByText("A comment")).toBeFalsy();
  });

  it("comments tab renders CommentInput and ThreadList", () => {
    const { getByText, queryByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
      { context: { commentActive: true } },
    );

    fireEvent.click(getByText("Comments"));
    expect(queryByText("Comment")).toBeTruthy();
  });
});
