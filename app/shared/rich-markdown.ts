/**
 * The document's serialization core: one ProseMirror schema shared by the
 * client editor and the DocumentAgent, a deterministic markdown
 * parser/serializer for it (GFM subset + CriticMarkup), and converters
 * between markdown, ProseMirror nodes, and the Yjs XmlFragment encoding
 * used by y-tiptap.
 *
 * Markdown is the interchange dialect everywhere (agents, exports, raw
 * endpoints); the CRDT holds rich nodes. Every node and mark here has a
 * canonical markdown form — anything without one doesn't belong in the
 * schema (see docs/plans/2026-08-31-wysiwyg-editing-plan.md).
 */
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { MarkdownParser, MarkdownSerializer } from "prosemirror-markdown";
import MarkdownIt from "markdown-it";
import * as Y from "yjs";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { blockHash, parseAnchor as parseLegacyAnchor, type DocBlock } from "./agent-protocol";

/* ---------- Schema (names must match the TipTap extensions) ---------- */

const blockIdAttr = { blockId: { default: null as string | null } };
const tableCellAttrs = {
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null as number[] | null },
};

export const richSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", attrs: blockIdAttr },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { ...blockIdAttr, level: { default: 1 } },
      defining: true,
    },
    blockquote: { content: "block+", group: "block", attrs: blockIdAttr, defining: true },
    codeBlock: {
      content: "text*",
      group: "block",
      attrs: { ...blockIdAttr, language: { default: null as string | null } },
      marks: "",
      code: true,
      defining: true,
    },
    bulletList: { content: "listItem+", group: "block", attrs: blockIdAttr },
    orderedList: {
      content: "listItem+",
      group: "block",
      attrs: { ...blockIdAttr, start: { default: 1 } },
    },
    listItem: { content: "paragraph block*", defining: true },
    // GFM task lists: `- [ ] todo` / `- [x] done`. Kept as their own nodes
    // (TipTap's TaskList/TaskItem) so the checkbox is a real attribute
    // that toggles through a transaction, not a text convention.
    taskList: { content: "taskItem+", group: "block", attrs: blockIdAttr },
    taskItem: {
      content: "paragraph block*",
      attrs: { checked: { default: false } },
      defining: true,
    },
    horizontalRule: { group: "block", attrs: blockIdAttr },
    // GFM tables. Cells hold inline content only — one line per cell, as
    // markdown can express — so the attrs exist for prosemirror-tables'
    // commands, not for anything the serializer can write.
    table: { content: "tableRow+", group: "block", attrs: blockIdAttr, isolating: true },
    tableRow: { content: "(tableCell | tableHeader)+" },
    tableCell: { content: "inline*", attrs: tableCellAttrs, isolating: true },
    tableHeader: { content: "inline*", attrs: tableCellAttrs, isolating: true },
    hardBreak: { inline: true, group: "inline", selectable: false },
    text: { inline: true, group: "inline" },
  },
  marks: {
    link: {
      attrs: {
        href: { default: null as string | null },
        target: { default: null as string | null },
        rel: { default: null as string | null },
        class: { default: null as string | null },
      },
      inclusive: false,
    },
    bold: {},
    italic: {},
    strike: {},
    code: {},
    criticAddition: { inclusive: false, excludes: "criticDeletion criticComment" },
    criticDeletion: { inclusive: false, excludes: "criticAddition criticComment" },
    criticComment: { inclusive: false, excludes: "criticAddition criticDeletion" },
    criticHighlight: {
      inclusive: false,
      attrs: { threadId: { default: null as string | null } },
    },
  },
});

/* ---------- Block ids ---------- */

export const BLOCK_ID_RE = /^[a-z0-9]{8}$/;

export function mintBlockId(): string {
  return (Math.random().toString(36).slice(2) + "00000000").slice(0, 8);
}

/** Node types that carry a blockId at the top level of the document. */
export const BLOCK_ID_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "horizontalRule",
];

/* ---------- markdown-it with CriticMarkup inline syntax ---------- */

const CRITIC_KINDS: [open: string, close: string, name: string][] = [
  ["{++", "++}", "criticAddition"],
  ["{--", "--}", "criticDeletion"],
  ["{==", "==}", "criticHighlight"],
  ["{>>", "<<}", "criticComment"],
];

