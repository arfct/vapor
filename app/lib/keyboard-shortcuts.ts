import { Extension, InputRule, type Editor } from "@tiptap/core";
import { Fragment, type MarkType, type Node as PMNode } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type Selection,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { mintBlockId } from "~/shared/rich-markdown";
import { isSuggestMode, showSuggestNotice, type ModeSource } from "~/lib/suggest-notice";

/**
 * The notes app's shortcut suite, ported for a collaborative editor.
 *
 * Suggest-mode policy: structural changes (ladder, move, duplicate, clear
 * formatting, linking a selection) are blocked with `showSuggestNotice`;
 * text-producing ones (typography input rules, insert paragraph) stay on,
 * and the input rules track their replacement as CriticMarkup themselves
 * because they run ahead of the suggest-mode plugin.
 */

export interface KeyboardShortcutsOptions {
  docState: ModeSource | null;
}

type HeadingLevel = 1 | 2 | 3;

/** Marks ⌘\ strips. Critic marks are review state, not formatting. */
const FORMATTING_MARKS = ["bold", "italic", "strike", "code", "link"];

const URL_RE = /^https?:\/\/\S+$/i;

/** Each pattern must end at the caret; the match is replaced wholesale. */
const TYPOGRAPHY_RULES: [find: RegExp, replacement: string][] = [
  [/(?:->|–>)$/, "→"],
  [/<[-–]$/, "←"],
  // Never fire after another dash: `---` at a line start must stay intact
  // for StarterKit's horizontal-rule input rule.
  [/(?<=[^-])--$/, "–"],
  [/\.\.\.$/, "…"],
];

function blockedInSuggestMode(docState: ModeSource | null): boolean {
  if (!docState || !isSuggestMode(docState)) return false;
  showSuggestNotice();
  return true;
}

/* ---------- Top-level block helpers ---------- */

function blockRange(doc: PMNode, index: number) {
  let from = 0;
  for (let i = 0; i < index; i++) from += doc.child(i).nodeSize;
  const node = doc.child(index);
  return { node, from, to: from + node.nodeSize };
}

/** Index of the top-level block holding the selection head, if any. */
function currentBlockIndex(editor: Editor): number | null {
  const { doc, selection } = editor.state;
  const index = selection.$from.index(0);
  return index < doc.childCount ? index : null;
}

/** The same selection, moved along with its block by `delta` positions. */
function shiftSelection(selection: Selection, doc: PMNode, delta: number): Selection {
  if (selection instanceof NodeSelection) return NodeSelection.create(doc, selection.from + delta);
  return TextSelection.between(doc.resolve(selection.anchor + delta), doc.resolve(selection.head + delta));
}

/** A deep copy where every node carrying a `blockId` gets a fresh one. */
export function withFreshBlockIds(node: PMNode): PMNode {
  if (node.isText) return node;
  const children: PMNode[] = [];
  node.content.forEach((child) => children.push(withFreshBlockIds(child)));
  const attrs = "blockId" in node.attrs ? { ...node.attrs, blockId: mintBlockId() } : node.attrs;
  return node.type.create(attrs, Fragment.from(children), node.marks);
}

/* ---------- Shortcuts ---------- */

/**
 * Tab walks down the ladder h1 → h2 → h3 → paragraph → bullet list;
 * Shift-Tab walks back up. Only direct children of the document take part —
 * inside lists StarterKit's sink/lift handlers keep the key.
 */
function ladder(editor: Editor, docState: ModeSource | null, direction: 1 | -1): boolean {
  const { $from, $to } = editor.state.selection;
  if ($from.depth !== 1 || !$from.sameParent($to)) return false;

  const block = $from.parent;
  const rung =
    block.type.name === "heading"
      ? (block.attrs.level as number) - 1
      : block.type.name === "paragraph"
        ? 3
        : -1;
  if (rung < 0 || rung > 3) return false;

  const next = rung + direction;
  if (next < 0) return true;
  if (blockedInSuggestMode(docState)) return true;
  if (next === 3) return editor.commands.setParagraph();
  if (next === 4) return editor.commands.toggleBulletList();
  return editor.commands.setHeading({ level: (next + 1) as HeadingLevel });
}

