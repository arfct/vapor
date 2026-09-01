import { useRef, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router";
import type { Route } from "./+types/home";
import { APP_NAME, generateDocumentId } from "~/shared/constants";
import { deserializeThreads } from "~/lib/thread-serialization";
import demoDocument from "./demo.md?raw";

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return { origin: url.origin };
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "vapor" },
    { name: "description", content: "Live markdown documents for people and AI agents" },
    { property: "og:image", content: "https://vapor.fyi/logo-512.png" },
  ];
}

const headingClass = "mt-10 text-2xl font-bold text-ink";

function CodeBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-3 flex max-w-full items-center gap-2 rounded bg-border py-1 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-base">
        {command}
      </code>
      <button
        onClick={handleCopy}
        className="shrink-0 cursor-pointer rounded p-1.5 text-muted transition-colors hover:text-ink"
        aria-label={copied ? "Copied" : "Copy command"}
      >
        {copied ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { origin } = loaderData;
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleNewDocument() {
    const { body, threads, onboarding } = deserializeThreads(demoDocument);
    const id = generateDocumentId();
    await fetch(`/agents/document-agent/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, threads, onboarding }),
    });
    navigate(`/${id}`);
  }

  const handleUpload = useCallback(
    async (file: File) => {
      const text = await file.text();
      const { body, threads } = deserializeThreads(text);
      const id = generateDocumentId();

      // Create the document with initial content + threads via POST body
      await fetch(`/agents/document-agent/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body, threads }),
      });

      navigate(`/${id}`);
    },
    [navigate],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
    },
    [handleUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".md")) handleUpload(file);
    },
    [handleUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div
      className="min-h-screen bg-paper text-ink"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <header className="flex items-stretch overflow-x-auto scrollbar-none border-b border-border">
        <Link
          to="/"
          className="flex shrink-0 items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
        >
          {APP_NAME}
        </Link>
        <div className="flex grow items-center whitespace-nowrap px-4 text-sm text-muted">
          <span>Work in progress.</span>
          &nbsp;Bugs and feedback on{" "}
          <a
            href="https://github.com/arfct/vapor"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink transition-colors hover:text-coral"
          >
            GitHub
          </a>
          .
        </div>
        <div className="flex shrink-0 items-center gap-3 border-l border-border px-4 text-sm">
          <Link to="/privacy" className="text-ink transition-colors hover:text-coral">
            Privacy
          </Link>
          <Link to="/terms" className="text-ink transition-colors hover:text-coral">
            Terms
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-10 sm:px-6">
        <p className="text-base text-muted">
          Live Markdown for people and agents, side by side. Every document
          is public by URL and deletes itself after 99 hours &mdash; export
          or save what you want to keep.
        </p>

        <h2 className={headingClass}>Create a document</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <button
            onClick={handleNewDocument}
            className="cursor-pointer whitespace-nowrap border border-ink bg-ink px-6 py-2 text-paper transition-opacity hover:opacity-80"
          >
            New document
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer text-muted underline underline-offset-2 transition-colors hover:text-ink"
          >
            Drop an .md file
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md"
          onChange={handleFileChange}
          className="hidden"
        />

        <h2 className={headingClass}>From your terminal</h2>
        <CodeBlock command={`curl ${origin}/new -T file.md`} />

        <h2 className={headingClass}>From your agent</h2>
        <CodeBlock command={`claude mcp add --transport http vapor ${origin}/mcp`} />
        <p className="mt-2 text-sm text-muted">
          Agents join with a visible cursor and edit like a person would.
        </p>

        <h2 className={headingClass}>As a habit</h2>
        <CodeBlock command="claude plugin marketplace add arfct/vapor && claude plugin install vapor@vapor" />
        <p className="mt-2 text-sm text-muted">
          Bundles the MCP connection with a skill: Claude drafts here,
          discusses in comments, and saves back to your repo before the
          doc expires.
        </p>
      </main>
    </div>
  );
}
