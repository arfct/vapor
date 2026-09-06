import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { SLUG_MENTION_RE } from "~/shared/agent-protocol";

export const mentionHighlightKey = new PluginKey("mentionHighlight");

/** How a known mention draws: the colour, and the current name to show in place of the token's slug. */
export interface MentionTarget {
  color: string;
  label: string;
}

/**
 * Known mentions to how they draw, keyed three ways so both mention forms
 * resolve: a token's `tag~sid` key, its full handle, and a bare legacy slug.
 */
export type MentionTargets = Map<string, MentionTarget>;

export interface MentionTargetsRef {
  current: MentionTargets;
}

const SKIP_BLOCKS = new Set(["codeBlock", "agentInstructions"]);

/**
 * Inline decorations over bare `@slug` mentions written before mention
 * tokens existed (docs/plans/2026-09-06-agent-identity-plan.md): they
 * colour only when the slug names someone known, so `@todo` in prose stays
 * plain. Token mentions are `mention` nodes and draw themselves. Code is
 * skipped.
 */
export function mentionDecorations(doc: PMNode, targets: MentionTargets): DecorationSet {
  const decorations: Decoration[] = [];
  const codeMark = doc.type.schema.marks.code;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (SKIP_BLOCKS.has(node.type.name)) return false;

    // One placeholder character per inline leaf keeps offsets aligned.
    const text = node.textBetween(0, node.content.size, undefined, "￼");
    for (const m of text.matchAll(SLUG_MENTION_RE)) {
      const handle = m[1];
      const target = targets.get(handle);
      if (!target) continue;
      const from = pos + 1 + m.index + m[0].length - handle.length - 1;
      const to = from + handle.length + 1;
      if (codeMark && doc.rangeHasMark(from, to, codeMark)) continue;
      decorations.push(
        Decoration.inline(from, to, { class: "cm-mention", style: `--mention-color: ${target.color}` }),
      );
    }
    return false;
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Colours legacy mentions in place. Recomputed on every document change (a
 * whole document scan is cheap at vapor sizes) and when the editor signals
 * that the set of known handles changed via `setMeta(mentionHighlightKey, true)`.
 */
export const MentionHighlight = Extension.create<{ targets: MentionTargetsRef | null }>({
  name: "mentionHighlight",

  addOptions() {
    return { targets: null };
  },

  addProseMirrorPlugins() {
    const ref = this.options.targets;
    const targets = () => ref?.current ?? new Map<string, MentionTarget>();
    return [
      new Plugin({
        key: mentionHighlightKey,
        state: {
          init: (_, state) => mentionDecorations(state.doc, targets()),
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta(mentionHighlightKey) ? mentionDecorations(tr.doc, targets()) : old,
        },
        props: {
          decorations: (state) => mentionHighlightKey.getState(state) as DecorationSet,
        },
      }),
    ];
  },
});
