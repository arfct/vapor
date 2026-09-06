// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import NewDocumentDialog from "~/components/NewDocumentDialog";

function renderDialog(overrides: Partial<Parameters<typeof NewDocumentDialog>[0]> = {}) {
  const props = { open: true, onClose: vi.fn(), onBlank: vi.fn(), onFile: vi.fn(), ...overrides };
  render(createElement(NewDocumentDialog, props));
  return props;
}

describe("NewDocumentDialog", () => {
  it("renders nothing while closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers blank, upload, and the terminal commands", () => {
    const { onBlank } = renderDialog();
    fireEvent.click(screen.getByText("Blank"));
    expect(onBlank).toHaveBeenCalledOnce();
    expect(screen.getByText("Upload a .md file")).toBeTruthy();
    expect(screen.getByText(/curl .*\/new -T file\.md/)).toBeTruthy();
    expect(screen.queryByText(/pbpaste/)).toBeNull();
  });

  it("takes a dropped markdown file and ignores other kinds", () => {
    const { onFile } = renderDialog();
    const zone = screen.getByText("Upload a .md file").closest('[role="button"]')!;
    const md = new File(["# hi"], "notes.md", { type: "text/markdown" });
    const png = new File([""], "pic.png", { type: "image/png" });
    fireEvent.drop(zone, { dataTransfer: { files: [png] } });
    expect(onFile).not.toHaveBeenCalled();
    fireEvent.drop(zone, { dataTransfer: { files: [md] } });
    expect(onFile).toHaveBeenCalledWith(md);
  });

  it("closes on Escape and on the close cell", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
