import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EMAIL_MENTION_RE, SLUG_MENTION_RE } from "~/shared/agent-protocol";

export const mentionHighlightKey = new PluginKey("mentionHighlight");

/** Known handles (agent slugs, people emails and slugs) to the colour they draw in. */
export type MentionTargets = Map<string, string>;

export interface MentionTargetsRef {
  current: MentionTargets;
}

const SKIP_BLOCKS = new Set(["codeBlock", "agentInstructions"]);

/**
 * Inline decorations over every mention in the document. Email mentions
 * always draw (their form is explicit); slug mentions only when the handle
 * names someone known, so `@todo` in prose stays plain. Code is skipped.
 */
export function mentionDecorations(doc: PMNode, targets: MentionTargets): DecorationSet {
  const decorations: Decoration[] = [];
  const codeMark = doc.type.schema.marks.code;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (SKIP_BLOCKS.has(node.type.name)) return false;

    // One placeholder character per inline leaf keeps offsets aligned.
    const text = node.textBetween(0, node.content.size, undefined, "￼");
    const add = (offset: number, handle: string, known: boolean) => {
      const from = pos + 1 + offset;
      const to = from + handle.length + 1;
      if (codeMark && doc.rangeHasMark(from, to, codeMark)) return;
      const color = targets.get(handle);
      if (!known && !color) return;
      decorations.push(
        Decoration.inline(from, to, {
          class: "cm-mention",
          ...(color ? { style: `--mention-color: ${color}` } : {}),
        }),
      );
    };

    for (const m of text.matchAll(EMAIL_MENTION_RE)) {
      const handle = m[1].toLowerCase();
      add(m.index + m[0].length - m[1].length - 1, handle, true);
    }
    for (const m of text.matchAll(SLUG_MENTION_RE)) {
      add(m.index + m[0].length - m[1].length - 1, m[1], false);
    }
    return false;
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Colours mentions in place. Recomputed on every document change (a whole
 * document scan is cheap at vapor sizes) and when the editor signals that
 * the set of known handles changed via `setMeta(mentionHighlightKey, true)`.
 */
export const MentionHighlight = Extension.create<{ targets: MentionTargetsRef | null }>({
  name: "mentionHighlight",

  addOptions() {
    return { targets: null };
  },

  addProseMirrorPlugins() {
    const ref = this.options.targets;
    const targets = () => ref?.current ?? new Map<string, string>();
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
