import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useParams } from "react-router";
import type { AgentRosterEntry } from "~/shared/agent-protocol";

function relativeTime(ts: number | null): string {
  if (ts == null) return "never";
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SnippetRow({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }, [text]);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        <button onClick={copy} className="cursor-pointer text-sm text-muted hover:text-ink">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="block break-all border border-border bg-border/20 px-3 py-2 text-sm">
        {text}
      </code>
    </div>
  );
}

/**
 * The Agents panel: how to connect an agent over MCP (the two doors) plus
 * the document's live roster with per-entry revoke. Token minting is gone —
 * agents authenticate via OAuth (or the anonymous door) and enroll on first
 * touch.
 */
export default function AgentsPanel() {
  const params = useParams();
  const docId = params.id ?? "";
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://vapor.fyi";

  const loadRoster = useCallback(() => {
    fetch(`/${docId}/agents`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRoster(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [docId]);

  useEffect(() => {
    if (open) loadRoster();
  }, [open, loadRoster]);

  const handleClose = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  async function handleRevoke(name: string) {
    await fetch(`/${docId}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "revoke", name }),
    });
    loadRoster();
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) handleClose();
  }

  const claudeCodeCommand = `claude mcp add --transport http vapor ${origin}/mcp`;
  const anonCommand = `claude mcp add --transport http vapor ${origin}/mcp/anonymous`;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="flex h-full cursor-pointer items-center gap-1 px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
      >
        Agents
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={handleOverlayClick}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto border border-border bg-paper p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id={titleId} className="text-lg font-medium">
                Agents
              </h2>
              <button
                onClick={handleClose}
                aria-label="Close"
                className="cursor-pointer text-muted hover:text-ink"
              >
                {"✕"}
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-muted">
                Connect an AI agent over MCP. Signing in gives it a stable identity and,
                if you grant it, write access; the anonymous door needs no account and can
                suggest and comment.
              </p>
              <SnippetRow label="Claude Code — sign in" text={claudeCodeCommand} />
              <SnippetRow label="Claude Code — anonymous" text={anonCommand} />
              <p className="text-sm text-muted">
                For claude.ai, add <code className="font-mono">{origin}/mcp</code> as a custom
                connector (Settings → Connectors).
              </p>

              <div className="border-t border-border pt-4">
                <h3 className="mb-2 text-sm uppercase tracking-wider text-muted">
                  In this document
                </h3>
                {roster.length === 0 ? (
                  <p className="text-sm text-muted">No agents yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {roster.map((entry) => (
                      <li key={entry.name} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="font-mono text-sm">{entry.name}</span>
                          <span className="flex gap-1">
                            {entry.capabilities.map((c) => (
                              <span
                                key={c}
                                className="rounded bg-border px-1 text-[0.65rem] uppercase text-muted"
                              >
                                {c}
                              </span>
                            ))}
                          </span>
                          {entry.owner && (
                            <span className="text-xs text-muted">{entry.owner}</span>
                          )}
                          <span className="text-xs text-muted">{relativeTime(entry.lastSeenAt)}</span>
                        </span>
                        <button
                          onClick={() => handleRevoke(entry.name)}
                          className="cursor-pointer text-sm text-muted hover:text-coral"
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
