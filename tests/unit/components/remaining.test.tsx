// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import CleanViewToggle from "~/components/CleanViewToggle";
import SuggestionActions from "~/components/SuggestionActions";
import ShareButton from "~/components/ShareButton";
import ConnectionStatus from "~/components/ConnectionStatus";
import Preview from "~/components/Preview";

describe("CleanViewToggle", () => {
  it("renders checkbox reflecting cleanView state", () => {
    const { getByText } = renderWithDocument(createElement(CleanViewToggle), {
      context: { cleanView: true },
    });
    expect(getByText("Show editing markup")).toBeTruthy();
  });

  it("toggle calls toggleCleanView", () => {
    const { contextValue, getByRole } = renderWithDocument(
      createElement(CleanViewToggle),
    );
    fireEvent.click(getByRole("checkbox"));
    expect(contextValue.toggleCleanView).toHaveBeenCalledOnce();
  });
});

describe("SuggestionActions", () => {
  it("renders action buttons in suggest mode", () => {
    const { getByText } = renderWithDocument(
      createElement(SuggestionActions),
      { context: { mode: "suggest" } },
    );
    expect(getByText("Accept")).toBeTruthy();
    expect(getByText("Reject")).toBeTruthy();
  });
});

describe("ShareButton", () => {
  it("renders share trigger button", () => {
    const { getByLabelText } = renderWithDocument(createElement(ShareButton));
    expect(getByLabelText("Share options")).toBeTruthy();
  });
});

describe("ConnectionStatus", () => {
  it("renders connection status text", () => {
    const { getByText } = renderWithDocument(createElement(ConnectionStatus));
    expect(getByText("Connecting")).toBeTruthy();
  });
});

describe("Preview", () => {
  it("renders markdown as HTML", () => {
    const { container } = renderWithDocument(createElement(Preview), {
      context: { markdown: "Hello world" },
    });
    expect(container.querySelector(".preview")).toBeTruthy();
  });
});
