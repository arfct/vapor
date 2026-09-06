import { useCallback, useEffect, useState } from "react";
import type { AgentRosterEntry } from "~/shared/agent-protocol";
import { AGENT_CLIENTS, type AgentClientId } from "~/shared/agent-clients";
import Dialog, { SnippetRow } from "~/components/ui/dialog";
import AgentClientIcon from "~/components/AgentClientIcon";
import Icon from "~/components/Icon";
import WakeSection from "~/components/WakeSection";

/** Whether the agent connects as the signed-in person or as an anonymous animal. */
type Mode = "you" | "anonymous";

/** Clients that come in several forms: the pulldown under the tabs picks one. */
interface VariantSet {
  options: { id: string; label: string }[];
  initial: string;
}
const VARIANTS: Partial<Record<AgentClientId, VariantSet>> = {
  claude: {
    options: [
      { id: "claude", label: "Claude" },
      { id: "code-app", label: "Claude Code app" },
      { id: "code-cli", label: "Claude Code CLI" },
    ],
    initial: "code-app",
  },
  chatgpt: {
    options: [
      { id: "app", label: "ChatGPT app" },
      { id: "cli", label: "Codex CLI" },
    ],
    initial: "app",
  },
};

const pulldownClass = "m-0 cursor-pointer bg-transparent p-0 text-sm text-muted hover:text-ink focus:outline-none";

/** Opens claude.ai's add-connector dialog with the name and URL filled in; the person reviews and confirms. */
export function claudeConnectorLink(mcpUrl: string): string {
  return `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=vapor&connectorUrl=${encodeURIComponent(mcpUrl)}`;
}
export const CHATGPT_CONNECTORS_URL = "https://chatgpt.com/#settings/Connectors";

/** A UI path, linked straight to that screen when the product has a URL for it, with a pop-out mark. */
function Nav({ href, children }: { href?: string; children: React.ReactNode }) {
  const inner = <strong className="font-semibold text-ink">{children}</strong>;
  if (!href) return inner;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-border underline-offset-2 hover:decoration-ink"
    >
      {inner}
      <Icon name="open_in_new" className="ml-0.5 text-[14px] text-muted" />
    </a>
  );
}

const tabClass = (active: boolean) =>
  `flex flex-1 cursor-pointer flex-col items-center gap-1 border-b-2 px-1 pb-2 pt-1 text-xs transition-colors ${
    active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
  }`;

