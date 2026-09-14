import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { ImageLayout } from "~/shared/image-layout";

/**
 * The image attachment a node selection is on, or null. File attachments are
 * excluded: a download chip has no width or alignment to set (#109).
 */
export function selectedImageAttachment(state: EditorState): { node: PmNode; pos: number } | null {
  const selection = state.selection;
  if (!(selection instanceof NodeSelection)) return null;
  const node = selection.node;
  if (node.type.name !== "attachment" || node.attrs.kind !== "image") return null;
  return { node, pos: selection.from };
}

/**
 * Writes width, alignment, or both onto the selected image. One call per
 * choice, so each is a single Yjs update rather than a stream of them.
 */
export function setImageLayout(editor: Editor, patch: Partial<ImageLayout>): boolean {
  const selected = selectedImageAttachment(editor.state);
  if (!selected) return false;
  const tr = editor.state.tr.setNodeMarkup(selected.pos, undefined, { ...selected.node.attrs, ...patch });
  editor.view.dispatch(tr);
  return true;
}
