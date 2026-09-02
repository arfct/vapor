// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderWithDocument } from "../../helpers/document-context";
import FormatToolbar from "~/components/FormatToolbar";

describe("FormatToolbar", () => {
  it("renders nothing without an editor", () => {
    const { container } = renderWithDocument(createElement(FormatToolbar), {
      context: { editorInstance: null },
    });
    expect(container.textContent).toBe("");
  });

  it("renders a single Format trigger when an editor exists", () => {
    const fakeEditor = {
      on: () => {},
      off: () => {},
      isFocused: false,
      isActive: () => false,
      state: { selection: { empty: true } },
      chain: () => ({ focus: () => ({ run: () => {} }) }),
    };
    const { getByLabelText, queryByLabelText } = renderWithDocument(createElement(FormatToolbar), {
      context: { editorInstance: fakeEditor as never },
    });
    expect(getByLabelText("Format")).toBeTruthy();
    expect(queryByLabelText("Lists")).toBeNull();
    expect(queryByLabelText("Insert")).toBeNull();
  });
});
