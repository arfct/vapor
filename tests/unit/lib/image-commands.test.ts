// @vitest-environment jsdom
/**
 * Tests for image-commands: which selection offers the image layout controls,
 * and what setting a width or an alignment writes (#109).
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { NodeSelection } from "@tiptap/pm/state";
import { Attachment } from "~/lib/attachment";
import { selectedImageAttachment, setImageLayout } from "~/lib/image-commands";

let editor: Editor | null = null;

function makeEditor(kind: "image" | "file") {
  editor = new Editor({
    extensions: [Document, Paragraph, Text, Attachment],
    content: {
      type: "doc",
      content: [
        { type: "attachment", attrs: { kind, src: "/a/attachments/b/cat.png", alt: "cat.png" } },
        { type: "paragraph", content: [{ type: "text", text: "After." }] },
      ],
    },
  });
  const { state, view } = editor;
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("selectedImageAttachment", () => {
  it("finds an image attachment under a node selection", () => {
    const found = selectedImageAttachment(makeEditor("image").state);
    expect(found?.node.attrs.alt).toBe("cat.png");
    expect(found?.pos).toBe(0);
  });

  it("ignores a file attachment, which has no layout to set", () => {
    expect(selectedImageAttachment(makeEditor("file").state)).toBe(null);
  });

  it("ignores a text selection", () => {
    const ed = makeEditor("image");
    ed.commands.setTextSelection({ from: 2, to: 6 });
    expect(selectedImageAttachment(ed.state)).toBe(null);
  });
});

describe("setImageLayout", () => {
  it("writes width and align onto the selected image", () => {
    const ed = makeEditor("image");
    setImageLayout(ed, { width: "50%", align: "left" });
    expect(ed.state.doc.firstChild!.attrs.width).toBe("50%");
    expect(ed.state.doc.firstChild!.attrs.align).toBe("left");
  });

  it("clears an attribute when it is set to null", () => {
    const ed = makeEditor("image");
    setImageLayout(ed, { width: "50%", align: "left" });
    setImageLayout(ed, { align: null });
    expect(ed.state.doc.firstChild!.attrs.width).toBe("50%");
    expect(ed.state.doc.firstChild!.attrs.align).toBe(null);
  });

  it("does nothing when the selection is not an image", () => {
    const ed = makeEditor("file");
    expect(setImageLayout(ed, { width: "50%" })).toBe(false);
    expect(ed.state.doc.firstChild!.attrs.width).toBe(null);
  });
});
