import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

export function hasSuggestionMarkup(editor: TiptapEditor): boolean {
  const { doc } = editor.state;
  const additionType = editor.schema.marks.criticAddition;
  const deletionType = editor.schema.marks.criticDeletion;
  if (!additionType || !deletionType) return false;

  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.isText) {
      if (
        node.marks.some(
          (m) =>
            m.type.name === "criticAddition" ||
            m.type.name === "criticDeletion",
        )
      ) {
        found = true;
      }
    }
  });
  return found;
}

export function isCursorInSuggestion(editor: TiptapEditor): boolean {
  const { from } = editor.state.selection;
  // Check nodes before and at cursor for suggestion marks
  for (const pos of [from - 1, from]) {
    if (pos < 0) continue;
    const node = editor.state.doc.nodeAt(pos);
    if (!node?.isText) continue;
    if (
      node.marks.some(
        (m) =>
          m.type.name === "criticAddition" || m.type.name === "criticDeletion",
      )
    ) {
      return true;
    }
  }
  return false;
}

interface MarkRange {
  from: number;
  to: number;
  markName: string;
}

function collectSuggestionRanges(editor: TiptapEditor): MarkRange[] {
  const ranges: MarkRange[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (
        mark.type.name === "criticAddition" ||
        mark.type.name === "criticDeletion"
      ) {
        ranges.push({
          from: pos,
          to: pos + node.nodeSize,
          markName: mark.type.name,
        });
      }
    }
  });
  return ranges;
}

/**
 * Find the contiguous mark range at the cursor position.
 * Looks at the marks on the resolved position and walks forward/backward
 * to find the full extent of the mark.
 */
function findMarkRangeAtCursor(editor: TiptapEditor): MarkRange | null {
  const { from } = editor.state.selection;

  // Check nodes before and at cursor for a suggestion mark
  let sugMarkName: string | null = null;
  for (const pos of [from - 1, from]) {
    if (pos < 0) continue;
    const node = editor.state.doc.nodeAt(pos);
    if (!node?.isText) continue;
    const mark = node.marks.find(
      (m) =>
        m.type.name === "criticAddition" || m.type.name === "criticDeletion",
    );
    if (mark) {
      sugMarkName = mark.type.name;
      break;
    }
  }
  if (!sugMarkName) return null;

  // Find the range: walk through all collected ranges that match this mark
  // and are contiguous with the cursor position
  const allRanges = collectSuggestionRanges(editor).filter(
    (r) => r.markName === sugMarkName,
  );

  // Find the range containing the cursor
  for (const range of allRanges) {
    if (from >= range.from && from <= range.to) {
      // Expand to include contiguous ranges of the same mark
      let mergedFrom = range.from;
      let mergedTo = range.to;
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of allRanges) {
          if (r.from <= mergedTo && r.to >= mergedFrom) {
            if (r.from < mergedFrom) {
              mergedFrom = r.from;
              changed = true;
            }
            if (r.to > mergedTo) {
              mergedTo = r.to;
              changed = true;
            }
          }
        }
      }
      return { from: mergedFrom, to: mergedTo, markName: sugMarkName };
    }
  }
  return null;
}

/** Merges runs of one mark that touch or overlap into single ranges. */
function mergeRuns(runs: MarkRange[]): MarkRange[] {
  const sorted = [...runs].sort((a, b) => a.from - b.from);
  const merged: MarkRange[] = [];
  for (const run of sorted) {
    const last = merged[merged.length - 1];
    if (last && run.from <= last.to) last.to = Math.max(last.to, run.to);
    else merged.push({ ...run });
  }
  return merged;
}

/**
 * The other half of a replacement: a deletion immediately followed by an
 * addition (or the reverse) is one suggestion — "change this to that" —
 * so it is accepted or rejected as a pair.
 */
function findPairedRange(editor: TiptapEditor, range: MarkRange): MarkRange | null {
  const otherName = range.markName === "criticAddition" ? "criticDeletion" : "criticAddition";
  const others = mergeRuns(collectSuggestionRanges(editor).filter((r) => r.markName === otherName));
  return others.find((r) => r.to === range.from || r.from === range.to) ?? null;
}

function applyDecision(tr: Transaction, editor: TiptapEditor, range: MarkRange, accept: boolean) {
  const markType = editor.schema.marks[range.markName];
  if (!markType) return;
  const keepText = range.markName === "criticAddition" ? accept : !accept;
  if (keepText) tr.removeMark(range.from, range.to, markType);
  else tr.delete(range.from, range.to);
}

export function processRangeAtCursor(editor: TiptapEditor, accept: boolean) {
  const range = findMarkRangeAtCursor(editor);
  if (!range) return;

  const paired = findPairedRange(editor, range);
  // Later range first so earlier positions stay valid.
  const ranges = [range, ...(paired ? [paired] : [])].sort((a, b) => b.from - a.from);

  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      for (const r of ranges) applyDecision(tr, editor, r, accept);
      return true;
    })
    .run();
}

export function processAllRanges(editor: TiptapEditor, accept: boolean) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const ranges = collectSuggestionRanges(editor);
      if (ranges.length === 0) return false;

      // Process end-to-start to preserve positions
      ranges.sort((a, b) => b.from - a.from);

      for (const range of ranges) {
        const markType = editor.schema.marks[range.markName];
        if (!markType) continue;

        if (range.markName === "criticAddition") {
          if (accept) {
            tr.removeMark(range.from, range.to, markType);
          } else {
            tr.delete(range.from, range.to);
          }
        } else if (range.markName === "criticDeletion") {
          if (accept) {
            tr.delete(range.from, range.to);
          } else {
            tr.removeMark(range.from, range.to, markType);
          }
        }
      }
      return true;
    })
    .run();
}
