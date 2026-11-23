import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router";
import { useDocument } from "~/lib/DocumentContext";
import { deserializeThreads } from "~/lib/thread-serialization";
import { generateDocumentId } from "~/shared/constants";
import { documentPath, titleFromMarkdown } from "~/shared/doc-url";
import { placeholderPreset } from "~/lib/placeholder-presets";
import { useVisualViewportFrame } from "~/lib/useVisualViewportFrame";
import type { ThreadData } from "~/shared/types";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import ShareButton from "~/components/ShareButton";
import NewDocumentDialog from "~/components/NewDocumentDialog";
import SignInDialog from "~/components/SignInDialog";
import SendDialog from "~/components/SendDialog";
import HistoryDialog from "~/components/HistoryDialog";
import { useAttachments, SIGN_IN_EVENT } from "~/lib/useAttachments";
import Icon from "~/components/Icon";
import AgentsPanel from "~/components/AgentsPanel";
import FormatToolbar from "~/components/FormatToolbar";
import HeaderMenu from "~/components/HeaderMenu";
import FacePile from "~/components/FacePile";
import CommentRail from "~/components/CommentRail";
import CommentSheet from "~/components/CommentSheet";
import { documentContext, useEmbedContext } from "~/lib/embed-context";
import { parseDialog, parseThreadParam, readParam, replaceUrl, setParam, type DialogName } from "~/lib/view-url";
import { isFramed, signInFromFrame, useNeedsStorageAccess } from "~/lib/framed";
import { notifyAuthChanged, useSession } from "~/lib/useSession";

/**
 * The two places a vapor editor appears. A "doc" lives at /:id behind a
 * DocumentAgent; "home" is the standalone tour on the homepage — same
 * editor and rail, no id, no connection, no expiry, and Drop an .md file.
 */
export type Surface =
  | { kind: "doc"; id: string; createdAt: number | null }
  | { kind: "home"; fallbackMarkdown: string };

