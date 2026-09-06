import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { getMarkRange, type Editor as TiptapEditor } from "@tiptap/core";
import type { CapturedSelection, CommentColorRange, DocMode } from "~/shared/types";
import type { MatchedThread } from "~/lib/comment-threads";
import type { YjsEditorState } from "~/lib/useYjsEditor";
import { useThreads } from "~/lib/useThreads";
import { serializePmDoc } from "~/shared/rich-markdown";

export interface DocumentContextValue {
  docId: string;
  createdAt: number | null;
  yjs: YjsEditorState;
  editorInstance: TiptapEditor | null;
  markdown: string;

  // Mode
  mode: DocMode;
  setMode: (mode: DocMode) => void;
  toggleMode: () => void;

  // Preview
  showPreview: boolean;
  togglePreview: () => void;
  setPreviewHeld: (held: boolean) => void;

  // Comments
  commentActive: boolean;
  commentSelection: CapturedSelection | null;
  commentHighlight: { from: number; to: number } | null;
  openCommentInput: () => void;
  handleCommentActiveChange: (active: boolean) => void;
  activateComment: (commentText: string) => void;

  // Threads
  threads: MatchedThread[];
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  activeCommentRange: { from: number; to: number } | null;
  /** Every thread's range in the document with its author's colour. */
  commentColors: CommentColorRange[];
  addReply: (threadId: string, text: string) => void;
  resolveThread: (threadId: string) => void;
  deleteThread: (threadId: string) => void;

  // Editor lifecycle
  handleEditorReady: (editor: TiptapEditor) => void;
  handleCommentClick: (commentText: string) => void;

  // Version history
  /**
   * Ask the server for a version before a client-side bulk action it could
   * not otherwise tell from typing (Accept all / Reject all). Sent on the
   * document socket ahead of the action's own sync update.
   */
  requestSnapshot: (reason: "pre_accept_all") => void;
}

// Named _DocumentContext so test helpers can provide mock values directly
export const _DocumentContext = createContext<DocumentContextValue | null>(null);

export function useDocument(): DocumentContextValue {
  const ctx = useContext(_DocumentContext);
  if (!ctx) {
    throw new Error("useDocument must be used within a DocumentProvider");
  }
  return ctx;
}

export function DocumentProvider({
  docId,
  createdAt,
  yjs,
  children,
}: {
  docId: string;
  createdAt: number | null;
  yjs: YjsEditorState;
  children: React.ReactNode;
}) {
  const [markdown, setMarkdown] = useState("");
  const [editorInstance, setEditorInstance] = useState<TiptapEditor | null>(null);
  const [previewToggled, setPreviewToggled] = useState(false);
  const [previewHeld, setPreviewHeld] = useState(false);
  const [commentActive, setCommentActive] = useState(false);
  const [commentSelection, setCommentSelection] = useState<CapturedSelection | null>(null);
  const [commentHighlight, setCommentHighlight] = useState<{ from: number; to: number } | null>(null);

  const showPreview = previewToggled || previewHeld;

  const {
    threads,
    activateComment,
    addReply,
    resolveThread,
    deleteThread,
    activeThreadId,
    setActiveThreadId,
  } = useThreads({ doc: yjs.doc, editor: editorInstance, user: yjs.user });

  const toggleMode = useCallback(() => {
    yjs.setMode(yjs.mode === "edit" ? "suggest" : "edit");
  }, [yjs]);

  const togglePreview = useCallback(() => {
    setPreviewToggled((v) => !v);
  }, []);

  const handleEditorReady = useCallback((editor: TiptapEditor) => {
    setEditorInstance(editor);
    const update = () => setMarkdown(serializePmDoc(editor.state.doc));
    update();
    editor.on("update", update);
  }, []);

  // Always selects, never toggles: with a mouse the selection handler in
  // useThreads has already activated this thread by the time the click
  // lands, so a toggle would close what the press just opened.
  const handleCommentClick = useCallback(
    (commentText: string) => {
      const match = threads.find((t) => t.commentText === commentText);
      if (match) setActiveThreadId(match.id);
    },
    [threads, setActiveThreadId],
  );

  const openCommentInput = useCallback(() => {
    if (editorInstance) {
      const { from, to, empty } = editorInstance.state.selection;
      if (!empty) {
        const text = editorInstance.state.doc.textBetween(from, to);
        setCommentSelection({ from, to, text });
        setCommentHighlight({ from, to });
      } else {
        setCommentSelection(null);
        setCommentHighlight(null);
      }
    }
    setCommentActive(true);
  }, [editorInstance]);

  const handleCommentActiveChange = useCallback(
    (active: boolean) => {
      if (active) {
        openCommentInput();
      } else {
        setCommentActive(false);
        setCommentSelection(null);
        setCommentHighlight(null);
      }
    },
    [openCommentInput],
  );

  const activeCommentRange = useMemo(() => {
    if (!activeThreadId) return null;
    const thread = threads.find((t) => t.id === activeThreadId);
    if (!thread?.position || !thread.endPosition) return null;

    let from = thread.position;
    const to = thread.endPosition;

    // Expand range to include preceding highlight if present
    if (editorInstance && thread.highlightText && from > 0) {
      const highlightType = editorInstance.schema.marks.criticHighlight;
      if (highlightType) {
        const $pos = editorInstance.state.doc.resolve(from - 1);
        const hlRange = getMarkRange($pos, highlightType);
        if (hlRange && hlRange.to === from) {
          from = hlRange.from;
        }
      }
    }

    return { from, to };
  }, [activeThreadId, threads, editorInstance]);

  const commentColors = useMemo<CommentColorRange[]>(() => {
    const highlightType = editorInstance?.schema.marks.criticHighlight;
    const ranges: CommentColorRange[] = [];
    for (const thread of threads) {
      if (!thread.position || !thread.endPosition) continue;
      let from = thread.position;
      if (editorInstance && highlightType && thread.highlightText && from > 0) {
        const $pos = editorInstance.state.doc.resolve(Math.min(from - 1, editorInstance.state.doc.content.size));
        const hlRange = getMarkRange($pos, highlightType);
        if (hlRange && hlRange.to === from) from = hlRange.from;
      }
      ranges.push({ from, to: thread.endPosition, color: thread.author.color });
    }
    return ranges;
  }, [threads, editorInstance]);

  const requestSnapshot = useCallback(
    (reason: "pre_accept_all") => {
      const socket = yjs.socket as unknown as { readyState: number; send?: (data: string) => void } | null;
      if (socket?.readyState === WebSocket.OPEN) socket.send?.(JSON.stringify({ type: "snapshot", reason }));
    },
    [yjs.socket],
  );

  const value: DocumentContextValue = {
    docId,
    createdAt,
    yjs,
    editorInstance,
    markdown,
    mode: yjs.mode,
    setMode: yjs.setMode,
    toggleMode,
    showPreview,
    togglePreview,
    setPreviewHeld,
    commentActive,
    commentSelection,
    commentHighlight,
    openCommentInput,
    handleCommentActiveChange,
    activateComment,
    threads,
    activeThreadId,
    setActiveThreadId,
    activeCommentRange,
    commentColors,
    addReply,
    resolveThread,
    deleteThread,
    handleEditorReady,
    handleCommentClick,
    requestSnapshot,
  };

  return (
    <_DocumentContext.Provider value={value}>
      {children}
    </_DocumentContext.Provider>
  );
}
