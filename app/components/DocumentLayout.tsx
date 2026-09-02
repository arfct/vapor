import { useRef, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import { useDocument } from "~/lib/DocumentContext";
import { deserializeThreads } from "~/lib/thread-serialization";
import { generateDocumentId, DOCUMENT_TTL_MS } from "~/shared/constants";
import type { ThreadData } from "~/shared/types";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import ShareButton from "~/components/ShareButton";
import AgentsPanel from "~/components/AgentsPanel";
import ModeMenu from "~/components/ModeMenu";
import FormatToolbar from "~/components/FormatToolbar";
import ConnectionStatus from "~/components/ConnectionStatus";
import HeaderMenu from "~/components/HeaderMenu";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import MobilePanel from "~/components/MobilePanel";
import Icon from "~/components/Icon";

/**
 * The two places a vapor editor appears. A "doc" lives at /:id behind a
 * DocumentAgent; "home" is the standalone tour on the homepage — same
 * editor and rail, no id, no connection, and New document / Drop an .md
 * file in the header instead of the id and expiry.
 */
export type Surface =
  | { kind: "doc"; id: string; createdAt: number | null }
  | { kind: "home"; fallbackMarkdown: string };

function formatRemainingTime(createdAt: number): string {
  const elapsed = Date.now() - createdAt;
  const remainingMs = DOCUMENT_TTL_MS - elapsed;
  if (remainingMs <= 0) return "soon";
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.ceil(remainingMs / (60 * 1000));
  return `${minutes}m`;
}

async function createDocument(content: string, threads: ThreadData[]): Promise<string> {
  const id = generateDocumentId();
  await fetch(`/agents/document-agent/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, threads }),
  });
  return id;
}

const headerCell =
  "flex h-full cursor-pointer items-center px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border";

export default function DocumentLayout({ surface }: { surface: Surface }) {
  const {
    yjs,
    editorInstance,
    showPreview,
    handleEditorReady,
    handleCommentClick,
    commentHighlight,
    activeCommentRange,
    openCommentInput,
    handleResolveAtCursor,
    handleDeleteAtCursor,
  } = useDocument();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const isHome = surface.kind === "home";

  // A new document starts empty; the tour stays on the homepage.
  const createBlankDocument = useCallback(async () => {
    navigate(`/${await createDocument("", [])}`);
  }, [navigate]);

  const uploadFile = useCallback(
    async (file: File) => {
      const { body, threads: imported } = deserializeThreads(await file.text());
      navigate(`/${await createDocument(body, imported)}`);
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
      className="flex h-screen flex-col"
      onDrop={handleDrop}
      onDragOver={isHome ? (e) => e.preventDefault() : undefined}
    >
      <header className="flex h-[60px] shrink-0 items-stretch overflow-x-auto scrollbar-none border-b border-border">
        <Link
          to="/"
          className="flex items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
        >
          vapor
        </Link>
        <div className="shrink-0 border-r border-border">
          <ModeMenu />
        </div>
        <div className="shrink-0 border-r border-border">
          {isHome ? (
            <ShareButton copyLink={false} />
          ) : (
            <ShareButton onOpenAgents={() => setAgentsOpen(true)} />
          )}
        </div>
        <div className="shrink-0 border-r border-border">
          <FormatToolbar />
        </div>
        {surface.kind === "doc" ? (
          <div className="flex shrink-0 items-center whitespace-nowrap px-4">
            <span className="font-mono font-bold">{surface.id}</span>
            {surface.createdAt && (
              <span className="ml-2 whitespace-nowrap text-muted">
                auto-deletes in {formatRemainingTime(surface.createdAt)}
              </span>
            )}
          </div>
        ) : (
          <>
            <div className="shrink-0 border-r border-border">
              <button
                onClick={createBlankDocument}
                className={`${headerCell} whitespace-nowrap font-medium text-ink`}
              >
                New document
              </button>
            </div>
            <div className="shrink-0 border-r border-border">
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`${headerCell} whitespace-nowrap text-muted hover:text-ink`}
              >
                Drop an .md file
              </button>
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
        <div className="grow" />
        {surface.kind === "doc" && (
          <div className="flex shrink-0 items-center border-l border-border px-3">
            <ConnectionStatus />
          </div>
        )}
        <div className="hidden shrink-0 border-l border-border lg:block">
          <button
            onClick={() => setCommentsOpen((v) => !v)}
            aria-label={commentsOpen ? "Hide comments" : "Show comments"}
            aria-pressed={commentsOpen}
            title={commentsOpen ? "Hide comments" : "Show comments"}
            className={`flex h-full w-[60px] cursor-pointer items-center justify-center transition-colors hover:bg-border ${
              commentsOpen ? "text-ink" : "text-muted"
            }`}
          >
            <Icon name="comment" />
          </button>
        </div>
        <div className="shrink-0 border-l border-border">
          <HeaderMenu />
        </div>
      </header>
      {surface.kind === "doc" && (
        <AgentsPanel open={agentsOpen} onClose={() => setAgentsOpen(false)} />
      )}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-[33vh] lg:pb-0">
          {/* Server-rendered stand-in until TipTap mounts: keeps the tour's copy indexable. */}
          {isHome && !editorInstance && (
            <pre className="mx-auto w-full max-w-3xl whitespace-pre-wrap p-6 font-sans text-base leading-relaxed text-ink">
              {surface.fallbackMarkdown}
            </pre>
          )}
          <Editor
            yjs={yjs}
            hidden={showPreview}
            onEditorReady={handleEditorReady}
            onCommentClick={handleCommentClick}
            commentHighlight={commentHighlight}
            activeCommentRange={activeCommentRange}
            onNewComment={openCommentInput}
            onResolveAtCursor={handleResolveAtCursor}
            onDeleteAtCursor={handleDeleteAtCursor}
          />
          {showPreview && <Preview />}
        </main>
        <aside
          className={`hidden w-[280px] flex-col overflow-hidden ${
            commentsOpen ? "lg:flex" : ""
          }`}
        >
          <div className="flex-1 overflow-y-auto">
            <CommentInput />
            <ThreadList />
          </div>
        </aside>
      </div>
      <MobilePanel className="lg:hidden" />
    </div>
  );
}
