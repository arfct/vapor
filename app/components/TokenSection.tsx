import { useCallback, useEffect, useState } from "react";
import { useSession } from "~/lib/useSession";
import { timeAgo } from "~/lib/time-ago";
import { Input } from "~/components/ui/input";
import { SnippetRow } from "~/components/ui/dialog";
import type { AccessTokenView, TokenGrant } from "~/shared/token-policy";

const textButton = "cursor-pointer text-sm text-muted transition-colors hover:text-ink";

/**
 * Personal access tokens (#85), inside the invite dialog: for a fleet of
 * harnesses or a headless machine where a browser sign-in per install is
 * the wrong shape. A signed-in person mints a token with a label and a
 * grant, sees it once, and pastes it as a bearer; the list here revokes.
 */
export default function TokenSection({ mcpUrl }: { mcpUrl: string }) {
  const session = useSession();
  const signedIn = session?.signedIn === true;
  const [tokens, setTokens] = useState<AccessTokenView[] | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [grant, setGrant] = useState<TokenGrant>("suggest");
  const [fresh, setFresh] = useState<{ token: string; view: AccessTokenView } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch("/me/tokens")
      .then((r) => (r.ok ? r.json() : { tokens: [] }))
      .then((data) => {
        if (!cancelled) setTokens((data as { tokens: AccessTokenView[] }).tokens);
      })
      .catch(() => {
        if (!cancelled) setTokens([]);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const create = useCallback(async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/me/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, grant }),
      });
      const data = (await res.json()) as { token?: string; view?: AccessTokenView; error?: string };
      if (!res.ok || !data.token || !data.view) {
        setError(data.error ?? "Could not create the token.");
        return;
      }
      setFresh({ token: data.token, view: data.view });
      setTokens((list) => [...(list ?? []), data.view!]);
      setCreating(false);
      setLabel("");
    } catch {
      setError("Could not create the token.");
    } finally {
      setBusy(false);
    }
  }, [label, grant, busy]);

  const revoke = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await fetch(`/me/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setTokens((list) => (list ?? []).filter((t) => t.id !== id));
      setFresh((f) => (f?.view.id === id ? null : f));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!signedIn) {
    return (
      <section className="border-t border-border pt-4">
        <h2 className="mb-2 text-lg font-medium">Access token</h2>
        <p className="text-sm text-muted">
          Sign in to mint a long-lived token: one secret for every machine your agents run on, no browser in the loop.
        </p>
      </section>
    );
  }

  return (
    <section className="border-t border-border pt-4">
      <h2 className="mb-2 text-lg font-medium">Access token</h2>
      <p className="text-sm text-muted">
        For a headless machine or a fleet of harnesses: a long-lived token sent as{" "}
        <code className="font-mono">Authorization: Bearer</code> to {mcpUrl.replace(/^https?:\/\//, "")}. Same
        identity and agent as signing in; revoke it here.
      </p>

      {fresh && (
        <div className="mt-3 space-y-2">
          <SnippetRow label={`${fresh.view.label} — copy it now, it is not shown again`} text={fresh.token} />
          <SnippetRow label="Header" text={`Authorization: Bearer ${fresh.token}`} />
        </div>
      )}

      {tokens === undefined ? (
        <p className="mt-3 text-sm text-muted">Loading…</p>
      ) : tokens.length > 0 ? (
        <ul className="mt-3 divide-y divide-border">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {t.label} <span className="font-mono text-muted">…{t.hint}</span>
              </span>
              <span className="shrink-0 text-xs text-muted">
                {t.caps.includes("write") ? "write" : "suggest"} ·{" "}
                {t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : "unused"}
              </span>
              <button className={`${textButton} shrink-0 hover:text-coral`} onClick={() => revoke(t.id)} disabled={busy}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {creating ? (
        <div className="mt-3 flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
            placeholder="Label, e.g. build server"
            aria-label="Token label"
            className="min-w-0 flex-1"
            autoFocus
          />
          <select
            aria-label="Grant"
            value={grant}
            onChange={(e) => setGrant(e.target.value as TokenGrant)}
            className="cursor-pointer border border-border bg-paper px-2 text-sm"
          >
            <option value="suggest">Suggest &amp; comment</option>
            <option value="write">Full write</option>
          </select>
          <button className={textButton} onClick={() => void create()} disabled={busy || !label.trim()}>
            Create
          </button>
          <button className={textButton} onClick={() => setCreating(false)} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : (
        <button className={`${textButton} mt-3`} onClick={() => setCreating(true)} disabled={busy}>
          New token
        </button>
      )}
      {error && <p className="mt-2 text-sm text-coral">{error}</p>}
    </section>
  );
}
