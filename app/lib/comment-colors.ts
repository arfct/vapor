import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { CommentColorRange } from "~/shared/types";

export const commentColorsKey = new PluginKey<CommentColorRange[]>("commentColors");

/** The author colour of the comment whose range contains `pos`, if any. */
export function commentColorAt(state: EditorState, pos: number): string | undefined {
  const ranges = commentColorsKey.getState(state) ?? [];
  return ranges.find((r) => pos >= r.from && pos <= r.to)?.color;
}

/**
 * Colours each comment's range with its author's colour. Ranges arrive via
 * `setMeta(commentColorsKey, ranges)` and follow document edits. Inline
 * decorations render inside mark spans, so the colour is drawn by the
 * decoration span itself (`.cm-colored`, see app.css) and other plugins
 * read it through `commentColorAt`.
 */
export const CommentColors = Extension.create({
  name: "commentColors",
  addProseMirrorPlugins() {
    return [
      new Plugin<CommentColorRange[]>({
        key: commentColorsKey,
        state: {
          init() {
            return [];
          },
          apply(tr, value) {
            const meta = tr.getMeta(commentColorsKey) as CommentColorRange[] | undefined;
            if (meta !== undefined) return meta;
            if (tr.docChanged) {
              return value
                .map((r) => ({ ...r, from: tr.mapping.map(r.from), to: tr.mapping.map(r.to) }))
                .filter((r) => r.from < r.to);
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const ranges = commentColorsKey.getState(state) ?? [];
            if (ranges.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              ranges.map((r) =>
                Decoration.inline(r.from, r.to, { class: "cm-colored", style: `--comment-color: ${r.color}` }),
              ),
            );
          },
        },
      }),
    ];
  },
});
