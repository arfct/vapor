// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderWithDocument } from "../../helpers/document-context";
import ShareButton from "~/components/ShareButton";
import ConnectionStatus from "~/components/ConnectionStatus";
import Preview from "~/components/Preview";

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
  it("shows the document's markdown source", () => {
    const { container, getByText } = renderWithDocument(createElement(Preview), {
      context: { markdown: "# Hello world" },
    });
    expect(container.querySelector("pre")).toBeTruthy();
    expect(getByText("# Hello world")).toBeTruthy();
  });
});
