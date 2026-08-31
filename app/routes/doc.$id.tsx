import { useState } from "react";
import { data, Link } from "react-router";
import type { Route } from "./+types/doc.$id";
import { getAgentByName } from "agents";
import { isValidDocumentId, DOCUMENT_TTL_MS } from "~/shared/constants";
import { isReservedSlug } from "~/shared/agent-protocol";
import { getCloudflare } from "~/lib/cloudflare.server";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
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
import OnboardingBanner from "~/components/OnboardingBanner";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "vapor" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = params.id;
  // Documents share the root namespace with a handful of reserved slugs
  // (/new, /mcp, /.well-known/…). Refuse them here explicitly rather than
  // relying on isValidDocumentId's shape check to exclude them by accident.
  if (isReservedSlug(id)) {
    throw data(null, { status: 404 });
  }
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/"));
  const { exists, createdAt } = (await res.json()) as {
    exists: boolean;
    createdAt: number | null;
  };

  if (!exists) {
    throw data(null, { status: 404 });
  }

  return { id, createdAt };
}

function formatRemainingTime(createdAt: number): string {
  const elapsed = Date.now() - createdAt;
  const remainingMs = DOCUMENT_TTL_MS - elapsed;
  if (remainingMs <= 0) return "soon";
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.ceil(remainingMs / (60 * 1000));
  return `${minutes}m`;
}

export default function DocumentPage({ loaderData }: Route.ComponentProps) {
  const { id, createdAt } = loaderData;
  const yjs = useYjsEditor(id);

  return (
    <DocumentProvider docId={id} createdAt={createdAt} yjs={yjs}>
      <DocumentLayout id={id} createdAt={createdAt} />
    </DocumentProvider>
  );
}

function DocumentLayout({ id, createdAt }: { id: string; createdAt: number | null }) {
  const {
    yjs,
    showPreview,
    handleEditorReady,
    handleCommentClick,
    commentHighlight,
    activeCommentRange,
    openCommentInput,
    handleResolveAtCursor,
    handleDeleteAtCursor,
  } = useDocument();
  const [agentsOpen, setAgentsOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-stretch overflow-x-auto scrollbar-none border-b border-border">
        <Link
          to="/"
          className="flex items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
        >
          vapor
        </Link>
        <div className="flex grow shrink-0 items-center px-4">
          <span className="font-mono font-bold">{id}</span>
          {createdAt && (
            <span className="ml-2 whitespace-nowrap text-muted">
              auto-deletes in {formatRemainingTime(createdAt)}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center border-l border-border px-3">
          <ConnectionStatus />
        </div>
        <div className="shrink-0 border-l border-border">
          <FormatToolbar />
        </div>
        <div className="shrink-0 border-l border-border">
          <ModeMenu />
        </div>
        <div className="shrink-0 border-l border-border">
          <ShareButton />
        </div>
        <div className="shrink-0 border-l border-border">
          <HeaderMenu onOpenAgents={() => setAgentsOpen(true)} />
        </div>
      </header>
      <AgentsPanel open={agentsOpen} onClose={() => setAgentsOpen(false)} />
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-[33vh] lg:pb-0">
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
        <aside className="hidden w-96 flex-col overflow-hidden lg:flex">
          <div className="flex-1 overflow-y-auto">
            <OnboardingBanner />
            <CommentInput />
            <ThreadList />
          </div>
        </aside>
      </div>
      <MobilePanel className="lg:hidden" />
    </div>
  );
}
