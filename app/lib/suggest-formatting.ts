import { Extension, commands as core, getMarkType } from "@tiptap/core";
import type { Mark, MarkType } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { isSuggestMode, showSuggestNotice, type ModeSource } from "./suggest-notice";

/** Formatting marks a reviewer may propose; critic marks are never toggled through here. */
const TRACKED_MARKS = new Set(["bold", "italic", "strike", "code", "link"]);

/**
 * Block-level shortcuts StarterKit and the list/blockquote/code extensions
 * register. In suggest mode they are swallowed with the notice — structure
 * changes have no tracked form, so they wait for Edit mode.
 */
const STRUCTURAL_SHORTCUTS = [
  "Mod-Alt-1",
  "Mod-Alt-2",
  "Mod-Alt-3",
  "Mod-Alt-4",
  "Mod-Alt-5",
  "Mod-Alt-6",
  "Mod-Shift-7",
  "Mod-Shift-8",
  "Mod-Shift-9",
  "Mod-Shift-b",
  "Mod-Alt-c",
];

function rangeAllHasMark(state: EditorState, from: number, to: number, name: string): boolean {
  let all = true;
  let sawText = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!all || !node.isText) return;
    sawText = true;
    if (!node.marks.some((m) => m.type.name === name)) all = false;
  });
  return sawText && all;
}

/**
 * Whether a formatting change over the current selection can be tracked:
 * a non-empty selection within one textblock that isn't already someone's
 * pending deletion.
 */
export function canTrackMarkChange(state: EditorState): boolean {
  const { from, to, $from, $to } = state.selection;
  if (from === to || !$from.sameParent($to)) return false;
  if (rangeAllHasMark(state, from, to, "criticDeletion")) return false;
  return Boolean(state.schema.marks.criticAddition && state.schema.marks.criticDeletion);
}

/**
 * The tracked form of a formatting change, applied to `tr`: the selected
 * text is marked deleted and a copy with the new marks is inserted after
 * it as an addition — `{--old--}{++**old**++}` in CriticMarkup — so
 * Accept/Reject and the export work exactly as they do for typed
 * suggestions. Call canTrackMarkChange first.
 */
export function applyTrackedMarkChange(
  tr: Transaction,
  type: MarkType,
  attrs: Record<string, unknown> | undefined,
  action: "toggle" | "set" | "unset",
): void {
  const state = { doc: tr.doc, selection: tr.selection } as EditorState;
  const { from, to } = tr.selection;
  const addition = tr.doc.type.schema.marks.criticAddition;
  const deletion = tr.doc.type.schema.marks.criticDeletion;

  const remove = action === "unset" || (action === "toggle" && rangeAllHasMark(state, from, to, type.name));
  const copy = tr.doc.slice(from, to).content;
  const replacement = copy.content.map((node) => {
    if (!node.isText) return node;
    let marks: readonly Mark[] = node.marks.filter((m) => m.type !== deletion && m.type !== type);
    if (!remove) marks = type.create(attrs).addToSet(marks);
    return node.mark(addition.create().addToSet(marks));
  });

  tr.addMark(from, to, deletion.create());
  tr.insert(to, replacement);
  tr.setSelection(TextSelection.create(tr.doc, to, to + copy.size));
}

/**
 * Suggest-mode formatting. Inline marks over a selection become tracked
 * changes (see trackedMarkChange); text already inside a pending addition
 * is formatted directly, since it's the suggester's own draft. Everything
 * else falls through to TipTap's own commands, so Edit mode is untouched.
 *
 * Priority is deliberately LOW: TipTap merges commands in load order and
 * the last definition of a name wins, so overriding core's toggleMark /
 * setMark / unsetMark means loading after core, not before.
 */
export const SuggestFormatting = Extension.create<{ docState: ModeSource | null }>({
  name: "suggestFormatting",
  priority: 50,

  addOptions() {
    return { docState: null };
  },

  addCommands() {
    const docState = () => this.options.docState;
    const tracked = (
      action: "toggle" | "set" | "unset",
      typeOrName: string | MarkType,
      attrs: Record<string, unknown> | undefined,
    ) =>
      ({ state, dispatch, tr }: { state: EditorState; dispatch?: unknown; tr: Transaction }) => {
        const ds = docState();
        if (!ds || !isSuggestMode(ds)) return null;
        const type = getMarkType(typeOrName, state.schema);
        if (!TRACKED_MARKS.has(type.name)) return null;
        const { from, to } = state.selection;
        if (from === to) return null;
        if (rangeAllHasMark(state, from, to, "criticAddition")) return null;
        if (!canTrackMarkChange(state)) {
          if (dispatch) showSuggestNotice("Select text within one paragraph to suggest formatting");
          return false;
        }
        if (dispatch) applyTrackedMarkChange(tr, type, attrs, action);
        return true;
      };

    return {
      toggleMark:
        (typeOrName, attributes, options) =>
        (props) => {
          const handled = tracked("toggle", typeOrName, attributes)(props);
          if (handled !== null) return handled;
          return core.toggleMark(typeOrName, attributes, options)(props);
        },
      setMark:
        (typeOrName, attributes) =>
        (props) => {
          const handled = tracked("set", typeOrName, attributes)(props);
          if (handled !== null) return handled;
          return core.setMark(typeOrName, attributes)(props);
        },
      unsetMark:
        (typeOrName, options) =>
        (props) => {
          const handled = tracked("unset", typeOrName, undefined)(props);
          if (handled !== null) return handled;
          return core.unsetMark(typeOrName, options)(props);
        },
    };
  },

});

/**
 * Swallows StarterKit's block-level shortcuts in suggest mode with the
 * notice. Priority is HIGH so the keymap runs before the extensions that
 * own those shortcuts.
 */
export const SuggestStructureGuard = Extension.create<{ docState: ModeSource | null }>({
  name: "suggestStructureGuard",
  priority: 1000,

  addOptions() {
    return { docState: null };
  },

  addKeyboardShortcuts() {
    const blocked = () => {
      const ds = this.options.docState;
      if (!ds || !isSuggestMode(ds)) return false;
      showSuggestNotice();
      return true;
    };
    return Object.fromEntries(STRUCTURAL_SHORTCUTS.map((key) => [key, blocked]));
  },
});
