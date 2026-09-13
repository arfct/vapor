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
  it("renders an image alone, with its name as alt text and no caption under it", () => {
    const { container } = view({ kind: "image", src: "/abcd1234/attachments/abcdefghijklmnop/cat.png", alt: "cat.png", bytes: 2048 });
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/abcd1234/attachments/abcdefghijklmnop/cat.png");
    expect(img.getAttribute("alt")).toBe("cat.png");
    expect(container.querySelector("figcaption")).toBeNull();
    expect(screen.queryByText("cat.png")).toBeNull();
    expect(screen.queryByText("2 KB")).toBeNull();
  });

  it("puts width and align on the wrapper so the stylesheet can size it (#109)", () => {
    const { container } = view({
      kind: "image",
      src: "/abcd1234/attachments/abcdefghijklmnop/cat.png",
      alt: "cat.png",
      bytes: null,
      width: "50%",
      align: "left",
    });
    const wrapper = container.querySelector(".attachment")!;
    expect(wrapper.getAttribute("data-width")).toBe("50%");
    expect(wrapper.getAttribute("data-align")).toBe("left");
    // An arbitrary percent cannot be a static CSS rule, so the width is inline.
    expect((wrapper as HTMLElement).style.width).toBe("50%");
  });

  it("leaves the width to the stylesheet at full bleed (#109)", () => {
    const { container } = view({
      kind: "image",
      src: "/abcd1234/attachments/abcdefghijklmnop/cat.png",
      alt: "cat.png",
      bytes: null,
      width: "full",
      align: "left",
    });
    const wrapper = container.querySelector(".attachment")! as HTMLElement;
    expect(wrapper.getAttribute("data-width")).toBe("full");
    expect(wrapper.style.width).toBe("");
    // Nothing wraps beside a full-bleed image, so it drops the float.
    expect(wrapper.hasAttribute("data-align")).toBe(false);
  });

  it("omits the layout attributes when the node carries none (#109)", () => {
    const { container } = view({
      kind: "image",
      src: "/abcd1234/attachments/abcdefghijklmnop/cat.png",
      alt: "cat.png",
      bytes: null,
    });
    const wrapper = container.querySelector(".attachment")!;
    expect(wrapper.hasAttribute("data-width")).toBe(false);
    expect(wrapper.hasAttribute("data-align")).toBe(false);
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
