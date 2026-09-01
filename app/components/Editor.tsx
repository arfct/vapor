import { useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension, getMarkRange, type Editor as TiptapEditor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight, CriticPointMarkers } from "~/lib/critic-marks";
import { BlockId } from "~/lib/block-id";
import { CodeBlockCopy } from "~/lib/code-block-copy";
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

const CommentClickHandler = Extension.create<{
  onCommentClick?: (commentText: string) => void;
}>({
  name: "commentClickHandler",
  addOptions() {
    return { onCommentClick: undefined };
  },
  addProseMirrorPlugins() {
    const onCommentClick = this.options.onCommentClick;
    if (!onCommentClick) return [];
    return [
      new Plugin({
        props: {
          handleClick(view, pos) {
            const $pos = view.state.doc.resolve(pos);
            // Use nodeAt for reliable mark detection at boundaries (inclusive:false)
            const node = view.state.doc.nodeAt(pos);
            const marks = node?.isText ? node.marks : $pos.marks();

            // Direct click on comment text (or point marker at comment boundary)
            const commentMark = marks.find((m) => m.type.name === "criticComment");
            if (commentMark) {
              if (node?.isText) {
                onCommentClick(node.text ?? "");
              }
              return true;
            }

            // Click on highlighted text → find adjacent comment
            const highlightMark = marks.find((m) => m.type.name === "criticHighlight");
            if (highlightMark) {
              const highlightType = view.state.schema.marks.criticHighlight;
              const commentType = view.state.schema.marks.criticComment;
              if (highlightType && commentType) {
                const hlRange = getMarkRange($pos, highlightType);
                if (hlRange) {
                  const $afterHl = view.state.doc.resolve(hlRange.to);
                  const cmRange = getMarkRange($afterHl, commentType);
                  if (cmRange) {
                    const text = view.state.doc.textBetween(cmRange.from, cmRange.to);
                    onCommentClick(text);
                    return true;
                  }
                }
              }
            }

            return false;
          },
        },
      }),
    ];
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
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, {
                class: "cm-comment-active",
              }),
            ]);
          },
        },
      }),
    ];
  },
});

type YjsEditorState = ReturnType<typeof useYjsEditor>;

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
  onEditorReady,
  onCommentClick,
  commentHighlight,
  activeCommentRange,
  onNewComment,
  onResolveAtCursor,
  onDeleteAtCursor,
}: {
  yjs: YjsEditorState;
  hidden?: boolean;
  onEditorReady?: (editor: TiptapEditor) => void;
  onCommentClick?: (commentText: string) => void;
  commentHighlight?: { from: number; to: number } | null;
  activeCommentRange?: { from: number; to: number } | null;
  onNewComment?: () => void;
  onResolveAtCursor?: () => void;
  onDeleteAtCursor?: () => void;
}) {
  const { doc, awareness, user, docState } = yjs;
  const prevHighlightRef = useRef<{ from: number; to: number } | null>(null);
  const prevActiveRangeRef = useRef<{ from: number; to: number } | null>(null);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          // Collaboration owns history; underline has no markdown form
          // (see the markdown-completeness rule in the WYSIWYG plan).
          undoRedo: false,
          underline: false,
          heading: { levels: [1, 2, 3] },
          link: {
            openOnClick: false,
            autolink: true,
            linkOnPaste: true,
          },
        }),
        BlockId,
        CodeBlockCopy,
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
        CommentClickHandler.configure({ onCommentClick }),
        CommentHighlight,
        ActiveCommentHighlight,
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

    // Bring the highlighted phrase into view when a thread is selected.
    // The dispatch above renders the active decoration synchronously.
    if (range) {
      let el: Element | null = editor.view.dom.querySelector(".cm-comment-active");
      if (!el) {
        const pos = Math.min(range.from, editor.state.doc.content.size);
        const dom = editor.view.domAtPos(pos).node;
        el = dom instanceof HTMLElement ? dom : dom.parentElement;
      }
      el?.scrollIntoView({ block: "center" });
    }
  }, [editor, activeCommentRange]);

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

  if (!editor) {
    return null;
  }

  return (
    <>
      <div
        className={`min-h-full cursor-text ${hidden ? "hidden" : ""}`}
        onClick={handleClick}
      >
        <div className="mx-auto w-full max-w-3xl">
          <EditorContent editor={editor} />
        </div>
      </div>
      {onNewComment && onResolveAtCursor && onDeleteAtCursor && (
        <BubbleToolbar
          editor={editor}
          onNewComment={onNewComment}
          onResolveAtCursor={onResolveAtCursor}
          onDeleteAtCursor={onDeleteAtCursor}
        />
      )}
    </>
  );
}
