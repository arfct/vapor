import { useEffect, useCallback, useRef, useState } from "react";
import type { CommentColorRange } from "~/shared/types";
import { CommentColors, commentColorsKey, commentColorAt } from "~/lib/comment-colors";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension, type Editor as TiptapEditor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight, CriticPointMarkers } from "~/lib/critic-marks";
import { BlockId } from "~/lib/block-id";
import { CodeBlock } from "~/lib/code-block";
import { CodeBlockCopy } from "~/lib/code-block-copy";
import { AgentInstructions } from "~/lib/agent-instructions";
import { CommentClickHandler } from "~/lib/comment-click";
import { AppLinks, APP_LINK_PROTOCOL } from "~/lib/app-links";
import { Attachment } from "~/lib/attachment";
import { MentionSuggestion, type MentionSourceRef } from "~/lib/mention-suggestion";
import { MentionHighlight, mentionHighlightKey, type MentionTargetsRef } from "~/lib/mention-highlight";
import { SlashCommands, type SlashActionsRef } from "~/lib/slash-commands";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";

// One line per cell, as GFM can express — matches the shared schema.
const InlineTableCell = TableCell.extend({ content: "inline*" });
const InlineTableHeader = TableHeader.extend({ content: "inline*" });
import { KeyboardShortcuts } from "~/lib/keyboard-shortcuts";
import { SuggestFormatting, SuggestStructureGuard } from "~/lib/suggest-formatting";
import { TitleBlock, type TitleBlockOptions } from "~/lib/title-block";
import { parseMarkdown } from "~/shared/rich-markdown";
import { suggestModePlugin } from "~/lib/suggest-mode";
import BubbleToolbar from "~/components/BubbleToolbar";
import type { useYjsEditor } from "~/lib/useYjsEditor";

const SuggestMode = Extension.create<{ docState: ReturnType<typeof useYjsEditor>["docState"] | null }>({
  name: "suggestMode",
  addOptions() {
    return { docState: null };
  },
  addProseMirrorPlugins() {
    if (!this.options.docState) return [];
    return [suggestModePlugin(this.options.docState)];
  },
});

// Plugin that highlights a range while the comment input is open
const commentHighlightKey = new PluginKey("commentHighlight");

const CommentHighlight = Extension.create({
  name: "commentHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentHighlightKey,
        state: {
          init() {
            return null as { from: number; to: number } | null;
          },
          apply(tr, value) {
            const meta = tr.getMeta(commentHighlightKey);
            if (meta !== undefined) return meta;
            if (value && tr.docChanged) {
              const from = tr.mapping.map(value.from);
              const to = tr.mapping.map(value.to);
              return from < to ? { from, to } : null;
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const range = commentHighlightKey.getState(state) as { from: number; to: number } | null;
            if (!range) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, {
                class: "comment-selection-highlight",
              }),
            ]);
          },
        },
      }),
    ];
  },
});

// Plugin that highlights the active comment thread's range in the editor
const activeCommentHighlightKey = new PluginKey("activeCommentHighlight");

const ActiveCommentHighlight = Extension.create({
  name: "activeCommentHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: activeCommentHighlightKey,
        state: {
          init() {
            return null as { from: number; to: number } | null;
          },
          apply(tr, value) {
            const meta = tr.getMeta(activeCommentHighlightKey);
            if (meta !== undefined) return meta;
            if (value && tr.docChanged) {
              const from = tr.mapping.map(value.from);
              const to = tr.mapping.map(value.to);
              return from < to ? { from, to } : null;
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const range = activeCommentHighlightKey.getState(state) as {
              from: number;
              to: number;
            } | null;
            if (!range) return DecorationSet.empty;
            const color = commentColorAt(state, range.from);
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, {
                class: "cm-comment-active",
                ...(color ? { style: `--comment-color: ${color}` } : {}),
              }),
            ]);
          },
        },
      }),
    ];
  },
});

type YjsEditorState = ReturnType<typeof useYjsEditor>;

const HEADER_HEIGHT_PX = 60;

/** True when `el` sits inside the viewport, clear of the header, with some breathing room. */
function isComfortablyInView(el: Element, margin = 48): boolean {
  const viewportHeight = window.visualViewport?.height ?? document.documentElement.clientHeight;
  const rect = el.getBoundingClientRect();
  return rect.top >= HEADER_HEIGHT_PX + margin && rect.bottom <= viewportHeight - margin;
}

