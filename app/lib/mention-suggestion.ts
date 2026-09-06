import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey, type EditorState } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { rankMentionItems, type MentionItem, type MentionSources } from "~/shared/agent-protocol";
import { isSuggestMode, type ModeSource } from "~/lib/suggest-notice";
import { suggestionRender } from "~/lib/suggestion-popup";
import MentionList from "~/components/MentionList";

export const mentionPluginKey = new PluginKey("mentionSuggestion");

/** A mutable box so the popup always reads the latest roster and people without recreating the editor. */
export interface MentionSourceRef {
  current: MentionSources;
}

export const EMPTY_MENTION_SOURCES: MentionSources = { agents: [], people: [] };

/** Mentions are meaningless inside code, so the popup stays shut there. */
export function inCode(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent.type.name;
  if (parent === "codeBlock" || parent === "agentInstructions") return true;
  return $pos.marks().some((mark) => mark.type.name === "code");
}

/**
 * Inserts `@handle ` over the trigger-plus-query range. Mentions are plain
 * text, not a node: `@slug` is already what the server detects, agents read,
 * and the markdown export carries. In suggest mode the text is a tracked
 * addition, as typing it would have been (the suggest-mode plugin only sees
 * typed input, so the mark is applied here).
 */
export function insertMention(editor: Editor, range: Range, handle: string, docState: ModeSource | null): void {
  const tracked = docState !== null && isSuggestMode(docState) && Boolean(editor.schema.marks.criticAddition);
  editor
    .chain()
    .focus()
    .insertContentAt(range, {
      type: "text",
      text: `@${handle} `,
      marks: tracked ? [{ type: "criticAddition" }] : [],
    })
    .run();
}

export interface MentionSuggestionOptions {
  sources: MentionSourceRef | null;
  docState: ModeSource | null;
  /** Called when the popup asks for items: a chance to refresh the roster. */
  onQuery?: () => void;
}

/**
 * `@` completion built on `@tiptap/suggestion`, the utility TipTap's own
 * Mention extension is built on. Priority beats the keyboard-shortcut
 * extensions (1001) so Tab and Enter reach the popup while it is open.
 */
export const MentionSuggestion = Extension.create<MentionSuggestionOptions>({
  name: "mentionSuggestion",
  priority: 1100,

  addOptions() {
    return { sources: null, docState: null, onQuery: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        pluginKey: mentionPluginKey,
        char: "@",
        // An email handle carries a second `@`.
        allowToIncludeChar: true,
        allowedPrefixes: [" ", " ", "(", "[", "\"", "'"],
        allow: ({ state, range }) => !inCode(state, range.from),
        // A collaborator's keystrokes must not open a popup in this view.
        shouldShow: ({ transaction }) => !isChangeOrigin(transaction),
        items: ({ query }) => {
          options.onQuery?.();
          return rankMentionItems(query, options.sources?.current ?? EMPTY_MENTION_SOURCES);
        },
        command: ({ editor, range, props }) => insertMention(editor, range, props.handle, options.docState),
        render: suggestionRender<MentionItem>(MentionList, mentionPluginKey),
      }),
    ];
  },
});
