import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import AttachmentView from "~/components/AttachmentView";

/**
 * A file stored under this document, as a block: images render inline,
 * everything else as a chip with a download link. Mirrors the `attachment`
 * node in `richSchema`; canonical markdown is an image or a link alone in a
 * paragraph at the attachment path (see rich-markdown.ts).
 */
export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      blockId: { default: null, rendered: false },
      kind: { default: "file", rendered: false },
      src: { default: "", rendered: false },
      alt: { default: "", rendered: false },
      bytes: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-attachment]",
        getAttrs: (el) => ({
          kind: el.getAttribute("data-attachment") === "image" ? "image" : "file",
          src: el.getAttribute("data-src") ?? "",
          alt: el.getAttribute("data-alt") ?? "",
          bytes: el.getAttribute("data-bytes") ? Number(el.getAttribute("data-bytes")) : null,
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-attachment": node.attrs.kind,
        "data-src": node.attrs.src,
        "data-alt": node.attrs.alt,
        "data-bytes": node.attrs.bytes ?? undefined,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});
