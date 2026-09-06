import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MentionSuggestion, type MentionSourceRef } from "~/lib/mention-suggestion";
import { Mention } from "~/lib/mention";

/** Enter sends, Escape cancels; the mention popup, at higher priority, sees both first while open. */
const SubmitKeys = Extension.create<{ onSubmit: (editor: Editor) => void; onCancel: () => void }>({
  name: "submitKeys",
  priority: 1000,
  addOptions() {
    return { onSubmit: () => {}, onCancel: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        this.options.onSubmit(editor);
        return true;
      },
      Escape: () => {
        this.options.onCancel();
        return true;
      },
    };
  },
});

/** Sends the typed text (if any) and clears the box. */
function submitFrom(editor: Editor, onSubmit: (text: string) => void): void {
  const text = editor.getText().trim();
  if (!text) return;
  editor.commands.clearContent();
  onSubmit(text);
}

export interface CommentEditorHandle {
  /** Submit whatever is typed, as Enter would. */
  submit: () => void;
  focus: () => void;
}

/**
 * A one-paragraph TipTap editor for comments and replies, so `@` completes
 * there exactly as it does in the body. Output is plain text (a mention is
 * text), so thread storage and serialization are unchanged.
 */
const CommentEditor = forwardRef<
  CommentEditorHandle,
  {
    placeholder: string;
    onSubmit: (text: string) => void;
    onCancel: () => void;
    onBlur?: (text: string) => void;
    autoFocus?: boolean;
    mentions: MentionSourceRef | null;
    className?: string;
  }
>(function CommentEditor({ placeholder, onSubmit, onCancel, onBlur, autoFocus = false, mentions, className = "" }, ref) {
  const [empty, setEmpty] = useState(true);
  const onSubmitRef = useRef(onSubmit);
  const onCancelRef = useRef(onCancel);
  const onBlurRef = useRef(onBlur);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
    onCancelRef.current = onCancel;
    onBlurRef.current = onBlur;
  }, [onSubmit, onCancel, onBlur]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        underline: false,
        undoRedo: false,
        trailingNode: false,
      }),
      // A completed mention is a node here too, so the popup's insertion has
      // somewhere to land; getText renders it back as its token.
      Mention.configure({ targets: null }),
      MentionSuggestion.configure({ sources: mentions, docState: null }),
      // Handlers reach the latest props through refs: extension options are
      // fixed when the editor is created, before the first render has one.
      SubmitKeys.configure({
        onSubmit: (e) => submitFrom(e, (text) => onSubmitRef.current(text)),
        onCancel: () => onCancelRef.current(),
      }),
    ],
    editorProps: {
      attributes: {
        class: "comment-editor",
        role: "textbox",
        "aria-label": placeholder,
        enterkeyhint: "send",
      },
    },
    onUpdate: ({ editor: e }) => setEmpty(e.isEmpty),
    onBlur: ({ editor: e }) => onBlurRef.current?.(e.getText().trim()),
  });

  useImperativeHandle(ref, () => ({
    submit: () => {
      if (editor) submitFrom(editor, onSubmit);
    },
    focus: () => editor?.commands.focus("end", { scrollIntoView: false }),
  }));

  // Same rule as the old input: no scroll on focus, the box is already
  // placed beside its selection.
  useEffect(() => {
    if (editor && autoFocus) editor.commands.focus("end", { scrollIntoView: false });
  }, [editor, autoFocus]);

  return (
    <div className={`relative ${className}`}>
      {empty && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-muted">
          {placeholder}
        </span>
      )}
      <EditorContent editor={editor} />
    </div>
  );
});

export default CommentEditor;
