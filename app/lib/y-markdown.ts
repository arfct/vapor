import * as Y from "yjs";
import { blockHash, parseAnchor } from "~/shared/agent-protocol";
import type { DocBlock } from "~/shared/agent-protocol";
import { tryParseCriticMarkup, type ParsedMark } from "~/lib/critic-parser";
import { DELIMITERS } from "~/lib/critic-constants";

// Maps Yjs formatting-attribute keys (the ProseMirror mark names used by
// critic-marks.ts) to the shared delimiter strings in critic-constants.ts.
const MARK_DELIMS: Record<string, { open: string; close: string }> = {
  criticAddition: DELIMITERS.addition,
  criticDeletion: DELIMITERS.deletion,
  criticComment: DELIMITERS.comment,
  criticHighlight: DELIMITERS.highlight,
};

// criticHighlight declares no `excludes` in critic-marks.ts, so a run can
// carry criticHighlight together with one of criticAddition/criticDeletion/
// criticComment (those three do mutually exclude each other). When more
// than one mark type is present on a run, nest delimiters in this stable
// order — highlight outermost — rather than silently dropping all but one.
const NEST_ORDER = ["criticHighlight", "criticAddition", "criticDeletion", "criticComment"];

function blockText(el: Y.XmlElement): string {
  let out = "";
  for (const child of el.toArray()) {
    if (!(child instanceof Y.XmlText)) continue;
    for (const op of child.toDelta() as { insert: string; attributes?: Record<string, unknown> }[]) {
      const attrs = op.attributes ?? {};
      const activeTypes = NEST_ORDER.filter((t) => t in attrs);
      let text = op.insert;
      for (let i = activeTypes.length - 1; i >= 0; i--) {
        const delims = MARK_DELIMS[activeTypes[i]];
        text = delims.open + text + delims.close;
      }
      out += text;
    }
  }
  return out;
}

export function getBlocks(doc: Y.Doc): DocBlock[] {
  const frag = doc.getXmlFragment("default");
  return frag.toArray().map((el, index) => {
    const text = el instanceof Y.XmlElement ? blockText(el) : "";
    return { index, hash: blockHash(text), text };
  });
}

export function yDocToMarkdown(doc: Y.Doc): string {
  return getBlocks(doc).map((b) => b.text).join("\n");
}

export function resolveAnchor(
  doc: Y.Doc,
  anchor: string,
): { index: number } | { error: "stale_anchor"; snippet: string } {
  const parsed = parseAnchor(anchor);
  const blocks = getBlocks(doc);
  const snippet = () =>
    blocks.slice(0, 6).map((b) => `[b${b.index} ${b.hash}] ${b.text.slice(0, 60)}`).join("\n");
  if (!parsed) return { error: "stale_anchor" as const, snippet: snippet() };
  const matches = blocks.filter((b) => b.hash === parsed.hash);
  if (matches.length === 0) return { error: "stale_anchor" as const, snippet: snippet() };
  const best = matches.reduce((a, b) =>
    Math.abs(a.index - parsed.index) <= Math.abs(b.index - parsed.index) ? a : b);
  return { index: best.index };
}

function makeParagraph(cleanText: string, marks: ParsedMark[]): Y.XmlElement {
  const para = new Y.XmlElement("paragraph");
  const ytext = new Y.XmlText(cleanText);
  for (const mark of marks) {
    ytext.format(mark.from, mark.to - mark.from, { [mark.type]: mark.attrs ?? {} });
  }
  para.insert(0, [ytext]);
  return para;
}

/**
 * Parses markdown into detached paragraph nodes, one per line, without
 * touching any document.
 *
 * Deliberately split from the insert so callers can validate first: Yjs has
 * no transaction rollback, so a delete-then-insert (see the `replace`
 * mutation) that discovers bad markdown halfway through would commit the
 * delete and lose the content it was replacing. Build the nodes, and only
 * then open the transaction.
 */
export function buildMarkdownBlocks(
  markdown: string,
): { ok: true; nodes: Y.XmlElement[] } | { ok: false; message: string } {
  const nodes: Y.XmlElement[] = [];
  for (const line of markdown.split("\n")) {
    const parsed = tryParseCriticMarkup(line);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    nodes.push(makeParagraph(parsed.cleanText, parsed.marks));
  }
  return { ok: true, nodes };
}

/** Inserts prebuilt paragraph nodes (from buildMarkdownBlocks) at `index`. */
export function insertBlockNodes(doc: Y.Doc, index: number, nodes: Y.XmlElement[]): void {
  const frag = doc.getXmlFragment("default");
  doc.transact(() => {
    frag.insert(index, nodes);
  });
}

export function deleteBlocks(doc: Y.Doc, from: number, to: number): void {
  const frag = doc.getXmlFragment("default");
  doc.transact(() => frag.delete(from, to - from + 1));
}
