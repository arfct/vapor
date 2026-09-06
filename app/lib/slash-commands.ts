import { Extension, type Editor } from "@tiptap/core";
import { PluginKey, type EditorState } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { isSuggestMode, showSuggestNotice, type ModeSource } from "~/lib/suggest-notice";
import { suggestionRender } from "~/lib/suggestion-popup";
import SlashList from "~/components/SlashList";

export const slashPluginKey = new PluginKey("slashCommands");

export type SlashGroup = "Text" | "Lists" | "Insert" | "Discuss";

export interface SlashItem {
  id: string;
  title: string;
  /** Extra search words: `h1`, `todo`, `ul`… */
  aliases: string[];
  /** Material Symbols name (must be in root.tsx's icon subset). */
  icon: string;
  group: SlashGroup;
  /** Block structure has no tracked form, so these wait for Edit mode — as in the toolbar. */
  structural: boolean;
  /** Runs after the `/query` text is removed. */
  run: (editor: Editor, actions: SlashActions) => void;
}

/** Things the editor cannot do alone; the layout provides them. */
export interface SlashActions {
  comment?: () => void;
}

export interface SlashActionsRef {
  current: SlashActions;
}

/** Mirrors the Format menu, one row per block command. */
export const SLASH_ITEMS: SlashItem[] = [
  { id: "paragraph", title: "Text", aliases: ["body", "paragraph", "p"], icon: "format_paragraph", group: "Text", structural: true,
    run: (e) => e.chain().focus().setParagraph().run() },
  { id: "h1", title: "Heading 1", aliases: ["h1", "title"], icon: "format_h1", group: "Text", structural: true,
    run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: "h2", title: "Heading 2", aliases: ["h2"], icon: "format_h2", group: "Text", structural: true,
    run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: "h3", title: "Heading 3", aliases: ["h3"], icon: "format_h3", group: "Text", structural: true,
    run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: "bullet", title: "Bullet list", aliases: ["ul", "bullets", "list"], icon: "format_list_bulleted", group: "Lists", structural: true,
    run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "numbered", title: "Numbered list", aliases: ["ol", "ordered", "numbers"], icon: "format_list_numbered", group: "Lists", structural: true,
    run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "task", title: "Task list", aliases: ["todo", "checkbox", "checklist", "tasks"], icon: "checklist", group: "Lists", structural: true,
    run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: "quote", title: "Quote", aliases: ["blockquote"], icon: "format_quote", group: "Lists", structural: true,
    run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "divider", title: "Divider", aliases: ["hr", "rule", "line"], icon: "horizontal_rule", group: "Insert", structural: true,
    run: (e) => e.chain().focus().setHorizontalRule().run() },
  { id: "code", title: "Code block", aliases: ["code", "pre", "fence"], icon: "code", group: "Insert", structural: true,
    run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: "table", title: "Table", aliases: ["grid"], icon: "table", group: "Insert", structural: false,
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "agent", title: "Agent instructions", aliases: ["agent", "ai", "instructions", "sidekick"], icon: "robot_2", group: "Insert", structural: false,
    run: (e) => e.chain().focus().toggleAgentInstructions().run() },
  { id: "comment", title: "Comment", aliases: ["note", "discuss"], icon: "add_comment", group: "Discuss", structural: false,
    run: (_e, actions) => actions.comment?.() },
];

/** Title or alias prefix match, in menu order. */
export function filterSlashItems(query: string, items: SlashItem[] = SLASH_ITEMS): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.title.toLowerCase().startsWith(q) ||
      item.title.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) ||
      item.aliases.some((a) => a.startsWith(q)),
  );
}

/** A slash item as shown: `disabled` when suggest mode blocks it. */
export type SlashRow = SlashItem & { disabled: boolean };

export function slashRows(query: string, suggest: boolean): SlashRow[] {
  return filterSlashItems(query).map((item) => ({ ...item, disabled: suggest && item.structural }));
}

/** Only a plain paragraph or heading, outside tables and code, takes slash commands. */
export function slashAllowed(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent.type.name;
  if (parent !== "paragraph" && parent !== "heading") return false;
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === "tableCell" || name === "tableHeader") return false;
  }
  return true;
}

export interface SlashCommandsOptions {
  docState: ModeSource | null;
  actions: SlashActionsRef | null;
}

/**
 * `/` at the start of a block opens the block-command menu. Built on
 * `@tiptap/suggestion` like the mention popup; a slash inside a path or URL
 * never triggers it because only the first character of a block counts.
 */
export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: "slashCommands",
  priority: 1100,

  addOptions() {
    return { docState: null, actions: null };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const suggest = () => options.docState !== null && isSuggestMode(options.docState);
    return [
      Suggestion<SlashRow, SlashRow>({
        editor: this.editor,
        pluginKey: slashPluginKey,
        char: "/",
        startOfLine: true,
        allowedPrefixes: null,
        allow: ({ state, range }) => slashAllowed(state, range.from),
        shouldShow: ({ transaction }) => !isChangeOrigin(transaction),
        items: ({ query }) => slashRows(query, suggest()),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          if (props.disabled) {
            showSuggestNotice();
            return;
          }
          props.run(editor, options.actions?.current ?? {});
        },
        render: suggestionRender<SlashRow>(SlashList, slashPluginKey),
      }),
    ];
  },
});
