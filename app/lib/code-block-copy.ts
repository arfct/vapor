import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { copyText } from "~/lib/clipboard";

const COPIED_FEEDBACK_MS = 1500;

const codeBlockCopyKey = new PluginKey("codeBlockCopy");

/** The code block containing a position inside its content, if any. */
function codeBlockAt(view: EditorView, pos: number | undefined): ProseMirrorNode | null {
  if (pos === undefined) return null;
  const parent = view.state.doc.resolve(pos).parent;
  return parent.type.name === "codeBlock" ? parent : null;
}

/**
 * Builds the copy button for one code block. The block's text is read at
 * click time (via `getPos`) so the button keeps working as the block is
 * edited and the widget DOM is reused across redraws.
 */
export function createCopyButton(view: EditorView, getPos: () => number | undefined): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-copy";
  button.contentEditable = "false";
  button.setAttribute("aria-label", "Copy code");
  button.title = "Copy code";

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "content_copy";
  button.appendChild(icon);

  // Keep the editor selection where it is: the button is UI, not content.
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const block = codeBlockAt(view, getPos());
    if (!block) return;
    const copied = await copyText(block.textContent);
    if (!copied) return;
    icon.textContent = "check";
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      icon.textContent = "content_copy";
      resetTimer = null;
    }, COPIED_FEEDBACK_MS);
  });

  return button;
}

/** One widget decoration at the start of each code block's content. */
export function codeBlockCopyDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return;
    const key = `code-copy-${(node.attrs.blockId as string | null) ?? pos}`;
    decorations.push(
      Decoration.widget(pos + 1, createCopyButton, { side: -1, ignoreSelection: true, key }),
    );
    return false;
  });
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

/**
 * Copy-to-clipboard button on every code block. Pure UI via widget
 * decorations — nothing is written to the document or the Yjs state.
 */
export const CodeBlockCopy = Extension.create({
  name: "codeBlockCopy",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockCopyKey,
        props: {
          decorations(state) {
            return codeBlockCopyDecorations(state.doc);
          },
        },
      }),
    ];
  },
});
