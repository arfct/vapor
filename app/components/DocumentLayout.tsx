import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router";
import { useDocument } from "~/lib/DocumentContext";
import { deserializeThreads } from "~/lib/thread-serialization";
import { generateDocumentId } from "~/shared/constants";
import { placeholderPreset } from "~/lib/placeholder-presets";
import { useVisualViewportFrame } from "~/lib/useVisualViewportFrame";
import type { ThreadData } from "~/shared/types";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import ShareButton from "~/components/ShareButton";
import CreateMenu from "~/components/CreateMenu";
import AgentsPanel from "~/components/AgentsPanel";
import FormatToolbar from "~/components/FormatToolbar";
import HeaderMenu from "~/components/HeaderMenu";
import FacePile from "~/components/FacePile";
import CommentRail from "~/components/CommentRail";
import CommentSheet from "~/components/CommentSheet";

/**
 * The two places a vapor editor appears. A "doc" lives at /:id behind a
 * DocumentAgent; "home" is the standalone tour on the homepage — same
 * editor and rail, no id, no connection, no expiry, and Drop an .md file.
 */
export type Surface =
  | { kind: "doc"; id: string; createdAt: number | null }
  | { kind: "home"; fallbackMarkdown: string };

const HEADER_STROKE_SCROLL_PX = 100;

