import { useCallback, useEffect, useState } from "react";
import type { AgentRosterEntry } from "~/shared/agent-protocol";
import Dialog, { SnippetRow } from "~/components/ui/dialog";
import { timeAgo } from "~/lib/time-ago";

function relativeTime(ts: number | null): string {
  return ts == null ? "never" : timeAgo(ts);
}

type Client = "claude" | "chatgpt" | "codex" | "cursor" | "other";

const CLIENTS: { id: Client; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "codex", label: "Codex" },
  { id: "cursor", label: "Cursor" },
  { id: "other", label: "Other" },
];

const tabClass = (active: boolean) =>
  `cursor-pointer border-b-2 px-3 py-2 text-sm transition-colors ${
    active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
  }`;

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">{children}</ol>;
}

/**
 * The Agents panel: how to connect an agent over MCP, one tab per client,
 * plus — on a document — its live roster with per-entry revoke. Agents
 * authenticate via OAuth (or the anonymous door) and enroll on first touch.
 * Without a `docId` (the homepage tour) it shows only the instructions.
 */
export default function AgentsPanel({
  open,
  onClose,
  docId,
}: {
  open: boolean;
  onClose: () => void;
  docId?: string;
}) {
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const [client, setClient] = useState<Client>("claude");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://vapor.fyi";

  const loadRoster = useCallback(() => {
    if (!docId) return;
    fetch(`/${docId}/agents`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRoster(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [docId]);

  useEffect(() => {
    if (open) loadRoster();
  }, [open, loadRoster]);

  async function handleRevoke(name: string) {
    await fetch(`/${docId}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "revoke", name }),
    });
    loadRoster();
  }

  const mcpUrl = `${origin}/mcp`;
  const anonUrl = `${origin}/mcp/anonymous`;
  const claudeCodeCommand = `claude mcp add --transport http vapor ${mcpUrl}`;
  const anonCommand = `claude mcp add --transport http vapor ${anonUrl}`;
  const codexCommand = `codex mcp add vapor --url ${mcpUrl}`;
  const geminiCommand = `gemini mcp add --transport http vapor ${mcpUrl}`;
  // One line each: the snippet rows don't keep newlines, and compact JSON still pastes.
  const cursorJson = JSON.stringify({ mcpServers: { vapor: { url: mcpUrl } } });
  const vscodeJson = JSON.stringify({ servers: { vapor: { type: "http", url: mcpUrl } } });

  return (
    <Dialog open={open} onClose={onClose} title="Invite an agent">
            <div className="space-y-4">
              <p className="text-sm text-muted">
                Connect an AI agent over MCP. Signing in gives it a stable identity and,
                if you grant it, write access; the anonymous door needs no account and can
                suggest and comment.
              </p>
              <div className="flex border-b border-border" role="tablist" aria-label="Client">
                {CLIENTS.map((c) => (
                  <button
                    key={c.id}
                    role="tab"
                    aria-selected={client === c.id}
                    onClick={() => setClient(c.id)}
                    className={tabClass(client === c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {client === "claude" && (
                <div className="space-y-4" role="tabpanel">
                  <SnippetRow label="Claude Code — sign in" text={claudeCodeCommand} />
                  <SnippetRow label="Claude Code — anonymous" text={anonCommand} />
                  <p className="text-sm text-muted">
                    For claude.ai and Claude Desktop, add <code className="font-mono">{mcpUrl}</code> as
                    a custom connector (Settings → Connectors).
                  </p>
                </div>
              )}
              {client === "codex" && (
                <div className="space-y-4" role="tabpanel">
                  <SnippetRow label="Codex CLI" text={codexCommand} />
                  <p className="text-sm text-muted">
                    Then <code className="font-mono">codex mcp login vapor</code> to sign in, or use
                    the anonymous URL with no login.
                  </p>
                </div>
              )}
              {client === "cursor" && (
                <div className="space-y-4" role="tabpanel">
                  <SnippetRow label=".cursor/mcp.json" text={cursorJson} />
                  <p className="text-sm text-muted">
                    In the project, or <code className="font-mono">~/.cursor/mcp.json</code> for every
                    project. Sign in from Settings → MCP.
                  </p>
                </div>
              )}
              {client === "other" && (
                <div className="space-y-4" role="tabpanel">
                  <SnippetRow label="Gemini CLI" text={geminiCommand} />
                  <SnippetRow label="VS Code — .vscode/mcp.json" text={vscodeJson} />
                  <p className="text-sm text-muted">
                    Any MCP client that speaks HTTP takes the same URL. Full guide, with what
                    agents can do and how they watch a document:{" "}
                    <a href="/mcp" className="underline" target="_blank" rel="noreferrer">
                      {origin.replace(/^https?:\/\//, "")}/mcp
                    </a>
                    .
                  </p>
                </div>
              )}
              {client === "chatgpt" && (
                <div className="space-y-4" role="tabpanel">
                  <Steps>
                    <li>
                      In ChatGPT, open Settings → Connectors → Advanced and turn on Developer
                      mode. Custom connectors need a paid plan.
                    </li>
                    <li>
                      Choose Create, name it <span className="font-mono">vapor</span>, and paste the
                      server URL below. Pick OAuth to sign in, or use the anonymous URL with no
                      authentication.
                    </li>
                    <li>
                      In a chat, open the tools menu, enable the vapor connector, and paste a
                      document link.
                    </li>
                  </Steps>
                  <SnippetRow label="MCP server URL — sign in" text={mcpUrl} />
                  <SnippetRow label="MCP server URL — anonymous" text={anonUrl} />
                </div>
              )}

              {docId && (
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
                          <span className="text-sm">{entry.label ?? entry.name}</span>
                          {entry.label && (
                            <span className="font-mono text-xs text-muted">@{entry.name}</span>
                          )}
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
              )}
            </div>
    </Dialog>
  );
}