type MdState = {
  src: string;
  pos: number;
  posMax: number;
  push: (type: string, tag: string, nesting: number) => unknown;
  md: { inline: { tokenize: (state: MdState) => void } };
};

function criticRule(state: MdState, silent: boolean): boolean {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== 0x7b /* { */) return false;
  for (const [open, close, name] of CRITIC_KINDS) {
    if (!src.startsWith(open, pos)) continue;
    const end = src.indexOf(close, pos + open.length);
    if (end < 0 || end > state.posMax) return false;
    if (!silent) {
      state.push(`${name}_open`, "span", 1);
      const oldPos = state.pos;
      const oldMax = state.posMax;
      state.pos = pos + open.length;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.pos = oldPos;
      state.posMax = oldMax;
      state.push(`${name}_close`, "span", -1);
    }
    state.pos = end + close.length;
    return true;
  }
  return false;
}

type MdToken = {
  type: string;
  level: number;
  content: string;
  attrs: [string, string][] | null;
  attrSet: (name: string, value: string) => void;
};

const TASK_PREFIX_RE = /^\[([ xX])\]\s+/;

/**
 * Retypes a bullet list whose every item starts with `[ ]` / `[x]` into
 * task_list / task_item tokens (stripping the marker from the paragraph
 * text), so the parser maps it to taskList/taskItem. Runs before inline
 * tokenization while paragraph content is still a plain string. Lists
 * that mix task and plain items stay ordinary bullet lists, as in GFM.
 */
function taskListRule(state: { tokens: MdToken[] }): void {
  const toks = state.tokens;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== "bullet_list_open") continue;
    const level = toks[i].level;
    let close = -1;
    for (let j = i + 1; j < toks.length; j++) {
      if (toks[j].type === "bullet_list_close" && toks[j].level === level) {
        close = j;
        break;
      }
    }
    if (close < 0) continue;

    // Each direct item must open with a paragraph whose text carries a marker.
    const items: { open: number; inline: number; checked: boolean }[] = [];
    let allTasks = true;
    for (let j = i + 1; j < close; j++) {
      const t = toks[j];
      if (t.type !== "list_item_open" || t.level !== level + 1) continue;
      const para = toks[j + 1];
      const inline = toks[j + 2];
      const m =
        para?.type === "paragraph_open" && inline?.type === "inline"
          ? TASK_PREFIX_RE.exec(inline.content)
          : null;
      if (!m) {
        allTasks = false;
        break;
      }
      items.push({ open: j, inline: j + 2, checked: m[1] !== " " });
    }
    if (!allTasks || items.length === 0) continue;

    toks[i].type = "task_list_open";
    toks[close].type = "task_list_close";
    for (const item of items) {
      toks[item.open].type = "task_item_open";
      toks[item.open].attrSet("checked", String(item.checked));
      toks[item.inline].content = toks[item.inline].content.replace(TASK_PREFIX_RE, "");
      for (let j = item.open + 1; j < close; j++) {
        if (toks[j].type === "list_item_close" && toks[j].level === level + 1) {
          toks[j].type = "task_item_close";
          break;
        }
      }
    }
  }
}

function makeMarkdownIt() {
  const md = new MarkdownIt({ html: false, linkify: true });
  // Images aren't representable in the schema — leave their syntax as text.
  md.disable(["image"]);
  md.inline.ruler.before("emphasis", "critic", criticRule as never);
  md.core.ruler.before("inline", "task_list", taskListRule as never);
  // The schema has rows directly under table; markdown-it's thead/tbody
  // wrappers have no node to map to, so drop them.
  md.core.ruler.push("table_sections", ((state: { tokens: MdToken[] }) => {
    state.tokens = state.tokens.filter((t) => !/^(thead|tbody)_(open|close)$/.test(t.type));
  }) as never);
  return md;
}

/* ---------- Parser ---------- */

