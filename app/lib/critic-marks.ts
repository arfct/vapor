import { Mark, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export const CriticAddition = Mark.create({
  name: "criticAddition",
  inclusive: false,
  excludes: "criticDeletion criticComment",
  parseHTML() {
    return [{ tag: "span.cm-addition" }];
  },
  renderHTML() {
    return ["span", { class: "cm-addition" }, 0];
  },
});

export const CriticDeletion = Mark.create({
  name: "criticDeletion",
  inclusive: false,
  excludes: "criticAddition criticComment",
  parseHTML() {
    return [{ tag: "span.cm-deletion" }];
  },
  renderHTML() {
    return ["span", { class: "cm-deletion" }, 0];
  },
});

export const CriticComment = Mark.create({
  name: "criticComment",
  inclusive: false,
  excludes: "criticAddition criticDeletion",
  parseHTML() {
    return [{ tag: "span.cm-comment" }];
  },
  renderHTML() {
    return ["span", { class: "cm-comment" }, 0];
  },
});

export const CriticHighlight = Mark.create({
  name: "criticHighlight",
  inclusive: false,
  addAttributes() {
    return {
      threadId: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "span.cm-highlight" }];
  },
  renderHTML({ mark }) {
    const attrs: Record<string, string> = { class: "cm-highlight" };
    if (mark.attrs.threadId) {
      attrs["data-thread-id"] = mark.attrs.threadId;
    }
    return ["span", attrs, 0];
  },
});

/* ---------- Point-comment markers ---------- */

interface MarkRun {
  from: number;
  to: number;
  markName: string;
}

function findMarkRuns(doc: ProseMirrorNode): MarkRun[] {
  const runs: MarkRun[] = [];
  let current: MarkRun | null = null;

  doc.descendants((node, pos) => {
    if (!node.isText) {
      if (current) {
        runs.push(current);
        current = null;
      }
      return;
    }

    const criticMark = node.marks.find(
      (m) =>
        m.type.name === "criticAddition" ||
        m.type.name === "criticDeletion" ||
        m.type.name === "criticComment" ||
        m.type.name === "criticHighlight",
    );

    if (criticMark) {
      const markName = criticMark.type.name;
      const nodeEnd = pos + node.nodeSize;
      if (current && current.markName === markName && current.to === pos) {
        current.to = nodeEnd;
      } else {
        if (current) runs.push(current);
        current = { from: pos, to: nodeEnd, markName };
      }
    } else {
      if (current) {
        runs.push(current);
        current = null;
      }
    }
  });

  if (current) runs.push(current);
  return runs;
}

const criticMarkerKey = new PluginKey("criticPointMarkers");

/**
 * Widget markers for point comments (a criticComment run not preceded by a
 * criticHighlight). Comment text itself is visually hidden (see app.css) —
 * the marker is the click target that opens the thread. WYSIWYG rendering
 * has no delimiter decorations: suggestions and highlights read through
 * their mark styling alone.
 */
export const CriticPointMarkers = Extension.create({
  name: "criticPointMarkers",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: criticMarkerKey,
        props: {
          decorations(state) {
            const runs = findMarkRuns(state.doc);
            if (runs.length === 0) return DecorationSet.empty;

            const decorations: Decoration[] = [];
            for (let i = 0; i < runs.length; i++) {
              const run = runs[i];
              if (run.markName !== "criticComment") continue;
              const prev = i > 0 ? runs[i - 1] : null;
              const isPaired = prev?.markName === "criticHighlight" && prev.to === run.from;
              if (isPaired) continue;
              decorations.push(
                Decoration.widget(
                  run.from,
                  () => {
                    const el = document.createElement("span");
                    el.className = "cm-point-marker";
                    el.setAttribute("aria-label", "Comment");
                    return el;
                  },
                  { side: 0 },
                ),
              );
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