/**
 * The Agents panel: how to connect an agent over MCP, one tab per client
 * with its mark. Wake-on-mention setup lives inside the tab it belongs to:
 * a Claude Code routine under Claude, a webhook under Other. Agents
 * authenticate via OAuth (or the anonymous endpoint) and enroll on first
 * touch. The document's roster is managed from the face pile, not here; it
 * is loaded only so the wake sections know whether the person's own agent
 * is on the document.
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
  const [client, setClient] = useState<AgentClientId>("claude");
  const [mode, setMode] = useState<Mode>("you");
  const [variant, setVariant] = useState<string>(VARIANTS.claude!.initial);
  const variants = VARIANTS[client];
  const pickClient = (id: AgentClientId) => {
    setClient(id);
    setVariant(VARIANTS[id]?.initial ?? "");
  };
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

  const mcpUrl = `${origin}/mcp`;
  const anonUrl = `${origin}/mcp/anonymous`;
  // One URL per mode: "as you" is the signed-in endpoint, "anonymously" the tokenless one.
  const url = mode === "you" ? mcpUrl : anonUrl;
  const claudeCodeCommand = `claude mcp add --transport http vapor ${url}`;
  const codexCommand = `codex mcp add vapor --url ${url}`;
  const geminiCommand = `gemini mcp add --transport http vapor ${url}`;
  // One line each: the snippet rows don't keep newlines, and compact JSON still pastes.
  const mcpServersJson = JSON.stringify({ mcpServers: { vapor: { url } } });
  const vscodeJson = JSON.stringify({ servers: { vapor: { type: "http", url } } });
  const claudeCodeJson = JSON.stringify({ mcpServers: { vapor: { type: "http", url } } });
  const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=vapor&config=${btoa(JSON.stringify({ url }))}`;
  const vscodeLink = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "vapor", type: "http", url }))}`;
  const geminiExtension = "gemini extensions install https://github.com/arfct/vapor";
  const asYou = mode === "you";

  const modePicker = (
    <select
      aria-label="Connect as"
      value={mode}
      onChange={(e) => setMode(e.target.value as Mode)}
      className={pulldownClass}
    >
      <option value="you">personally</option>
      <option value="anonymous">anonymously</option>
    </select>
  );

  return (
    <Dialog open={open} onClose={onClose} title="Invite an agent" accessory={modePicker}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {asYou
            ? "Connect an AI agent over MCP as yourself: it gets a stable identity, your name on its work, and write access if you grant it at sign-in."
            : "Connect an AI agent over MCP with no account: it appears as an anonymous animal and can suggest and comment."}
        </p>
        <div className="flex border-b border-border" role="tablist" aria-label="Client">
          {AGENT_CLIENTS.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={client === c.id}
              onClick={() => pickClient(c.id)}
              className={tabClass(client === c.id)}
            >
              <AgentClientIcon client={c.id} size={20} />
              {c.label}
            </button>
          ))}
        </div>
        {variants && (
          <select
            aria-label="App or command line"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            className="m-0 cursor-pointer bg-transparent p-0 text-lg font-medium text-ink focus:outline-none"
          >
            {variants.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        {client === "claude" && (
          <div className="space-y-4" role="tabpanel">
            {variant === "claude" && (
              <>
                <p className="text-sm text-muted">
                  <Nav href={claudeConnectorLink(url)}>Settings → Connectors → Add custom connector</Nav>.
                </p>
                <SnippetRow label="MCP server URL" text={url} showLabel={false} />
              </>
            )}
            {variant === "code-app" && (
              <>
                <p className="text-sm text-muted">
                  Add this to <code className="font-mono">.mcp.json</code> at the root of the project, then start a
                  session. The app picks it up and asks once before using it.
                </p>
                <SnippetRow label=".mcp.json" text={claudeCodeJson} showLabel={false} />
              </>
            )}
            {variant === "code-cli" && <SnippetRow label="Claude Code" text={claudeCodeCommand} showLabel={false} />}
            {/* An anonymous agent has no owner, so nothing could be woken for it. */}
            {asYou && <WakeSection kind="claude-routine" docId={docId} roster={roster} onRoster={setRoster} />}
          </div>
        )}
        {client === "chatgpt" && (
          <div className="space-y-4" role="tabpanel">
            {variant === "app" && (
              <>
                <p className="text-sm text-muted">
                  <Nav href={CHATGPT_CONNECTORS_URL}>Settings → Connectors → Advanced → Developer mode</Nav>, then{" "}
                  <strong className="font-semibold text-ink">Create</strong> a connector with this URL
                  {asYou ? " and OAuth" : " and no authentication"}. Paid plans only.
                </p>
                <SnippetRow label="MCP server URL" text={url} showLabel={false} />
              </>
            )}
            {variant === "cli" && (
              <>
                <SnippetRow label="Codex CLI" text={codexCommand} showLabel={false} />
                {asYou && (
                  <p className="text-sm text-muted">
                    Then <code className="font-mono">codex mcp login vapor</code> to sign in.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {client === "gemini" && (
          <div className="space-y-4" role="tabpanel">
            {asYou && <SnippetRow label="Extension, with the vapor skill" text={geminiExtension} />}
            <SnippetRow label={asYou ? "Server only" : "Gemini CLI"} text={geminiCommand} />
          </div>
        )}
        {client === "cursor" && (
          <div className="space-y-4" role="tabpanel">
            <a href={cursorLink} className="inline-block text-sm underline">
              Add to Cursor
            </a>
            <SnippetRow label="Or .cursor/mcp.json" text={mcpServersJson} />
            {asYou && (
              <p className="text-sm text-muted">
                Sign in from <Nav>Settings → MCP</Nav>.
              </p>
            )}
          </div>
        )}
        {client === "vscode" && (
          <div className="space-y-4" role="tabpanel">
            <a href={vscodeLink} className="inline-block text-sm underline">
              Add to VS Code
            </a>
            <SnippetRow label="Or .vscode/mcp.json" text={vscodeJson} />
          </div>
        )}
        {client === "other" && (
          <div className="space-y-4" role="tabpanel">
            <p className="text-sm text-muted">
              Any MCP client that speaks HTTP takes the same URL{asYou ? ", and follows the OAuth flow it discovers" : ""}.
              Full guide:{" "}
              <a href="/mcp" className="underline" target="_blank" rel="noreferrer">
                {origin.replace(/^https?:\/\//, "")}/mcp
              </a>
              .
            </p>
            <SnippetRow label="MCP configuration" text={mcpServersJson} />
            {asYou && <WakeSection kind="webhook" docId={docId} roster={roster} onRoster={setRoster} />}
          </div>
        )}

      </div>
    </Dialog>
  );
}
