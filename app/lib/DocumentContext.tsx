import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { getMarkRange, type Editor as TiptapEditor } from "@tiptap/core";
import type { CapturedSelection, CommentColorRange, DocMode } from "~/shared/types";
import type { MatchedThread } from "~/lib/comment-threads";
import type { YjsEditorState } from "~/lib/useYjsEditor";
import { useThreads } from "~/lib/useThreads";
import { usePeople } from "~/lib/usePeople";
import type { Person } from "~/lib/people";
import { serializePmDoc } from "~/shared/rich-markdown";
import { isValidDocumentId } from "~/shared/constants";
import { rankMentionItems, type AgentRosterEntry, type MentionSources } from "~/shared/agent-protocol";
import type { MentionSourceRef } from "~/lib/mention-suggestion";
import type { MentionTargetsRef } from "~/lib/mention-highlight";
import type { SlashActionsRef } from "~/lib/slash-commands";

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

  // Mentions and slash commands
  /** Everyone else on the document (connected, commented, viewed). */
  people: Person[];
  /** Agents enrolled on the document; refreshed on demand. */
  roster: AgentRosterEntry[];
  /** What the `@` popup completes against; a ref so the editor reads it live. */
  mentionSources: MentionSourceRef;
  /** Known handles and their colours, for the in-text mention highlight. */
  mentionTargets: MentionTargetsRef;
  /** Changes whenever `mentionTargets` does, so the editor can re-decorate. */
  mentionTargetsKey: string;
  /** Actions the `/` menu delegates to the layout. */
  slashActions: SlashActionsRef;
  /** Re-fetch the roster (rate-limited); the `@` popup calls it when it opens. */
  refreshRoster: () => void;

  // Version history
  /**
   * Ask the server for a version before a client-side bulk action it could
   * not otherwise tell from typing (Accept all / Reject all). Sent on the
   * document socket ahead of the action's own sync update.
   */
  requestSnapshot: (reason: "pre_accept_all") => void;
}

const ROSTER_TTL_MS = 30_000;

/** Every handle the popup would insert, with the colour its owner draws in. */
export function mentionTargetsFor(sources: MentionSources): Map<string, string> {
  const targets = new Map<string, string>();
  for (const item of rankMentionItems("", sources, Number.POSITIVE_INFINITY)) {
    if (item.color) targets.set(item.handle, item.color);
  }
  return targets;
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

  // Who can be mentioned: the roster (fetched, cached briefly) plus the
  // people already tracked for the face pile. Refs feed the editor
  // extensions, whose options are fixed at creation.
  const people = usePeople(yjs, threads);
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const rosterFetchedAt = useRef(0);
  const refreshRoster = useCallback(() => {
    if (!isValidDocumentId(docId)) return;
    const now = Date.now();
    if (now - rosterFetchedAt.current < ROSTER_TTL_MS) return;
    rosterFetchedAt.current = now;
    fetch(`/${docId}/agents`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRoster(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [docId]);
  useEffect(() => {
    refreshRoster();
  }, [refreshRoster]);

  const sources = useMemo<MentionSources>(
    () => ({
      agents: roster.map((a) => ({ name: a.name, label: a.label, color: a.color })),
      people: people.map((p) => ({
        name: p.user.name,
        color: p.user.color,
        id: p.user.id,
        avatar: p.user.avatar,
        animal: p.user.animal,
        isAgent: p.isAgent,
      })),
    }),
    [roster, people],
  );
  // Stable boxes the editor extensions hold; their contents follow state
  // from effects, which is soon enough (the popup reads them when it opens).
  const mentionSourcesRef = useRef<MentionSources>(sources);
  useEffect(() => {
    mentionSourcesRef.current = sources;
  }, [sources]);

  const targets = useMemo(() => mentionTargetsFor(sources), [sources]);
  const mentionTargetsRef = useRef(targets);
  useEffect(() => {
    mentionTargetsRef.current = targets;
  }, [targets]);
  const mentionTargetsKey = useMemo(() => [...targets.entries()].map(([h, c]) => `${h}:${c}`).join("|"), [targets]);

  const slashActionsRef = useRef<SlashActionsRef["current"]>({});
  useEffect(() => {
    slashActionsRef.current = { comment: openCommentInput };
  }, [openCommentInput]);

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
    people,
    roster,
    mentionSources: mentionSourcesRef,
    mentionTargets: mentionTargetsRef,
    mentionTargetsKey,
    slashActions: slashActionsRef,
    refreshRoster,
    requestSnapshot,
  };

  return (
    <_DocumentContext.Provider value={value}>
      {children}
    </_DocumentContext.Provider>
  );
}
