// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import type { NodeViewProps } from "@tiptap/react";
import AttachmentView from "~/components/AttachmentView";
import { describeAttachmentError } from "~/lib/useAttachments";

function view(attrs: Record<string, unknown>, selected = false) {
  const props = { node: { attrs }, selected } as unknown as NodeViewProps;
  return render(createElement(AttachmentView, props));
}

describe("AttachmentView", () => {
  it("renders an image with its name and size as a caption", () => {
    view({ kind: "image", src: "/abcd1234/attachments/abcdefghijklmnop/cat.png", alt: "cat.png", bytes: 2048 });
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/abcd1234/attachments/abcdefghijklmnop/cat.png");
    expect(screen.getByText("cat.png")).toBeTruthy();
    expect(screen.getByText("2 KB")).toBeTruthy();
  });

  it("renders other files as a download chip, and hides an unknown size", () => {
    view({ kind: "file", src: "/abcd1234/attachments/abcdefghijklmnop/report.pdf", alt: "report.pdf", bytes: null });
    const link = screen.getByText("report.pdf").closest("a")!;
    expect(link.getAttribute("href")).toBe("/abcd1234/attachments/abcdefghijklmnop/report.pdf");
    expect(link.getAttribute("download")).toBe("report.pdf");
    expect(screen.queryByText(/KB|MB|B$/)).toBeNull();
  });

  it("marks the selected block", () => {
    const { container } = view({ kind: "file", src: "/x", alt: "x", bytes: 1 }, true);
    expect(container.querySelector(".attachment.is-selected")).not.toBeNull();
  });
});

describe("describeAttachmentError", () => {
  it("has plain words for every refusal", () => {
    expect(describeAttachmentError("attachment_too_large")).toMatch(/20 MB/);
    expect(describeAttachmentError("sign_in_required")).toMatch(/Sign in/);
    expect(describeAttachmentError("something_else")).toMatch(/didn't go through/);
  });
});
