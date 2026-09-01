import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { BLOCK_ID_TYPES, mintBlockId } from "~/shared/rich-markdown";

/**
 * Persistent block identity. Every top-level block carries an immutable
 * `blockId` attribute — the address agents use (content hashes demote to
 * staleness checks; see docs/plans/2026-08-31-wysiwyg-editing-plan.md).
 *
 * The plugin assigns ids to blocks that lack one and re-mints duplicates:
 * on an Enter-split ProseMirror copies attrs to the new node, and paste
 * duplicates whole blocks — the FIRST occurrence keeps the id (the block
 * containing the original start), later ones get fresh ids.
 */
export const BlockId = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_ID_TYPES,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: true,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-block-id"),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.blockId ? { "data-block-id": attrs.blockId } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockIdAssign"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const seen = new Set<string>();
          let tr = null as typeof newState.tr | null;

          newState.doc.forEach((node, offset) => {
            if (!("blockId" in node.attrs)) return;
            const id = node.attrs.blockId as string | null;
            if (id && !seen.has(id)) {
              seen.add(id);
              return;
            }
            const fresh = mintBlockId();
            seen.add(fresh);
            tr = tr ?? newState.tr;
            tr.setNodeMarkup(offset, undefined, { ...node.attrs, blockId: fresh });
          });

          if (tr) tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});