export const markdownParser = new MarkdownParser(richSchema, makeMarkdownIt() as never, {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "listItem" },
  bullet_list: { block: "bulletList" },
  ordered_list: {
    block: "orderedList",
    getAttrs: (tok) => ({ start: Number(tok.attrGet("start")) || 1 }),
  },
  heading: {
    block: "heading",
    getAttrs: (tok) => ({ level: Math.min(Number(tok.tag.slice(1)) || 1, 3) }),
  },
  code_block: { block: "codeBlock", noCloseToken: true },
  fence: {
    block: "codeBlock",
    getAttrs: (tok) => ({ language: tok.info.trim() || null }),
    noCloseToken: true,
  },
  task_list: { block: "taskList" },
  task_item: {
    block: "taskItem",
    getAttrs: (tok) => ({ checked: tok.attrGet("checked") === "true" }),
  },
  table: { block: "table" },
  tr: { block: "tableRow" },
  th: { block: "tableHeader" },
  td: { block: "tableCell" },
  hr: { node: "horizontalRule" },
  hardbreak: { node: "hardBreak" },
  em: { mark: "italic" },
  strong: { mark: "bold" },
  s: { mark: "strike" },
  link: {
    mark: "link",
    getAttrs: (tok) => ({ href: tok.attrGet("href") }),
  },
  code_inline: { mark: "code", noCloseToken: true },
  criticAddition: { mark: "criticAddition" },
  criticDeletion: { mark: "criticDeletion" },
  criticHighlight: { mark: "criticHighlight" },
  criticComment: { mark: "criticComment" },
});

/* ---------- Serializer ---------- */

function backticksFor(node: PMNode, side: -1 | 1): string {
  const ticks = /`+/g;
  let len = 0;
  if (node.isText) {
    let m: RegExpExecArray | null;
    while ((m = ticks.exec(node.text ?? ""))) len = Math.max(len, m[0].length);
  }
  let result = len > 0 && side > 0 ? " `" : "`";
  for (let i = 0; i < len; i++) result += "`";
  if (len > 0 && side < 0) result += " ";
  return result;
}

export const markdownSerializer = new MarkdownSerializer(
  {
    blockquote(state, node) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },
    codeBlock(state, node) {
      state.write("```" + (node.attrs.language ?? "") + "\n");
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write("```");
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write("#".repeat(node.attrs.level as number) + " ");
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    horizontalRule(state, node) {
      state.write("---");
      state.closeBlock(node);
    },
    table(state, node) {
      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(serializeCellInline(cell)));
        rows.push(cells);
      });
      if (rows.length === 0) return;
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
      const line = (r: string[]) => "| " + pad(r).join(" | ") + " |";
      // GFM requires a header row; a table whose first row is body cells
      // gets an empty header so the separator still parses.
      const firstIsHeader = node.firstChild?.firstChild?.type.name === "tableHeader";
      const body = firstIsHeader ? rows.slice(1) : rows;
      state.write(line(firstIsHeader ? rows[0] : Array(width).fill("")) + "\n");
      state.write("| " + Array(width).fill("---").join(" | ") + " |");
      for (const r of body) state.write("\n" + line(r));
      state.closeBlock(node);
    },
    bulletList(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    orderedList(state, node) {
      const start = (node.attrs.start as number) || 1;
      const maxW = String(start + node.childCount - 1).length;
      const space = " ".repeat(maxW + 2);
      state.renderList(node, space, (i) => {
        const nStr = String(start + i);
        return " ".repeat(maxW - nStr.length) + nStr + ". ";
      });
    },
    listItem(state, node) {
      state.renderContent(node);
    },
    taskList(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    taskItem(state, node) {
      state.write(node.attrs.checked ? "[x] " : "[ ] ");
      state.renderContent(node);
    },
    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },
    hardBreak(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write("\\\n");
          return;
        }
      }
    },
    text(state, node) {
      state.text(node.text ?? "");
    },
  },
  {
    link: {
      open: "[",
      close(state, mark) {
        return "](" + (mark.attrs.href as string ?? "") + ")";
      },
      mixable: false,
    },
    bold: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
    italic: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    code: {
      open(_state, _mark, parent, index) {
        return backticksFor(parent.child(index), -1);
      },
      close(_state, _mark, parent, index) {
        return backticksFor(parent.child(index - 1), 1);
      },
      escape: false,
    },
    criticAddition: { open: "{++", close: "++}", mixable: true },
    criticDeletion: { open: "{--", close: "--}", mixable: true },
    criticHighlight: { open: "{==", close: "==}", mixable: true },
    criticComment: { open: "{>>", close: "<<}", mixable: true },
  },
);

