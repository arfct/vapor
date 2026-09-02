import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Placeholder for an empty top-level block: "Title" on the first line
 * while the document is still (nearly) empty, "Body" on the line after a
 * title while nothing else has been written. Empty string otherwise.
 * StarterKit's TrailingNode keeps an empty paragraph after the last block,
 * so "nothing else" means every block after the first is empty.
 */
export interface TitleBlockOptions {
  /** Placeholder for the empty first line. */
  title: string;
  /** Placeholder for the empty line after a title. */
  body: string;
}

export function placeholderFor(doc: PMNode, index: number, text: TitleBlockOptions): string {
  if (index === 0) return doc.childCount <= 2 ? text.title : "";
  if (index !== 1) return "";
  const first = doc.firstChild;
  if (!first || first.type.name !== "heading" || doc.child(1).type.name !== "paragraph") return "";
  for (let i = 1; i < doc.childCount; i++) if (doc.child(i).textContent.length > 0) return "";
  return text.body;
}

function placeholderDecorations(doc: PMNode, text: TitleBlockOptions): DecorationSet {
  const decorations: Decoration[] = [];
  doc.forEach((node, offset, index) => {
    if (node.childCount > 0 || node.isLeaf) return;
    const placeholder = placeholderFor(doc, index, text);
    if (!placeholder) return;
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, { class: "is-empty", "data-placeholder": placeholder }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * The first line of a document is its title. Typing into an otherwise
 * empty document turns that first paragraph into a level-1 heading; Enter
 * at its end starts an ordinary paragraph (ProseMirror's default split),
 * and Backspace at the very start of a heading demotes it back to body
 * text. "Title" / "Body" placeholders are node decorations computed from
 * the rendered state — never content, never selectable.
 */
export const TitleBlock = Extension.create<TitleBlockOptions>({
  name: "titleBlock",

  addOptions() {
    return { title: "Title", body: "Body" };
  },

  addProseMirrorPlugins() {
    const text = this.options;
    return [
      new Plugin({
        key: new PluginKey("titleBlock"),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          // Only the moment an empty document receives its first characters.
          if (newState.doc.childCount !== 1 || oldState.doc.childCount !== 1) return null;
          const before = oldState.doc.firstChild;
          const after = newState.doc.firstChild;
          if (!before || !after) return null;
          if (before.type.name !== "paragraph" || after.type.name !== "paragraph") return null;
          if (before.textContent.length !== 0 || after.textContent.length === 0) return null;
          const heading = newState.schema.nodes.heading;
          if (!heading) return null;
          return newState.tr.setNodeMarkup(0, heading, { ...after.attrs, level: 1 });
        },
        props: {
          decorations(state) {
            return placeholderDecorations(state.doc, text);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.type.name !== "heading") return false;
        return editor.commands.setNode("paragraph");
      },
    };
  },
});