/** Swaps the current top-level block with its neighbour in one transaction. */
function moveBlock(editor: Editor, docState: ModeSource | null, direction: -1 | 1): boolean {
  const index = currentBlockIndex(editor);
  if (index === null) return true;
  const { doc, selection } = editor.state;
  const target = index + direction;
  if (target < 0 || target >= doc.childCount) return true;
  if (blockedInSuggestMode(docState)) return true;

  const first = Math.min(index, target);
  const { node: upper, from } = blockRange(doc, first);
  const lower = doc.child(first + 1);
  const tr = editor.state.tr.replaceWith(from, from + upper.nodeSize + lower.nodeSize, [lower, upper]);

  const oldStart = blockRange(doc, index).from;
  const newStart = direction === -1 ? from : from + lower.nodeSize;
  tr.setSelection(shiftSelection(selection, tr.doc, newStart - oldStart));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function duplicateBlock(editor: Editor, docState: ModeSource | null): boolean {
  const index = currentBlockIndex(editor);
  if (index === null) return true;
  if (blockedInSuggestMode(docState)) return true;

  const { doc, selection } = editor.state;
  const { node, from, to } = blockRange(doc, index);
  const tr = editor.state.tr.insert(to, withFreshBlockIds(node));
  tr.setSelection(shiftSelection(selection, tr.doc, to - from));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Allowed in suggest mode: the paragraph is empty, and typing into it is tracked. */
function insertParagraph(editor: Editor, side: "before" | "after"): boolean {
  const index = currentBlockIndex(editor);
  if (index === null) return false;
  const paragraph = editor.state.schema.nodes.paragraph;
  if (!paragraph) return false;

  const { from, to } = blockRange(editor.state.doc, index);
  const pos = side === "after" ? to : from;
  const tr = editor.state.tr.insert(pos, paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function clearFormatting(editor: Editor, docState: ModeSource | null): boolean {
  const { from, to, empty } = editor.state.selection;
  if (empty) return false;
  if (blockedInSuggestMode(docState)) return true;

  const tr = editor.state.tr;
  for (const name of FORMATTING_MARKS) {
    const type = editor.state.schema.marks[name];
    if (type) tr.removeMark(from, to, type);
  }
  editor.view.dispatch(tr);
  return true;
}

/* ---------- Typography input rules ---------- */

function rangeHasOnlyMark(doc: PMNode, from: number, to: number, type: MarkType): boolean {
  if (from >= to) return false;
  let all = true;
  doc.nodesBetween(from, to, (node) => {
    if (node.isText && !type.isInSet(node.marks)) all = false;
  });
  return all;
}

/**
 * Replaces `[from, to)` with `text`. In suggest mode the replacement is
 * recorded the way suggest-mode.ts records typing: inside an addition it
 * edits the addition; otherwise the old text is marked deleted and the new
 * text inserted after it as an addition.
 */
function replaceTracked(
  tr: Transaction,
  from: number,
  to: number,
  text: string,
  docState: ModeSource | null,
): void {
  const { criticAddition, criticDeletion } = tr.doc.type.schema.marks;
  if (!docState || !isSuggestMode(docState) || !criticAddition || !criticDeletion) {
    tr.insertText(text, from, to);
    return;
  }
  if (rangeHasOnlyMark(tr.doc, from, to, criticAddition)) {
    tr.insertText(text, from, to);
    tr.addMark(from, from + text.length, criticAddition.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + text.length)));
    return;
  }
  tr.addMark(from, to, criticDeletion.create());
  tr.insertText(text, to);
  tr.addMark(to, to + text.length, criticAddition.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(to + text.length)));
}

function typographyRule(find: RegExp, replacement: string, docState: ModeSource | null): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range }) => {
      replaceTracked(state.tr, range.from, range.to, replacement, docState);
    },
  });
}