function renderCaret(user: Record<string, unknown>) {
  const cursor = document.createElement("span");
  cursor.classList.add("collaboration-cursor__caret");
  cursor.setAttribute("style", `border-color: ${user.color}`);

  const label = document.createElement("div");
  label.classList.add("collaboration-cursor__label");
  label.setAttribute("style", `background-color: ${user.color}`);
  if (user.avatar) {
    const avatar = document.createElement("img");
    avatar.classList.add("collaboration-cursor__avatar");
    avatar.setAttribute("src", user.avatar as string);
    avatar.setAttribute("alt", "");
    label.insertBefore(avatar, null);
  } else if (user.animal) {
    const animal = document.createElement("span");
    animal.classList.add("anon-animal", "collaboration-cursor__animal");
    animal.insertBefore(document.createTextNode(user.animal as string), null);
    label.insertBefore(animal, null);
  }
  label.insertBefore(document.createTextNode(user.name as string), null);

  if (user.isAgent) {
    const badge = document.createElement("span");
    badge.classList.add("collaboration-cursor__badge");
    badge.insertBefore(document.createTextNode("AI"), null);
    label.insertBefore(badge, null);
  }

  cursor.insertBefore(label, null);
  return cursor;
}

export default function Editor({
  yjs,
  hidden,
  autofocus = false,
  placeholders,
  onEditorReady,
  onCommentClick,
  onAppLink,
  commentHighlight,
  activeCommentRange,
  commentColors,
  onNewComment,
  mentions = null,
  mentionTargets = null,
  mentionTargetsKey = "",
  onMentionQuery,
  slashActions = null,
}: {
  yjs: YjsEditorState;
  hidden?: boolean;
  /** Focus the editor on mount — for a document the user just created. */
  autofocus?: boolean;
  /** Title / body placeholder text for an empty document. */
  placeholders?: TitleBlockOptions;
  onEditorReady?: (editor: TiptapEditor) => void;
  onCommentClick?: (commentText: string) => void;
  /** A `vapor:` link was clicked or tapped. */
  onAppLink?: (url: string) => void;
  commentHighlight?: { from: number; to: number } | null;
  activeCommentRange?: { from: number; to: number } | null;
  commentColors?: CommentColorRange[];
  onNewComment?: () => void;
  /** Who `@` completes to; read live through the ref. */
  mentions?: MentionSourceRef | null;
  /** Known mention handles and colours for the in-text highlight. */
  mentionTargets?: MentionTargetsRef | null;
  /** Changes when `mentionTargets` does; triggers a re-decoration. */
  mentionTargetsKey?: string;
  /** The `@` popup opened or its query changed: refresh the roster. */
  onMentionQuery?: () => void;
  /** What the `/` menu's non-editor rows do. */
  slashActions?: SlashActionsRef | null;
}) {
  const { doc, awareness, user, docState } = yjs;
  const prevHighlightRef = useRef<{ from: number; to: number } | null>(null);
  const prevActiveRangeRef = useRef<{ from: number; to: number } | null>(null);

  const editor = useEditor(
    {
      immediatelyRender: false,
      autofocus: autofocus ? "end" : false,
      extensions: [
        StarterKit.configure({
          // Collaboration owns history; underline has no markdown form
          // (see the markdown-completeness rule in the WYSIWYG plan).
          undoRedo: false,
          underline: false,
          // Replaced by CodeBlock (lowlight highlighting + language selector).
          codeBlock: false,
          heading: { levels: [1, 2, 3] },
          link: {
            openOnClick: false,
            autolink: true,
            linkOnPaste: true,
            // `@ada@example.com` is a mention; autolinking its tail to a
            // mailto would break it. Bare emails stay text as a result.
            shouldAutoLink: (url) => !url.startsWith("mailto:"),
            // `vapor:` links are actions inside the app (see app-links.ts).
            protocols: [APP_LINK_PROTOCOL],
          },
        }),
        CodeBlock,
        BlockId,
        CodeBlockCopy,
        AgentInstructions,
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: false }),
        TableRow,
        InlineTableHeader,
        InlineTableCell,
        CriticAddition,
        CriticDeletion,
        CriticComment,
        CriticHighlight,
        CriticPointMarkers,
        Collaboration.configure({ document: doc }),
        CollaborationCaret.configure({
          provider: { awareness },
          user,
          render: renderCaret,
        }),
        SuggestMode.configure({ docState }),
        KeyboardShortcuts.configure({ docState }),
        SuggestFormatting.configure({ docState }),
        SuggestStructureGuard.configure({ docState }),
        TitleBlock.configure(placeholders),
        CommentClickHandler,
        AppLinks,
        Attachment,
        CommentHighlight,
        ActiveCommentHighlight,
        CommentColors,
        MentionSuggestion.configure({ sources: mentions, docState, onQuery: onMentionQuery }),
        MentionHighlight.configure({ targets: mentionTargets }),
        SlashCommands.configure({ docState, actions: slashActions }),
      ],
      editorProps: {
        attributes: {
          class: "tiptap",
        },
        // Pasted plain text that looks like markdown parses to rich nodes —
        // matching the old model where all text was markdown source.
        handlePaste(view, event) {
          const html = event.clipboardData?.getData("text/html");
          if (html) return false;
          const text = event.clipboardData?.getData("text/plain");
          if (!text || !/[*_#>`~[\]]|\n|^-|\{[+\-=>]/m.test(text)) return false;
          const parsed = parseMarkdown(text);
          if (!parsed.ok) return false;
          const { state, dispatch } = view;
          const slice = parsed.doc.slice(0, parsed.doc.content.size);
          dispatch(state.tr.replaceSelection(slice).scrollIntoView());
          return true;
        },
      },
    },
    [doc, awareness],
  );

  // The tap handler's callback must follow the latest threads; extension
  // options were fixed when the editor was created.
  useEffect(() => {
    editor?.commands.setCommentClickHandler(onCommentClick ?? null);
  }, [editor, onCommentClick]);
  useEffect(() => {
    editor?.commands.setAppLinkHandler(onAppLink ?? null);
  }, [editor, onAppLink]);

  // Update the comment highlight decoration when the prop changes
  useEffect(() => {
    if (!editor) return;
    const range = commentHighlight ?? null;
    const prev = prevHighlightRef.current;
    if (range?.from === prev?.from && range?.to === prev?.to) return;
    prevHighlightRef.current = range;
    const tr = editor.state.tr.setMeta(commentHighlightKey, range);
    editor.view.dispatch(tr);
  }, [editor, commentHighlight]);

  // Update the active comment highlight when the prop changes
  useEffect(() => {
    if (!editor) return;
    const range = activeCommentRange ?? null;
    const prev = prevActiveRangeRef.current;
    if (range?.from === prev?.from && range?.to === prev?.to) return;
    prevActiveRangeRef.current = range;
    const tr = editor.state.tr.setMeta(activeCommentHighlightKey, range);
    editor.view.dispatch(tr);

    // Bring the highlighted phrase into view when a thread is selected —
    // smoothly, and only if it's off screen, so picking a visible comment
    // doesn't yank the text the reader is looking at. The dispatch above
    // renders the active decoration synchronously.
    if (range) {
      let el: Element | null = editor.view.dom.querySelector(".cm-comment-active");
      if (!el) {
        const pos = Math.min(range.from, editor.state.doc.content.size);
        const dom = editor.view.domAtPos(pos).node;
        el = dom instanceof HTMLElement ? dom : dom.parentElement;
      }
      if (el && !isComfortablyInView(el)) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [editor, activeCommentRange]);

  // Re-colour mentions when the set of known handles changes. The provider
  // updates the targets ref in its own effect, which runs after this one, so
  // the dispatch waits a frame.
  useEffect(() => {
    if (!editor) return;
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(mentionHighlightKey, true));
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, mentionTargetsKey]);

  // Push per-thread colours into the editor whenever they change.
  const prevColorsRef = useRef("");
  useEffect(() => {
    if (!editor) return;
    const ranges = commentColors ?? [];
    const key = JSON.stringify(ranges);
    if (key === prevColorsRef.current) return;
    prevColorsRef.current = key;
    editor.view.dispatch(editor.state.tr.setMeta(commentColorsKey, ranges));
  }, [editor, commentColors]);

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  const handleClick = useCallback(() => {
    if (editor && !editor.isFocused) {
      editor.commands.focus("end");
    }
  }, [editor]);

  // The document condenses into view once its content has arrived: the
  // editor is invisible until the first sync, then plays the reveal once.
  // Later re-syncs (waking from sleep) don't replay it, and the animation
  // class leaves afterwards so no `filter` lingers on the blocks.
  const [reveal, setReveal] = useState<"pending" | "running" | "done">("pending");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (yjs.synced) setReveal((r) => (r === "pending" ? "running" : r));
  }, [yjs.synced]);
  const revealClass = { pending: "opacity-0", running: "doc-reveal", done: "" }[reveal];

  if (!editor) {
    return null;
  }

  return (
    <>
      <div
        className={`min-h-full cursor-text ${hidden ? "hidden" : ""} ${revealClass}`}
        onClick={handleClick}
        onAnimationEnd={(e) => {
          // Blocks cascade in; the class leaves once the last one has landed.
          const block = e.target as HTMLElement;
          if (block.parentElement?.classList.contains("tiptap") && block === block.parentElement.lastElementChild) {
            setReveal("done");
          }
        }}
      >
        <div className="mx-auto w-full max-w-3xl">
          <EditorContent editor={editor} />
        </div>
      </div>
      {onNewComment && <BubbleToolbar editor={editor} onNewComment={onNewComment} />}
    </>
  );
}
