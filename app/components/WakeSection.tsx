import { useCallback, useEffect, useState } from "react";
import type { AgentRosterEntry } from "~/shared/agent-protocol";
import {
  CLAUDE_ROUTINE_PROMPT,
  WAKE_KINDS,
  wakeKindInfo,
  type WakeKind,
  type WakeTargetView,
} from "~/shared/wake-policy";
import { useSession } from "~/lib/useSession";
import { timeAgo } from "~/lib/time-ago";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";

type Outcome =
  | { fired: true; status: number }
  | { fired: false; reason: string; status?: number; error?: string };

const textButton = "cursor-pointer text-sm text-muted transition-colors hover:text-ink";
const sectionTitle = "mb-2 text-sm uppercase tracking-wider text-muted";

/**
 * "Mentions and subscriptions": how vapor wakes this person's agent when it
 * is mentioned or replied to, anywhere it is enrolled. Signed-out visitors
 * see one line; the owner sets a target once (a Claude Code routine or a
 * webhook), tests it, and on a document can enrol their agent so mentions
 * here reach it. Plan: docs/plans/2026-09-06-agent-wake-plan.md.
 */
export default function WakeSection({
  docId,
  roster,
  onRoster,
}: {
  docId?: string;
  roster: AgentRosterEntry[];
  onRoster: (roster: AgentRosterEntry[]) => void;
}) {
  const session = useSession();
  const signedIn = session?.signedIn === true;
  const [target, setTarget] = useState<WakeTargetView | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<WakeKind>("claude-routine");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch("/me/wake")
      .then((r) => (r.ok ? r.json() : { target: null }))
      .then((raw) => {
        const data = raw as { target: WakeTargetView | null };
        if (!cancelled) setTarget(data.target);
      })
      .catch(() => {
        if (!cancelled) setTarget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/me/wake", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, url, secret }),
      });
      const data = (await res.json()) as { target?: WakeTargetView; error?: string };
      if (!res.ok || !data.target) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setTarget(data.target);
      setEditing(false);
      setSecret("");
      setNote("Saved. Test it to be sure the token works.");
    } catch {
      setError("Could not save.");
    } finally {
      setBusy(false);
    }
  }, [kind, url, secret]);

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fetch("/me/wake", { method: "DELETE" });
      setTarget(null);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/me/wake/test", { method: "POST" });
      const data = (await res.json()) as Outcome & { target?: WakeTargetView | null };
      if (data.target !== undefined) setTarget(data.target);
      if (data.fired) {
        setNote(`Woke it. The target answered ${data.status}.`);
      } else if (data.reason === "delivery") {
        setError(data.error ?? "The target refused the wake.");
      } else if (data.reason === "daily_cap") {
        setError("Daily wake cap reached. Try again tomorrow.");
      } else {
        setError(`Not sent: ${data.reason}.`);
      }
    } catch {
      setError("Could not reach vapor.");
    } finally {
      setBusy(false);
    }
  }, []);

  const join = useCallback(async () => {
    if (!docId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/${docId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "join" }),
      });
      const data = (await res.json()) as AgentRosterEntry[] | { error: { message: string } };
      if (!res.ok || !Array.isArray(data)) {
        setError(Array.isArray(data) ? "Could not add your agent." : data.error.message);
        return;
      }
      onRoster(data);
      setNote("Your agent is on this document. Mention it by the name shown in the roster.");
    } finally {
      setBusy(false);
    }
  }, [docId, onRoster]);

  const copyPrompt = useCallback(() => {
    navigator.clipboard?.writeText(CLAUDE_ROUTINE_PROMPT).then(
      () => {
        setPromptCopied(true);
        setTimeout(() => setPromptCopied(false), 1500);
      },
      () => {},
    );
  }, []);

  const startEditing = () => {
    setKind(target?.kind ?? "claude-routine");
    setUrl(target?.url ?? "");
    setSecret("");
    setError(null);
    setNote(null);
    setEditing(true);
  };

  const mine = signedIn ? roster.find((entry) => entry.owner === session?.principal) : undefined;
  const info = wakeKindInfo(kind) ?? WAKE_KINDS[0];

  return (
    <section className="border-b border-border pb-4">
      <h3 className={sectionTitle}>Mentions and subscriptions</h3>
      {!signedIn ? (
        <p className="text-sm text-muted">
          Sign in and a mention of your agent in any document can wake it: a Claude Code routine, or
          a webhook of your own.
        </p>
      ) : target === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : target && !editing ? (
        <div className="space-y-2">
          <p className="text-sm">
            Mentions wake your <span className="font-medium">{wakeKindInfo(target.kind)?.label ?? target.kind}</span>
            <span className="text-muted"> ({target.secretHint})</span>.
          </p>
          <p className="text-sm text-muted">
            {target.lastFiredAt
              ? `Last woken ${timeAgo(target.lastFiredAt)}${target.lastStatus ? `, answered ${target.lastStatus}` : ""}.`
              : "Not woken yet."}{" "}
            {target.firesToday > 0 && `${target.firesToday} today.`}
          </p>
          {target.lastError && <p className="text-sm text-coral">{target.lastError}</p>}
          <div className="flex gap-4">
            <button className={textButton} onClick={test} disabled={busy}>
              Test
            </button>
            <button className={textButton} onClick={startEditing} disabled={busy}>
              Change
            </button>
            <button className={`${textButton} hover:text-coral`} onClick={remove} disabled={busy}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Set this once. Any document your agent is on can then wake it when someone mentions it or
            replies in its thread.
          </p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Wake target kind">
            {WAKE_KINDS.map((k) => (
              <label key={k.kind} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="wake-kind"
                  className="mt-1"
                  checked={kind === k.kind}
                  onChange={() => setKind(k.kind)}
                />
                <span>
                  <span className="font-medium">{k.label}</span>
                  <span className="block text-muted">{k.summary}</span>
                </span>
              </label>
            ))}
          </div>
          {kind === "claude-routine" && (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>
                Create a routine at claude.ai/code/routines with{" "}
                <button className="cursor-pointer underline hover:text-ink" onClick={copyPrompt}>
                  {promptCopied ? "prompt copied" : "this prompt"}
                </button>{" "}
                and the <strong className="font-semibold text-ink">Vapor</strong> connector attached.
              </li>
              <li>
                Under <strong className="font-semibold text-ink">Select a trigger → API</strong>, generate a token.
              </li>
              <li>Paste the fire URL and the token here.</li>
            </ol>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-muted">{info.urlLabel}</span>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={info.urlPlaceholder} spellCheck={false} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">
              {info.secretLabel}
              {info.secretOptional && <span> (optional)</span>}
            </span>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={info.secretPlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="flex items-center gap-4">
            <Button size="sm" onClick={save} disabled={busy || !url}>
              Save
            </Button>
            {target && (
              <button className={textButton} onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
      {signedIn && docId && target && !mine && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-sm text-muted">Mentions only reach agents on this document.</p>
          <button className={textButton} onClick={join} disabled={busy}>
            Add my agent
          </button>
        </div>
      )}
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      {error && <p className="mt-2 text-sm text-coral">{error}</p>}
    </section>
  );
}
