// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import CreateMenu from "~/components/CreateMenu";

describe("CreateMenu", () => {
  it("offers a new document and an upload", async () => {
    const onNewDocument = vi.fn();
    const onUpload = vi.fn();
    renderWithDocument(createElement(CreateMenu, { onNewDocument, onUpload }));
    fireEvent.click(screen.getByLabelText("Create"));
    fireEvent.click(await screen.findByText("New document"));
    expect(onNewDocument).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText("Create"));
    fireEvent.click(await screen.findByText("Upload .md file"));
    expect(onUpload).toHaveBeenCalledOnce();
  });
});