const SERIALIZE_OPTS = { tightLists: true };

/** A table cell's inline content as one line of markdown, pipes escaped. */
function serializeCellInline(cell: PMNode): string {
  const para = richSchema.node("paragraph", null, cell.content);
  return markdownSerializer
    .serialize(richSchema.node("doc", null, [para]), SERIALIZE_OPTS)
    .replace(/\n+$/, "")
    .replace(/\n/g, " ")
    .replace(/\|/g, "\\|");
}

export function serializePmDoc(doc: PMNode): string {
  return markdownSerializer.serialize(doc, SERIALIZE_OPTS).replace(/\n+$/, "");
}

function serializeBlockNode(node: PMNode): string {
  return markdownSerializer
    .serialize(richSchema.node("doc", null, [node]), SERIALIZE_OPTS)
    .replace(/\n+$/, "");
}

/** Parses markdown into a ProseMirror doc. Returns an error instead of throwing. */
export function parseMarkdown(
  markdown: string,
): { ok: true; doc: PMNode } | { ok: false; message: string } {
  try {
    const doc = markdownParser.parse(markdown);
    if (!doc) return { ok: false, message: "Empty document" };
    return { ok: true, doc };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Unsupported markdown" };
  }
}

/* ---------- Y.Doc conversions ---------- */

function pmRootFromY(doc: Y.Doc): PMNode | null {
  const frag = doc.getXmlFragment("default");
  if (frag.length === 0) return null;
  return yXmlFragmentToProseMirrorRootNode(frag, richSchema);
}

export function yDocToMarkdown(doc: Y.Doc): string {
  const root = pmRootFromY(doc);
  return root ? serializePmDoc(root) : "";
}

export function getBlocks(doc: Y.Doc): DocBlock[] {
  const root = pmRootFromY(doc);
  if (!root) return [];
  const blocks: DocBlock[] = [];
  root.forEach((child, _offset, index) => {
    const text = serializeBlockNode(child);
    blocks.push({
      index,
      id: (child.attrs.blockId as string | null) ?? null,
      hash: blockHash(text),
      text,
    });
  });
  return blocks;
}

export function formatAnchor(b: DocBlock): string {
  return b.id ? `${b.id}-${b.hash}` : `b${b.index}-${b.hash}`;
}

/**
 * Resolves an anchor to a block index. Anchors are `{blockId}-{hash}`;
 * the id is identity, the hash a staleness check — a found id with a
 * mismatched hash is `stale_block` (the block changed since the caller
 * read it) and the snippet carries the block's current state so the
 * caller can retry without a full re-read. Legacy `b{index}-{hash}`
 * anchors (pre-block-id documents) fall back to hash matching.
 */
export function resolveAnchor(
  doc: Y.Doc,
  anchor: string,
): { index: number } | { error: "stale_anchor" | "stale_block"; snippet: string } {
  const blocks = getBlocks(doc);
  const overview = () =>
    blocks
      .slice(0, 6)
      .map((b) => `[${formatAnchor(b)}] ${b.text.slice(0, 60)}`)
      .join("\n");

  const m = /^([a-z0-9]{8})-([0-9a-f]{8})$/.exec(anchor);
  if (m) {
    const byId = blocks.find((b) => b.id === m[1]);
    if (byId) {
      if (byId.hash !== m[2]) {
        return {
          error: "stale_block",
          snippet: `[${formatAnchor(byId)}] ${byId.text.slice(0, 200)}`,
        };
      }
      return { index: byId.index };
    }
  }

  const legacy = parseLegacyAnchor(anchor);
  if (legacy) {
    const matches = blocks.filter((b) => b.hash === legacy.hash);
    if (matches.length > 0) {
      const best = matches.reduce((a, b) =>
        Math.abs(a.index - legacy.index) <= Math.abs(b.index - legacy.index) ? a : b,
      );
      return { index: best.index };
    }
  }

  return { error: "stale_anchor", snippet: overview() };
}