/* ---------- Smart link paste ---------- */

function bareUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!URL_RE.test(trimmed)) return null;
  try {
    new URL(trimmed);
  } catch {
    return null;
  }
  return trimmed;
}

/**
 * Link text carried alongside a pasted URL: a lone anchor's text, or the
 * document `<title>` (what browsers put on the clipboard for a copied tab).
 */
export function linkTitleFromHtml(html: string, url: string): string | null {
  if (!html || typeof DOMParser === "undefined") return null;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const anchors = parsed.querySelectorAll("a[href]");
  const anchorText = anchors.length === 1 ? anchors[0].textContent?.trim() : "";
  const title = anchorText || parsed.querySelector("title")?.textContent?.trim() || "";
  if (!title || title === url || title === url.replace(/\/$/, "")) return null;
  return title;
}

/**
 * Pasting a URL over a selection links the selection; pasting a URL whose
 * HTML clipboard carries a title inserts the title as link text. Returns
 * false for anything else so the markdown paste in Editor.tsx still runs.
 */
export function handleSmartLinkPaste(
  view: EditorView,
  data: DataTransfer | null,
  docState: ModeSource | null,
): boolean {
  if (!data) return false;
  const url = bareUrl(data.getData("text/plain"));
  if (!url) return false;

  const { state } = view;
  const link = state.schema.marks.link;
  if (!link) return false;
  const { from, to, empty } = state.selection;

  if (!empty) {
    if (blockedInSuggestMode(docState)) return true;
    view.dispatch(state.tr.addMark(from, to, link.create({ href: url })));
    return true;
  }

  const title = linkTitleFromHtml(data.getData("text/html"), url);
  if (!title) return false;
  const marks = [link.create({ href: url })];
  const addition = state.schema.marks.criticAddition;
  if (docState && isSuggestMode(docState) && addition) marks.push(addition.create());
  view.dispatch(state.tr.replaceSelectionWith(state.schema.text(title, marks), false).scrollIntoView());
  return true;
}

function smartLinkPastePlugin(docState: ModeSource | null): Plugin {
  return new Plugin({
    key: new PluginKey("smartLinkPaste"),
    props: {
      handleDOMEvents: {
        // A DOM handler, not `handlePaste`: ProseMirror consults the view's
        // own editorProps.handlePaste (the markdown paste in Editor.tsx)
        // before any plugin's, whereas DOM handlers run ahead of both.
        paste(view, event) {
          if (!handleSmartLinkPaste(view, event.clipboardData, docState)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });
}

/* ---------- Extension ---------- */

export const KeyboardShortcuts = Extension.create<KeyboardShortcutsOptions>({
  name: "keyboardShortcuts",

  // Above Link (1000) and StarterKit (100): smart paste runs before
  // linkOnPaste, and Tab reaches the ladder first — it yields inside lists
  // so sink/lift keep working. Mod-Enter also takes over HardBreak's
  // binding; Shift-Enter still inserts a hard break.
  priority: 1001,

  addOptions() {
    return { docState: null };
  },

  addKeyboardShortcuts() {
    const { docState } = this.options;
    return {
      Tab: () => ladder(this.editor, docState, 1),
      "Shift-Tab": () => ladder(this.editor, docState, -1),
      "Mod-Ctrl-ArrowUp": () => moveBlock(this.editor, docState, -1),
      "Mod-Ctrl-ArrowDown": () => moveBlock(this.editor, docState, 1),
      "Mod-d": () => duplicateBlock(this.editor, docState),
      "Mod-Enter": () => insertParagraph(this.editor, "after"),
      "Mod-Shift-Enter": () => insertParagraph(this.editor, "before"),
      "Mod-\\": () => clearFormatting(this.editor, docState),
    };
  },

  addInputRules() {
    const { docState } = this.options;
    return TYPOGRAPHY_RULES.map(([find, replacement]) => typographyRule(find, replacement, docState));
  },

  addProseMirrorPlugins() {
    return [smartLinkPastePlugin(this.options.docState)];
  },
});