const HEADER_STROKE_SCROLL_PX = 100;
/** How long a `?thread=` waits, once the document has synced, for its thread to appear. */
const THREAD_RESTORE_MS = 3000;

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
    setActiveThreadId,
    handleEditorReady,
    handleCommentClick,
    commentHighlight,
    activeCommentRange,
    commentColors,
    openCommentInput,
    commentActive,
    mentionSources,
    mentionTargets,
    mentionTargetsKey,
    slashActions,
    refreshRoster,
    markdown,
  } = useDocument();
  const navigate = useNavigate();

  // The address follows the title: `/agent-identity-plan-26g5wsew`. The id
  // is what resolves, so this only rewrites the visible URL (and the tab
  // title) as the first heading changes; the router isn't involved.
  const title = useMemo(() => titleFromMarkdown(markdown), [markdown]);
  useEffect(() => {
    if (surface.kind !== "doc") return;
    document.title = title ? `${title} · vapor` : "vapor";
    const path = documentPath(surface.id, title);
    // replaceUrl also tells an embedding host the address changed (#121).
    replaceUrl(`${path}${window.location.search}${window.location.hash}`);
  }, [surface, title]);
  // A document the visitor just created gets focus so they can type at once.
  const fresh = Boolean((useLocation().state as { fresh?: boolean } | null)?.fresh);
  const railRef = useRef<HTMLElement>(null);
  // The comment sheet sits on a fixed layer pinned to the visual viewport,
  // so it stays above the keyboard while iOS pans for it.
  const chromeRef = useRef<HTMLDivElement>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);
  useVisualViewportFrame(chromeRef, setKeyboardUp);
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

  // One dialog at a time, and the open one is in the URL: `?dialog=history`
  // (#121). Read after mount, since the server can't see the query.
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  const agentsOpen = dialog === "invite";
  const signInOpen = dialog === "signin";
  const sendOpen = dialog === "send";
  const newOpen = dialog === "new";
  const historyOpen = dialog === "history";
  const dialogRestored = useRef(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDialog(parseDialog(readParam("dialog"), surface.kind === "doc"));
  }, [surface.kind]);
  useEffect(() => {
    // The first run sees the state from before the restore above lands.
    if (!dialogRestored.current) {
      dialogRestored.current = true;
      return;
    }
    if (readParam("dialog") !== dialog) setParam("dialog", dialog);
  }, [dialog]);

  // The open comment thread is in the URL too: `?thread=t-…`. On load it
  // waits for the threads to arrive, then opens (Editor scrolls it into
  // view); one that never turns up is dropped from the address.
  const pendingThread = useRef<string | null>(null);
  useEffect(() => {
    pendingThread.current = parseThreadParam(readParam("thread"));
  }, []);
  useEffect(() => {
    const pending = pendingThread.current;
    if (!pending) return;
    if (threads.some((t) => t.id === pending)) {
      pendingThread.current = null;
      setActiveThreadId(pending);
      return;
    }
    if (!yjs.synced || !editorInstance) return;
    const giveUp = window.setTimeout(() => {
      if (pendingThread.current !== pending) return;
      pendingThread.current = null;
      setParam("thread", null);
    }, THREAD_RESTORE_MS);
    return () => clearTimeout(giveUp);
  }, [threads, yjs.synced, editorInstance, setActiveThreadId]);
  useEffect(() => {
    if (pendingThread.current) {
      // Someone opened another thread before the one in the URL arrived.
      if (!activeThreadId || activeThreadId === pendingThread.current) return;
      pendingThread.current = null;
    }
    if (readParam("thread") !== activeThreadId) setParam("thread", activeThreadId);
  }, [activeThreadId]);

  // What an embedding host is told is on screen (#121): the document and
  // the open thread, by the ids the MCP tools take. The tour has no id the
  // API knows, so it reports its title alone.
  const activeThread = activeThreadId ? threads.find((t) => t.id === activeThreadId) ?? null : null;
  useEmbedContext(
    surface.kind === "doc"
      ? documentContext({ id: surface.id, title }, activeThread ? { id: activeThread.id, commentText: activeThread.commentText } : null)
      : { title: "vapor" },
  );

  // Sign-in from a frame (#121): Google and Apple refuse to run framed in
  // many browsers, and a framed page may not see the person's cookies. So,
  // framed and signed out, Sign in asks for storage access (and reloads with
  // the session it lets through) or opens sign-in in a new tab, then reads
  // the session again when the frame has the focus back.
  const session = useSession();
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFramed(isFramed());
  }, []);
  const needsStorageAccess = useNeedsStorageAccess(framed);
  const openSignIn = useCallback(() => {
    if (framed && !session?.signedIn) signInFromFrame(needsStorageAccess, notifyAuthChanged);
    else setDialog("signin");
  }, [framed, session?.signedIn, needsStorageAccess]);
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
  // Something elsewhere (a dropped file while signed out) asks for sign-in.
  useEffect(() => {
    const open = () => setDialog("signin");
    window.addEventListener(SIGN_IN_EVENT, open);
    return () => window.removeEventListener(SIGN_IN_EVENT, open);
  }, []);
  const inviteAgent = () => setDialog("invite");
  const { attach } = useAttachments({
    docId: surface.kind === "doc" ? surface.id : "",
    enabled: surface.kind === "doc",
    editor: editorInstance,
    mode: yjs.mode,
  });
  // Pasted files go to the document as attachments; text keeps the editor's own paste handling.
  useEffect(() => {
    if (!editorInstance) return;
    const dom = editorInstance.view.dom;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      attach(files);
    };
    dom.addEventListener("paste", onPaste);
    return () => dom.removeEventListener("paste", onPaste);
  }, [editorInstance, attach]);
  // `vapor:` links in the text are actions: the Agents panel (which on the
  // tour shows how to connect without a roster), the New document dialog,
  // and the Sign in dialog.
  const handleAppLink = useCallback((url: string) => {
    if (url === "vapor://invite") setDialog("invite");
    if (url === "vapor://new") setDialog("new");
    if (url === "vapor://signin") openSignIn();
  }, [openSignIn]);

  // A new document starts empty; the tour stays on the homepage. (A document
  // made from another's markdown keeps that document's attachment URLs,
  // which stop working when it expires — accepted for v1.)
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

  // On the tour a dropped .md becomes a new document; on a document, dropped
  // files become attachments where they landed.
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      e.preventDefault();
      if (isHome) {
        const file = files[0];
        if (file && file.name.endsWith(".md")) uploadFile(file);
        return;
      }
      const hit = editorInstance?.view.posAtCoords({ left: e.clientX, top: e.clientY });
      attach(files, hit?.pos);
    },
    [isHome, uploadFile, editorInstance, attach],
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
    <div
      onDrop={handleDrop}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
    >
      {/* One header at every width: Format, Share (Create on the tour),
          who's here (desktop), and the menu, right-aligned. Sticky, not
          fixed: the scroll engine holds it steady while mobile Safari's
          toolbar collapses, where a script-positioned layer lags a frame. */}
      <header
        className={`sticky top-0 z-30 flex h-[60px] items-center justify-end gap-[6px] overflow-hidden border-b bg-paper p-[6px] pt-[calc(6px+env(safe-area-inset-top))] transition-colors ${
          scrolled ? "border-border" : "border-transparent"
        }`}
      >
        <FacePile alsoOnline={demoPresence} />
        <FormatToolbar onAttachFiles={isHome ? undefined : attach} />
        {/* The tour has nothing to share; Create takes Share's place there
            and the menu's New document row steps aside for it. */}
        {isHome ? (
          <button className="header-button" aria-label="Create" title="Create" onClick={() => setDialog("new")}>
            <Icon name="add_2" />
          </button>
        ) : (
          <ShareButton onInviteAgent={inviteAgent} onSendTo={isHome ? undefined : () => setDialog("send")} />
        )}
        <HeaderMenu
          comments={wide ? undefined : { open: commentsOpen, onToggle: toggleComments }}
          onNewDocument={isHome ? undefined : () => setDialog("new")}
          onHistory={isHome ? undefined : () => setDialog("history")}
          onSendTo={isHome ? undefined : () => setDialog("send")}
          onSignIn={openSignIn}
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


      <AgentsPanel
        open={agentsOpen}
        onClose={closeDialog}
        docId={surface.kind === "doc" ? surface.id : undefined}
      />
      <NewDocumentDialog
        open={newOpen}
        onClose={closeDialog}
        onBlank={createBlankDocument}
        onFile={uploadFile}
      />
      {surface.kind === "doc" && <HistoryDialog open={historyOpen} onClose={closeDialog} />}
      <SignInDialog open={signInOpen} onClose={closeDialog} />
      {surface.kind === "doc" && <SendDialog open={sendOpen} onClose={closeDialog} docId={surface.id} />}
      {/* The page itself scrolls, so mobile browsers collapse their toolbar
          and let the text run under it. Half a screen at the foot so the end
          of the document can scroll clear of the keyboard. */}
      <main className="pb-[50dvh]">
        <div className="flex items-start">
          {/* `tour` scopes the demo document's own styling (app.css). */}
          <div className={isHome ? "tour min-w-0 flex-1" : "min-w-0 flex-1"}>
            {/* Server-rendered stand-in until TipTap mounts: keeps the tour's
                copy indexable, but off screen so raw markdown never flashes
                before the document condenses in. */}
            {isHome && !editorInstance && <pre className="sr-only">{surface.fallbackMarkdown}</pre>}
            <Editor
              yjs={yjs}
              mentions={mentionSources}
              mentionTargets={mentionTargets}
              mentionTargetsKey={mentionTargetsKey}
              onMentionQuery={refreshRoster}
              slashActions={slashActions}
              autofocus={surface.kind === "doc" && fresh}
              placeholders={surface.kind === "doc" ? placeholderPreset(surface.id) : undefined}
              hidden={showPreview}
              onEditorReady={handleEditorReady}
              onCommentClick={handleCommentClick}
              onAppLink={handleAppLink}
              commentHighlight={commentHighlight}
              activeCommentRange={activeCommentRange}
              commentColors={commentColors}
              onNewComment={openCommentInput}
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