async function createDocument(content: string, threads: ThreadData[]): Promise<string> {
  const id = generateDocumentId();
  await fetch(`/agents/document-agent/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, threads }),
  });
  return id;
}

export default function DocumentLayout({ surface }: { surface: Surface }) {
  const {
    yjs,
    editorInstance,
    threads,
    activeThreadId,
    showPreview,
    handleEditorReady,
    handleCommentClick,
    commentHighlight,
    activeCommentRange,
    commentColors,
    openCommentInput,
    commentActive,
    handleResolveAtCursor,
    handleDeleteAtCursor,
  } = useDocument();
  const navigate = useNavigate();
  // A document the visitor just created gets focus so they can type at once.
  const fresh = Boolean((useLocation().state as { fresh?: boolean } | null)?.fresh);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const railRef = useRef<HTMLElement>(null);
  // The comment sheet sits on a fixed layer pinned to the visual viewport,
  // so it stays above the keyboard while iOS pans for it.
  const chromeRef = useRef<HTMLDivElement>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);
  useVisualViewportFrame(chromeRef, setKeyboardUp);
  const [agentsOpen, setAgentsOpen] = useState(false);
  // One comments panel, two presentations: a rail beside the document at
  // lg and up, a full-height sheet over it below. Open by default only where
  // the rail fits; the sheet renders client-side so narrow SSR shows nothing.
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCommentsOpen(query.matches);
    setWide(query.matches);
    setMounted(true);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  // Tapping a highlight opens its thread, and starting a comment opens the
  // input, wherever the panel lives — the sheet is closed by default.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeThreadId || commentActive) setCommentsOpen(true);
  }, [activeThreadId, commentActive]);
  // ⌘⌥M (Ctrl+Alt+M elsewhere) starts a comment. Lives here, not in the
  // comment box, which only mounts once a comment is open. Compare the
  // physical key: with Option held, macOS reports e.key as "µ".
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === "KeyM") {
        e.preventDefault();
        openCommentInput();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openCommentInput]);
  const isHome = surface.kind === "home";
  // The tour's cast is fictional; those who wrote within a day of the
  // newest comment count as present so the pile demonstrates what it's
  // for, while the older commenter reads as idle.
  const demoPresence = useMemo(() => {
    if (!isHome) return undefined;
    const comments = threads.flatMap((t) => [t, ...t.replies]);
    const newest = Math.max(0, ...comments.map((c) => c.createdAt));
    const since = newest - 24 * 60 * 60 * 1000;
    return comments.filter((c) => c.createdAt > since).map((c) => c.author);
  }, [isHome, threads]);

  const toggleComments = useCallback(() => setCommentsOpen((v) => !v), []);
  const inviteAgent = surface.kind === "doc" ? () => setAgentsOpen(true) : undefined;
  const pickFile = () => fileInputRef.current?.click();

  // A new document starts empty; the tour stays on the homepage.
  const createBlankDocument = useCallback(async () => {
    navigate(`/${await createDocument("", [])}`, { state: { fresh: true } });
  }, [navigate]);

  const uploadFile = useCallback(
    async (file: File) => {
      const { body, threads: imported } = deserializeThreads(await file.text());
      navigate(`/${await createDocument(body, imported)}`, { state: { fresh: true } });
    },
    [navigate],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!isHome) return;
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".md")) uploadFile(file);
    },
    [isHome, uploadFile],
  );

  // The header's bottom stroke appears only once the document has scrolled
  // under it; at the top the page reads as one surface.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > HEADER_STROKE_SCROLL_PX);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div onDrop={handleDrop} onDragOver={isHome ? (e) => e.preventDefault() : undefined}>
      {/* One header at every width: Format, Share (Create on the tour),
          who's here (desktop), and the menu, right-aligned. Sticky, not
          fixed: the scroll engine holds it steady while mobile Safari's
          toolbar collapses, where a script-positioned layer lags a frame. */}
      <header
        className={`sticky top-0 z-30 flex h-[60px] items-center justify-end gap-[6px] overflow-hidden border-b bg-paper p-[6px] pt-[calc(6px+env(safe-area-inset-top))] transition-colors ${
          scrolled ? "border-border" : "border-transparent"
        }`}
      >
        <FormatToolbar />
        {/* The tour has nothing to share; Create takes Share's place there
            and its rows leave the menu so they aren't offered twice. */}
        {isHome ? (
          <CreateMenu onNewDocument={createBlankDocument} onUpload={pickFile} />
        ) : (
          <ShareButton onInviteAgent={inviteAgent} />
        )}
        <FacePile alsoOnline={demoPresence} />
        <HeaderMenu
          comments={wide ? undefined : { open: commentsOpen, onToggle: toggleComments }}
          onNewDocument={isHome ? undefined : createBlankDocument}
          onUpload={isHome ? undefined : pickFile}
        />
      </header>
      {/* The comment sheet rides a fixed layer pinned to the visual viewport,
          so it sits above the keyboard on iOS. Only where the sheet is the
          comments UI: mounted on desktop it would auto-select the first
          thread and pin it in the rail. */}
      <div ref={chromeRef} className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[100dvh]">
        <CommentSheet
          open={commentsOpen && mounted && !wide}
          onClose={() => setCommentsOpen(false)}
          keyboardUp={keyboardUp}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadFile(file);
        }}
        className="hidden"
      />

      {surface.kind === "doc" && (
        <AgentsPanel open={agentsOpen} onClose={() => setAgentsOpen(false)} />
      )}
      {/* The page itself scrolls, so mobile browsers collapse their toolbar
          and let the text run under it. Half a screen at the foot so the end
          of the document can scroll clear of the keyboard. */}
      <main className="pb-[50dvh]">
        <div className="flex items-start">
          {/* `tour` scopes the demo document's own styling (app.css). */}
          <div className={isHome ? "tour min-w-0 flex-1" : "min-w-0 flex-1"}>
            {/* Server-rendered stand-in until TipTap mounts: keeps the tour's copy indexable. */}
            {isHome && !editorInstance && (
              <pre className="mx-auto w-full max-w-3xl whitespace-pre-wrap p-6 font-sans text-base leading-relaxed text-ink">
                {surface.fallbackMarkdown}
              </pre>
            )}
            <Editor
              yjs={yjs}
              autofocus={surface.kind === "doc" && fresh}
              placeholders={surface.kind === "doc" ? placeholderPreset(surface.id) : undefined}
              hidden={showPreview}
              onEditorReady={handleEditorReady}
              onCommentClick={handleCommentClick}
              commentHighlight={commentHighlight}
              activeCommentRange={activeCommentRange}
              commentColors={commentColors}
              onNewComment={openCommentInput}
              onResolveAtCursor={handleResolveAtCursor}
              onDeleteAtCursor={handleDeleteAtCursor}
            />
            {showPreview && <Preview />}
          </div>
          <aside ref={railRef} className="relative hidden w-[280px] shrink-0 md:block">
            <CommentRail originRef={railRef} />
          </aside>
        </div>
      </main>
    </div>
  );
}
