import { useCallback, useEffect, useState } from "react";
import type { AgentRosterEntry } from "~/shared/agent-protocol";
import { CLAUDE_ROUTINE_PROMPT, wakeKindInfo, type WakeKind, type WakeTargetView } from "~/shared/wake-policy";
import { useSession } from "~/lib/useSession";
import { timeAgo } from "~/lib/time-ago";
import { Input } from "~/components/ui/input";
import Icon from "~/components/Icon";

type Outcome =
  | { fired: true; status: number }
  | { fired: false; reason: string; status?: number; error?: string };

const textButton = "cursor-pointer text-sm text-muted transition-colors hover:text-ink";
const link = "underline decoration-border underline-offset-2 hover:text-ink";

export const ROUTINES_URL = "https://claude.ai/code/routines/new";

/**
 * Wake-on-mention setup for one kind of target, shown inside the client tab
 * it belongs to: a Claude Code routine under Claude, a webhook under Other.
 * A signed-in person sets the target once; any document their agent is on
 * then wakes it on a mention or a reply in its thread. If the person's
 * target is of the other kind, this offers to switch rather than showing a
 * second form. Plan: docs/plans/2026-09-06-agent-wake-plan.md.
 */
export default function WakeSection({
  kind,
  docId,
  roster,
  onRoster,
}: {
  kind: WakeKind;
  docId?: string;
  roster: AgentRosterEntry[];
  onRoster: (roster: AgentRosterEntry[]) => void;
}) {
  const session = useSession();
  const signedIn = session?.signedIn === true;
  const [target, setTarget] = useState<WakeTargetView | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [lastAttempt, setLastAttempt] = useState("");
  const info = wakeKindInfo(kind)!;

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
    setLastAttempt(`${kind}|${url}|${secret}`);
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
      setNote("Saved. Test it to be sure it answers.");
      setLastAttempt("");
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
        setNote(`Woke it. It answered ${data.status}.`);
      } else if (data.reason === "delivery") {
        setError(data.error ?? "It refused the wake.");
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
      setNote("Your agent is on this document. Mention it by the name in the roster.");
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

  // No Save button: the target is saved when both fields are filled in and
  // the person leaves a field or presses Enter. The same values are not
  // re-sent after a failure until one of them changes.
  const complete = url.trim() !== "" && (secret.trim() !== "" || info.secretOptional);
  const maybeSave = () => {
    if (busy || !complete || lastAttempt === `${kind}|${url}|${secret}`) return;
    void save();
  };
  const onFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      maybeSave();
    }
  };

  const startEditing = () => {
    setUrl(target?.kind === kind ? target.url : "");
    setSecret("");
    setError(null);
    setNote(null);
    setEditing(true);
  };

  const mine = signedIn ? roster.find((entry) => entry.owner === session?.principal) : undefined;
  const title = "Listen for changes and mentions";

  let body: React.ReactNode;
  if (!signedIn) {
    body = (
      <p className="text-sm text-muted">
        Sign in, and a mention of your agent in any document can wake{" "}
        {kind === "claude-routine" ? "a Claude Code routine" : "a webhook of yours"}.
      </p>
    );
  } else if (target === undefined) {
    body = <p className="text-sm text-muted">Loading…</p>;
  } else if (target && !editing && target.kind === kind) {
    body = (
      <div className="space-y-2">
        <p className="text-sm">
          Mentions wake your {info.label} <span className="text-muted">({target.secretHint})</span>.
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
    );
  } else if (target && !editing) {
    body = (
      <p className="text-sm text-muted">
        Mentions currently wake your {wakeKindInfo(target.kind)?.label ?? target.kind}.{" "}
        <button className={`${textButton} underline`} onClick={startEditing} disabled={busy}>
          Switch to {info.label}
        </button>
      </p>
    );
  } else {
    body = (
      <div className="space-y-2">
        {kind === "claude-routine" ? (
          <p className="text-sm text-muted">
            <a href={ROUTINES_URL} target="_blank" rel="noreferrer" className={link}>
              <strong className="font-semibold text-ink">claude.ai → Code → Routines → New routine</strong>
              <Icon name="open_in_new" className="ml-0.5 text-[14px] text-muted" />
            </a>{" "}
            with{" "}
            <button className="cursor-pointer underline hover:text-ink" onClick={copyPrompt}>
              {promptCopied ? "prompt copied" : "this prompt"}
            </button>{" "}
            and the Vapor connector. Add an API trigger, then paste its URL and token.
          </p>
        ) : (
          <p className="text-sm text-muted">
            A JSON POST for each mention or reply, with a <code className="font-mono">text</code> field saying what
            happened. A <code className="font-mono">whsec_</code> secret signs it; any other secret is sent as a
            bearer token.
          </p>
        )}
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={maybeSave}
            onKeyDown={onFieldKeyDown}
            placeholder={info.urlPlaceholder}
            aria-label={info.urlLabel}
            spellCheck={false}
            className="min-w-0 flex-1"
          />
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onBlur={maybeSave}
            onKeyDown={onFieldKeyDown}
            placeholder={info.secretOptional ? `${info.secretLabel} (optional)` : info.secretLabel}
            aria-label={info.secretLabel}
            autoComplete="off"
            spellCheck={false}
            className="w-36 shrink-0"
          />
        </div>
        {busy && <p className="text-sm text-muted">Saving…</p>}
        {target && !busy && (
          <button className={textButton} onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="border-t border-border pt-4">
      <h2 className="mb-2 text-lg font-medium">{title}</h2>
      {body}
      {signedIn && docId && target && !mine && !editing && (
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
