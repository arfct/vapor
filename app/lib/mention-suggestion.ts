import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey, type EditorState } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import {
  parseMentionToken,
  personMention,
  rankMentionItems,
  type MentionItem,
  type MentionSources,
  type MentionToken,
} from "~/shared/agent-protocol";
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

function insertToken(editor: Editor, range: Range, token: MentionToken, docState: ModeSource | null): void {
  const tracked = docState !== null && isSuggestMode(docState) && Boolean(editor.schema.marks.criticAddition);
  const marks = tracked ? [{ type: "criticAddition" }] : [];
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: "mention", attrs: { slug: token.slug, tag: token.tag, sid: token.sid }, marks },
      { type: "text", text: " ", marks },
    ])
    .run();
}

function insertLegacyHandle(editor: Editor, range: Range, handle: string, docState: ModeSource | null): void {
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

/** How a typed address is looked up; injectable for tests. Resolves to the person or null. */
export type ResolveEmail = (email: string) => Promise<{ uid: string; displayName: string } | null>;

export const resolveEmailViaServer: ResolveEmail = async (email) => {
  const res = await fetch(`/auth/resolve?email=${encodeURIComponent(email)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { person?: { uid: string; displayName: string } | null };
  return body.person ?? null;
};

/**
 * Inserts the chosen row over the trigger-plus-query range. Agents and
 * people insert a `mention` node carrying their token; a slug with no id
 * (a person the list couldn't identify) inserts plain `@slug` as before.
 * A typed address is resolved first — name and public id come back, the
 * address never enters the document — and nothing is inserted when no one
 * has signed in with it. In suggest mode the insertion is a tracked
 * addition, as typing it would have been.
 */
export function insertMention(
  editor: Editor,
  range: Range,
  item: Pick<MentionItem, "kind" | "handle">,
  docState: ModeSource | null,
  resolve: ResolveEmail = resolveEmailViaServer,
): void {
  if (item.kind === "email") {
    void resolve(item.handle)
      .then((person) => {
        if (!person || editor.isDestroyed) return;
        const handle = personMention(person.displayName, person.uid);
        const token = handle ? parseMentionToken(handle) : null;
        if (token) insertToken(editor, range, token, docState);
      })
      .catch(() => {});
    return;
  }
  const token = parseMentionToken(item.handle);
  if (token) insertToken(editor, range, token, docState);
  else insertLegacyHandle(editor, range, item.handle, docState);
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
        command: ({ editor, range, props }) => insertMention(editor, range, props, options.docState),
        render: suggestionRender<MentionItem>(MentionList, mentionPluginKey),
      }),
    ];
  },
});
