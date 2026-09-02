// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderWithDocument } from "../../helpers/document-context";
import ModeMenu from "~/components/ModeMenu";

describe("ModeMenu", () => {
  it("trigger shows Edit when mode is edit", () => {
    const { getByLabelText } = renderWithDocument(createElement(ModeMenu), {
      context: { mode: "edit" },
    });
    expect(getByLabelText("Editing mode").getAttribute("title")).toBe("Edit");
  });

  it("trigger shows Suggest when mode is suggest", () => {
    const { getByLabelText } = renderWithDocument(createElement(ModeMenu), {
      context: { mode: "suggest" },
    });
    expect(getByLabelText("Editing mode").getAttribute("title")).toBe("Suggest");
  });
});