/* ---------- PM → Y (mirrors y-tiptap's encoding) ---------- */

type TextRun = { text: string; attrs: Record<string, unknown> | undefined };

function marksToYAttributes(node: PMNode): Record<string, unknown> | undefined {
  if (node.marks.length === 0) return undefined;
  const attrs: Record<string, unknown> = {};
  for (const mark of node.marks) attrs[mark.type.name] = mark.attrs;
  return attrs;
}

export function pmNodeToYElement(node: PMNode): Y.XmlElement {
  const el = new Y.XmlElement(node.type.name);
  for (const [key, val] of Object.entries(node.attrs)) {
    if (val !== null) el.setAttribute(key, val as string);
  }

  const children: (Y.XmlElement | Y.XmlText)[] = [];
  let textGroup: TextRun[] = [];
  const flushText = () => {
    if (textGroup.length === 0) return;
    const ytext = new Y.XmlText();
    ytext.applyDelta(
      textGroup.map((run) => ({ insert: run.text, attributes: run.attrs })),
    );
    children.push(ytext);
    textGroup = [];
  };

  node.forEach((child) => {
    if (child.isText) {
      textGroup.push({ text: child.text ?? "", attrs: marksToYAttributes(child) });
    } else {
      flushText();
      children.push(pmNodeToYElement(child));
    }
  });
  flushText();

  if (children.length > 0) el.insert(0, children);
  return el;
}

/**
 * Parses markdown into detached rich block elements, minting block ids,
 * without touching any document. Split from the insert so callers can
 * validate first — Yjs has no transaction rollback (see the `replace`
 * mutation).
 */
export function buildMarkdownBlocks(
  markdown: string,
): { ok: true; nodes: Y.XmlElement[] } | { ok: false; message: string } {
  const parsed = parseMarkdown(markdown);
  if (!parsed.ok) return parsed;
  const nodes: Y.XmlElement[] = [];
  parsed.doc.forEach((child) => {
    const withId =
      child.attrs.blockId == null && "blockId" in child.attrs
        ? child.type.create({ ...child.attrs, blockId: mintBlockId() }, child.content, child.marks)
        : child;
    nodes.push(pmNodeToYElement(withId));
  });
  return { ok: true, nodes };
}

/** Inserts prebuilt block elements (from buildMarkdownBlocks) at `index`. */
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

/* ---------- Typed-performance support ---------- */

export interface TypedBlockFill {
  ytext: Y.XmlText;
  runs: TextRun[];
}

/**
 * Builds a block element whose text nodes start EMPTY, plus the ordered
 * list of fills to type into them — the performance engine inserts the
 * skeleton synchronously (claiming its slot), then types each run in
 * chunks with its formatting attributes, so styled text styles while it
 * is typed.
 */
export function buildTypedBlock(node: PMNode): { element: Y.XmlElement; fills: TypedBlockFill[] } {
  const fills: TypedBlockFill[] = [];

  function build(n: PMNode): Y.XmlElement {
    const el = new Y.XmlElement(n.type.name);
    for (const [key, val] of Object.entries(n.attrs)) {
      if (val !== null) el.setAttribute(key, val as string);
    }
    const children: (Y.XmlElement | Y.XmlText)[] = [];
    let textGroup: TextRun[] = [];
    const flushText = () => {
      if (textGroup.length === 0) return;
      const ytext = new Y.XmlText();
      fills.push({ ytext, runs: textGroup });
      children.push(ytext);
      textGroup = [];
    };
    n.forEach((child) => {
      if (child.isText) {
        // Explicit {} (not undefined): a Y.Text insert without attributes
        // inherits the formatting at the insertion point, which would smear
        // the previous run's marks over this one during typed fills.
        textGroup.push({ text: child.text ?? "", attrs: marksToYAttributes(child) ?? {} });
      } else {
        flushText();
        children.push(build(child));
      }
    });
    flushText();
    if (children.length > 0) el.insert(0, children);
    return el;
  }

  const withId =
    node.attrs.blockId == null && "blockId" in node.attrs
      ? node.type.create({ ...node.attrs, blockId: mintBlockId() }, node.content, node.marks)
      : node;
  return { element: build(withId), fills };
}
