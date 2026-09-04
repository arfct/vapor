import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Link, useNavigate, useLocation } from "react-router";
import { useDocument } from "~/lib/DocumentContext";
import { deserializeThreads } from "~/lib/thread-serialization";
import { generateDocumentId } from "~/shared/constants";
import { formatRemainingTime } from "~/lib/format-remaining";
import { placeholderPreset } from "~/lib/placeholder-presets";
import type { ThreadData } from "~/shared/types";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import ShareButton from "~/components/ShareButton";
import AgentsPanel from "~/components/AgentsPanel";
import ModeMenu from "~/components/ModeMenu";
import FormatToolbar from "~/components/FormatToolbar";
import ConnectionStatus from "~/components/ConnectionStatus";
import HeaderMenu from "~/components/HeaderMenu";
import FacePile from "~/components/FacePile";
import CommentRail from "~/components/CommentRail";
import CommentSheet from "~/components/CommentSheet";
import Icon from "~/components/Icon";
import { Menu, MenuTrigger, MenuContent, MenuItem, type MenuSide } from "~/components/ui/menu";

/**
 * The two places a vapor editor appears. A "doc" lives at /:id behind a
 * DocumentAgent; "home" is the standalone tour on the homepage — same
 * editor and rail, no id, no connection, and New document / Drop an .md
 * file in the header instead of the id and expiry.
 */
export type Surface =
  | { kind: "doc"; id: string; createdAt: number | null }
  | { kind: "home"; fallbackMarkdown: string };

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
  const mainRef = useRef<HTMLElement>(null);
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
  const openThreads = threads.filter((t) => !t.resolved).length;
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

  // With text selected the header button means "comment on this": iOS's
  // own edit menu covers the bubble menu, so this is the reliable path.
  const toggleComments = useCallback(() => {
    const selection = editorInstance?.state.selection;
    if (selection && !selection.empty) {
      openCommentInput();
      return;
    }
    setCommentsOpen((v) => !v);
  }, [editorInstance, openCommentInput]);

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

  const shareButton = (menuSide?: MenuSide) =>
    isHome ? (
      <ShareButton copyLink={false} menuSide={menuSide} />
    ) : (
      <ShareButton onOpenAgents={() => setAgentsOpen(true)} menuSide={menuSide} />
    );

  const createMenu = (menuSide?: MenuSide) => (
    <Menu>
      <MenuTrigger>
        <button aria-label="Create" title="Create" className="header-button">
          <Icon name="add" />
        </button>
      </MenuTrigger>
      <MenuContent side={menuSide}>
        <MenuItem className="gap-2" onClick={createBlankDocument}>
          <Icon name="note_add" />
          <span>New document</span>
        </MenuItem>
        <MenuItem className="gap-2" onClick={() => fileInputRef.current?.click()}>
          <Icon name="upload_file" />
          <span>Upload .md file</span>
        </MenuItem>
      </MenuContent>
    </Menu>
  );

  return (
    <div
      className="relative flex h-[100dvh] flex-col pt-[env(safe-area-inset-top)]"
      onDrop={handleDrop}
      onDragOver={isHome ? (e) => e.preventDefault() : undefined}
    >
      {/* Phones: a horizontal header. */}
      <header className="flex h-[60px] shrink-0 items-stretch overflow-hidden border-y border-border md:hidden">
        <Link
          to="/"
          className="flex shrink-0 items-center px-4 font-medium tracking-wider text-ink transition-colors hover:bg-border"
        >
          vapor
        </Link>
        <div className="shrink-0">
          <ModeMenu />
        </div>
        <div className="shrink-0">{shareButton()}</div>
        <div className="shrink-0">
          <FormatToolbar />
        </div>
        {isHome && <div className="shrink-0">{createMenu()}</div>}
        <div className="grow" />
        <button
          onClick={toggleComments}
          aria-label={commentsOpen ? "Hide comments" : "Show comments"}
          aria-pressed={commentsOpen}
          title={commentsOpen ? "Hide comments" : "Show comments"}
          className={`header-button relative ${commentsOpen ? "text-ink" : "text-muted"}`}
        >
          <span className="relative flex items-center justify-center">
            <Icon name="mode_comment" />
            {openThreads > 0 && (
              <span className="absolute inset-0 flex items-center justify-center pb-[3px] text-[9px] font-bold leading-none">
                {openThreads}
              </span>
            )}
          </span>
        </button>
        <HeaderMenu />
      </header>

      {/* Desktop: a 60px rail down the left — wordmark, then Edit, Format,
          Share (menus open to the right), and the expiry at the foot. */}
      <nav
        className="side-rail absolute inset-y-0 left-0 z-20 hidden w-[60px] flex-col items-center md:flex"
        aria-label="Document tools"
      >
        <Link
          to="/"
          className="vertical-text flex h-[100px] w-full items-center justify-center font-medium uppercase tracking-widest text-ink transition-colors hover:bg-border"
        >
          vapor
        </Link>
        <ModeMenu menuSide="right" />
        <FormatToolbar menuSide="right" />
        {shareButton("right")}
        {isHome && createMenu("right")}
        <div className="grow" />
        {surface.kind === "doc" && (
          <div className="flex flex-col items-center gap-3 pb-5">
            <ConnectionStatus compact />
            {surface.createdAt && (
              <span
                className="vertical-text text-xs font-medium uppercase tracking-widest text-muted"
                title={`${surface.id} vaporizes in ${formatRemainingTime(surface.createdAt)}`}
              >
                {formatRemainingTime(surface.createdAt)} left
              </span>
            )}
          </div>
        )}
      </nav>

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
      {/* One scroller for document and comments, so the rail's cards ride
          along with the text they annotate. */}
      <main ref={mainRef} className="flex-1 overflow-y-auto md:pl-[60px]">
        <div className="flex min-h-full items-start">
          <div className="min-w-0 flex-1">
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
          <aside className="relative hidden w-[280px] shrink-0 md:block">
            {/* Who's here, with you at the far right: part of the page, so
                it scrolls off with the top of the document. Above the
                rail's card layer so it stays clickable. */}
            <div className="absolute right-2 top-0 z-10 flex h-[60px] items-center">
              <FacePile alsoOnline={demoPresence} />
              <HeaderMenu compact />
            </div>
            <CommentRail scrollRef={mainRef} />
          </aside>
        </div>
      </main>
      {/* Only where the sheet is the comments UI: mounted on desktop it
          would auto-select the first thread and pin it in the rail. */}
      <CommentSheet open={commentsOpen && mounted && !wide} onClose={() => setCommentsOpen(false)} />
    </div>
  );
}
