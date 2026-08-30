import { useState, useEffect, useCallback, useId, useRef } from "react";
import * as Switch from "@radix-ui/react-switch";
import { useDocument } from "~/lib/DocumentContext";
import {
  AGENT_NAME_RE,
  DEFAULT_CAPABILITIES,
  type AgentCapability,
  type AgentRosterEntry,
} from "~/shared/agent-protocol";

const CAPABILITY_ORDER: AgentCapability[] = ["suggest", "comment", "write"];
const CAPABILITY_LABELS: Record<AgentCapability, string> = {
  suggest: "Suggest",
  comment: "Comment",
  write: "Write",
};

const NAME_SUGGESTIONS = [
  "scribe",
  "muse",
  "echo",
  "quill",
  "sage",
  "nova",
  "atlas",
  "juniper",
  "orbit",
  "flux",
];

function pickUnusedName(taken: Set<string>): string {
  for (const candidate of NAME_SUGGESTIONS) {
    if (!taken.has(candidate)) return candidate;
  }
  return `agent-${Math.random().toString(36).slice(2, 6)}`;
}

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

interface MintedAgent {
  token: string;
  entry: AgentRosterEntry;
}

interface ErrorBody {
  error: { message: string };
}

function switchClass() {
  return "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-border transition-colors data-[state=checked]:bg-coral";
}

function thumbClass() {
  return "pointer-events-none block h-5 w-5 rounded-full bg-paper shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0";
}

