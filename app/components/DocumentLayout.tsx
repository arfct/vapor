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
import { Menu, MenuTrigger, MenuContent, MenuItem } from "~/components/ui/menu";

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
    const query = window.matchMedia("(min-width: 1024px)");
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
  // On desktop the header's bottom rule appears only once the document
  // has scrolled up under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onScroll = () => setScrolled(main.scrollTop > 110);
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, []);
  const openThreads = threads.filter((t) => !t.resolved).length;
  const isHome = surface.kind === "home";
  // The tour's cast is fictional; showing them as present makes the pile
  // demonstrate what it's for instead of listing people who left days ago.
  const demoPresence = useMemo(
    () => (isHome ? threads.flatMap((t) => [t.author, ...t.replies.map((r) => r.author)]) : undefined),
    [isHome, threads],
  );

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

  return (
    <div
      className="flex h-[100dvh] flex-col pt-[env(safe-area-inset-top)]"
      onDrop={handleDrop}
      onDragOver={isHome ? (e) => e.preventDefault() : undefined}
    >
      <header
        className={`doc-header relative flex h-[60px] shrink-0 items-stretch overflow-hidden border-y border-border transition-colors lg:border-t-0 ${
          scrolled ? "" : "lg:border-b-transparent"
        }`}
      >
        <Link
          to="/"
          className="doc-wordmark flex shrink-0 items-center px-4 font-medium uppercase tracking-wider text-ink transition-colors hover:bg-border lg:absolute lg:inset-y-0 lg:left-0"
        >
          vapor
        </Link>
        {/* This cell mirrors <main>, so on desktop the controls can start
            where the document text starts — same column width and centering. */}
        <div className="flex min-w-0 flex-1 items-stretch">
          <div className="toolbar-inset flex min-w-0 flex-1 items-stretch">
            <div className="shrink-0">
              <ModeMenu />
            </div>
            <div className="shrink-0">
              {isHome ? (
                <ShareButton copyLink={false} />
              ) : (
                <ShareButton onOpenAgents={() => setAgentsOpen(true)} />
              )}
            </div>
            <div className="shrink-0">
              <FormatToolbar />
            </div>
            {surface.kind === "doc" ? (
              // The one cell allowed to shrink: the id and expiry truncate so
              // the controls on the right stay put.
              <div className="hidden min-w-0 shrink items-center px-3 lg:flex">
                <span className="mr-2 shrink-0">
                  <ConnectionStatus compact />
                </span>
                <span className="min-w-0 truncate">
                  <span className="font-mono font-bold">{surface.id}</span>
                  {surface.createdAt && (
                    <span className="ml-2 text-muted">
                      vaporized in {formatRemainingTime(surface.createdAt)}
                    </span>
                  )}
                </span>
              </div>
            ) : (
              <>
                <div className="shrink-0">
                  <Menu>
                    <MenuTrigger>
                      <button
                        aria-label="Create"
                        title="Create"
                        className="header-button"
                      >
                        <Icon name="add" />
                      </button>
                    </MenuTrigger>
                    <MenuContent>
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
              </>
            )}
          </div>
        </div>
        {/* Mirrors the comments rail's width so the middle cell matches <main>. */}
        <div className={`flex shrink-0 items-stretch justify-end ${commentsOpen ? "lg:w-[280px]" : ""}`}>
          <button
            onClick={toggleComments}
            aria-label={commentsOpen ? "Hide comments" : "Show comments"}
            aria-pressed={commentsOpen}
            title={commentsOpen ? "Hide comments" : "Show comments"}
            className={`header-button relative ${commentsOpen ? "text-ink" : "text-muted"}`}
          >
            <Icon name="comment" />
            {openThreads > 0 && (
              <span className="absolute right-1.5 top-1.5 min-w-[16px] rounded-full bg-ink px-1 text-center text-[10px] font-bold leading-4 text-paper">
                {openThreads}
              </span>
            )}
          </button>
          <FacePile alsoOnline={demoPresence} />
          <HeaderMenu />
        </div>
      </header>
      {surface.kind === "doc" && (
        <AgentsPanel open={agentsOpen} onClose={() => setAgentsOpen(false)} />
      )}
      {/* One scroller for document and comments, so the rail's cards ride
          along with the text they annotate. */}
      <main ref={mainRef} className="flex-1 overflow-y-auto">
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
          {commentsOpen && (
            <aside className="hidden w-[280px] shrink-0 lg:block">
              <CommentRail scrollRef={mainRef} />
            </aside>
          )}
        </div>
      </main>
      {/* Only where the sheet is the comments UI: mounted on desktop it
          would auto-select the first thread and pin it in the rail. */}
      <CommentSheet open={commentsOpen && mounted && !wide} onClose={() => setCommentsOpen(false)} />
    </div>
  );
}
