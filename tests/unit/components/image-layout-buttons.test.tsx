// @vitest-environment jsdom
/**
 * The image bubble's layout row (#109): what it offers and what each press
 * writes. Rendered without BubbleMenu, which only decides where it appears.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { render, fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { NodeSelection } from "@tiptap/pm/state";
import { Attachment } from "~/lib/attachment";
import { ImageLayoutButtons } from "~/components/BubbleToolbar";

let editor: Editor | null = null;

function setup(attrs: Record<string, unknown> = {}) {
  editor = new Editor({
    extensions: [Document, Paragraph, Text, Attachment],
    content: {
      type: "doc",
      content: [
        { type: "attachment", attrs: { kind: "image", src: "/a/attachments/b/cat.png", alt: "cat.png", ...attrs } },
        { type: "paragraph", content: [{ type: "text", text: "After." }] },
      ],
    },
  });
  const { state, view } = editor;
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
  const utils = render(createElement(ImageLayoutButtons, { editor }));
  return { editor, ...utils };
}

const width = () => editor!.state.doc.firstChild!.attrs.width;
const align = () => editor!.state.doc.firstChild!.attrs.align;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("ImageLayoutButtons", () => {
  it("offers no width percentages: an image is its natural size unless the markdown says otherwise", () => {
    const { container } = setup();
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(labels).not.toContain("25");
    expect(labels).not.toContain("50");
    expect(labels).not.toContain("75");
    expect(labels).not.toContain("100");
  });

  it("offers full width and the three alignments", () => {
    const { getByLabelText } = setup();
    for (const label of ["Full width", "Align left", "Align centre", "Align right"]) {
      expect(getByLabelText(label)).toBeTruthy();
    }
  });

  it("toggles full width off again, back to the natural width", () => {
    const { getByLabelText } = setup();
    fireEvent.click(getByLabelText("Full width"));
    expect(width()).toBe("full");
    fireEvent.click(getByLabelText("Full width"));
    expect(width()).toBe(null);
  });

  it("returns a full-bleed image to its natural width when it is aligned, not to a preset", () => {
    const { getByLabelText } = setup({ width: "full" });
    fireEvent.click(getByLabelText("Align right"));
    expect(align()).toBe("right");
    expect(width()).toBe(null);
  });

  it("leaves a width the markdown specified alone when only the alignment changes", () => {
    const { getByLabelText } = setup({ width: "60%" });
    fireEvent.click(getByLabelText("Align left"));
    expect(width()).toBe("60%");
    expect(align()).toBe("left");
  });
});