export default function InviteAgentDialog() {
  const { docId } = useDocument();
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [capabilities, setCapabilities] = useState<Set<AgentCapability>>(
    () => new Set(DEFAULT_CAPABILITIES),
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedAgent | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const nameInputId = useId();
  const ownerInputId = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const loadRoster = useCallback(async () => {
    const res = await fetch(`/${docId}/agents`);
    if (!res.ok) return;
    const list = (await res.json()) as AgentRosterEntry[];
    setRoster(list);
  }, [docId]);

  // Fetches the roster from the server when the dialog opens; the setState
  // happens after the await, not synchronously in the effect body.
  useEffect(() => {
    if (!open) return;
    void loadRoster();
  }, [open, loadRoster]);

  // Derives the pre-filled name suggestion from the freshly loaded roster;
  // only runs once per dialog open (guarded by the `current` check).
  useEffect(() => {
    if (!open || minted) return;
    const taken = new Set(roster.map((r) => r.name));
    setName((current) => (current ? current : pickUnusedName(taken)));
  }, [open, roster, minted]);

  const handleOpen = useCallback(() => {
    setMinted(null);
    setName("");
    setOwner("");
    setNameError(null);
    setCopiedField(null);
    setCapabilities(new Set(DEFAULT_CAPABILITIES));
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    // Return focus to the menu item that opened the dialog.
    triggerRef.current?.focus();
  }, []);

  // Focuses the name input as soon as the dialog (in its default, unminted
  // form) mounts, so keyboard users land somewhere useful instead of on the
  // document body.
  useEffect(() => {
    if (!open || minted) return;
    nameInputRef.current?.focus();
    // Only on the open transition — refocusing on every keystroke re-render
    // would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes the dialog, same as the overlay-click / close-button paths.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  // Closes only on a genuine backdrop click — a click that bubbles up from
  // the panel itself has `e.target` set to the descendant it started on, not
  // the overlay, so it's ignored here.
  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) handleClose();
  }

  function toggleCapability(cap: AgentCapability) {
    setCapabilities((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!AGENT_NAME_RE.test(name)) {
      setNameError("Lowercase letters, digits, and hyphens");
      return;
    }
    setNameError(null);

    const res = await fetch(`/${docId}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "mint",
        name,
        owner: owner.trim() || undefined,
        capabilities: [...capabilities],
      }),
    });
    const json = (await res.json()) as MintedAgent | ErrorBody;
    if (!res.ok || "error" in json) {
      setNameError("error" in json ? json.error.message : "Failed to create agent");
      return;
    }
    setMinted(json);
    void loadRoster();
  }

  async function handleRevoke(revokeName: string) {
    await fetch(`/${docId}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "revoke", name: revokeName }),
    });
    void loadRoster();
  }

  async function handleCopy(field: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 2000);
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const claudeCodeCommand = minted
    ? `claude mcp add --transport http vapor ${origin}/mcp --header "Authorization: Bearer ${minted.token}"`
    : "";
  const connectorUrl = `${origin}/mcp`;
  const mcpServersJson = minted
    ? JSON.stringify(
        {
          mcpServers: {
            vapor: {
              url: `${origin}/mcp`,
              headers: { Authorization: `Bearer ${minted.token}` },
            },
          },
        },
        null,
        2,
      )
    : "";

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleOpen}
        className="flex h-full cursor-pointer items-center gap-1 px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
      >
        Invite agent
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
                Invite agent
              </h2>
              <button
                onClick={handleClose}
                aria-label="Close"
                className="cursor-pointer text-muted hover:text-ink"
              >
                {"✕"}
              </button>
            </div>

            {!minted ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor={nameInputId} className="mb-1 block text-sm text-muted">
                    Name
                  </label>
                  <input
                    id={nameInputId}
                    ref={nameInputRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full border border-border bg-paper px-3 py-1.5 font-mono text-sm outline-none focus:border-ink"
                  />
                  {nameError && <p className="mt-1 text-sm text-coral">{nameError}</p>}
                </div>
                <div>
                  <label htmlFor={ownerInputId} className="mb-1 block text-sm text-muted">
                    Owner (optional)
                  </label>
                  <input
                    id={ownerInputId}
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    className="w-full border border-border bg-paper px-3 py-1.5 text-sm outline-none focus:border-ink"
                  />
                </div>
                <div className="space-y-2">
                  {CAPABILITY_ORDER.map((cap) => (
                    <div key={cap} className="flex items-center justify-between">
                      <span className="text-sm">{CAPABILITY_LABELS[cap]}</span>
                      <Switch.Root
                        checked={capabilities.has(cap)}
                        onCheckedChange={() => toggleCapability(cap)}
                        aria-label={CAPABILITY_LABELS[cap]}
                        className={switchClass()}
                      >
                        <Switch.Thumb className={thumbClass()} />
                      </Switch.Root>
                    </div>
                  ))}
                </div>
                <button
                  type="submit"
                  className="w-full cursor-pointer bg-ink px-4 py-2 text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
                >
                  Create
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <code className="block break-all border border-border bg-border/20 px-3 py-2 text-sm">
                  {minted.token}
                </code>
                <button
                  onClick={() => handleCopy("token", minted.token)}
                  className="cursor-pointer text-sm text-muted hover:text-ink"
                >
                  {copiedField === "token" ? "Copied" : "Copy token"}
                </button>
                <p className="text-sm text-coral">
                  This token is shown once. Revoke and re-mint to replace it.
                </p>
                <div className="space-y-3">
                  <SnippetRow
                    label="Claude Code"
                    text={claudeCodeCommand}
                    field="cli"
                    copiedField={copiedField}
                    onCopy={handleCopy}
                  />
                  <SnippetRow
                    label="claude.ai connector"
                    text={connectorUrl}
                    field="url"
                    copiedField={copiedField}
                    onCopy={handleCopy}
                  />
                  <SnippetRow
                    label="mcpServers JSON"
                    text={mcpServersJson}
                    field="json"
                    copiedField={copiedField}
                    onCopy={handleCopy}
                  />
                </div>
              </div>
            )}

            <div className="mt-6 border-t border-border pt-4">
              <h3 className="mb-2 text-sm uppercase tracking-wider text-muted">Roster</h3>
              {roster.length === 0 ? (
                <p className="text-sm text-muted">No agents invited yet.</p>
              ) : (
                <ul className="space-y-2">
                  {roster.map((entry) => (
                    <li
                      key={entry.name}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="font-mono">{entry.name}</span>
                        {entry.capabilities.map((c) => (
                          <span
                            key={c}
                            className="border border-border px-1 text-xs text-muted"
                          >
                            {c}
                          </span>
                        ))}
                        {entry.owner && <span className="text-muted">{entry.owner}</span>}
                        <span className="text-muted">{relativeTime(entry.lastSeenAt)}</span>
                      </span>
                      <button
                        onClick={() => handleRevoke(entry.name)}
                        className="cursor-pointer text-muted hover:text-coral"
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
      )}
    </>
  );
}

function SnippetRow({
  label,
  text,
  field,
  copiedField,
  onCopy,
}: {
  label: string;
  text: string;
  field: string;
  copiedField: string | null;
  onCopy: (field: string, text: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        <button
          onClick={() => onCopy(field, text)}
          className="cursor-pointer text-sm text-muted hover:text-ink"
        >
          {copiedField === field ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto border border-border bg-border/20 px-3 py-2 text-xs">
        {text}
      </pre>
    </div>
  );
}
