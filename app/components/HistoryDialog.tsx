import { useCallback, useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { timeAgo } from "~/lib/time-ago";
import { reasonLabel, type VersionSummary } from "~/shared/version-policy";
import Dialog from "~/components/ui/dialog";
import Avatar from "~/components/Avatar";

/** Versions live under the document's agent path. */
export function versionsUrl(docId: string, suffix = ""): string {
  return `/agents/document-agent/${docId}/versions${suffix}`;
}

function sizeDelta(bytes: number, previous: number | undefined): string {
  if (previous === undefined) return "";
  const d = bytes - previous;
  if (d === 0) return "";
  return d > 0 ? `+${d}` : `${d}`;
}

function dayKey(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/**
 * The version history: a trail of markdown snapshots on the left, grouped
 * by day and attributed to whoever made the edits; the selected version's
 * markdown on the right, with Restore. "Now" is the live document, not a
 * stored version. The list refreshes on open and after a restore.
 */
export default function HistoryDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="History">
      <HistoryBody />
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so every opening starts fresh. */
function HistoryBody() {
  const { docId, markdown, yjs } = useDocument();
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ id: number; text: string } | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(versionsUrl(docId));
      setVersions(res.ok ? ((await res.json()) as VersionSummary[]) : []);
    } catch {
      setVersions([]);
    }
  }, [docId]);

  useEffect(() => {
    // Fetching on mount is the external sync this effect exists for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (selected === null) return;
    let cancelled = false;
    fetch(versionsUrl(docId, `/${selected}`))
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        if (!cancelled) setPreview({ id: selected, text });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docId, selected]);

  const user = {
    id: yjs.user.id,
    name: yjs.user.name,
    color: yjs.user.color,
    avatar: yjs.user.avatar,
    animal: yjs.user.animal,
  };

  const saveNow = async () => {
    const res = await fetch(versionsUrl(docId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setNotice(
      body.error === "unchanged"
        ? "Nothing has changed since the last version."
        : null,
    );
    await load();
  };

  const restore = async () => {
    if (selected === null) return;
    const res = await fetch(versionsUrl(docId, `/${selected}/restore`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setConfirming(false);
    if (!res.ok) {
      setNotice(
        body.error === "rate_limited"
          ? "Give it a few seconds between restores."
          : "That version couldn't be restored.",
      );
      return;
    }
    setNotice("Restored. The text as it was is saved as a version too.");
    setSelected(null);
    await load();
  };

  const rows = versions.map((v, i) => ({
    v,
    delta: sizeDelta(v.bytes, versions[i + 1]?.bytes),
  }));
  const days = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = dayKey(row.v.createdAt);
    days.set(key, [...(days.get(key) ?? []), row]);
  }
  const current =
    selected === null
      ? null
      : (versions.find((v) => v.id === selected) ?? null);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
      <div className="min-w-0 sm:w-64 sm:shrink-0">
        <button
          onClick={() => setSelected(null)}
          className={`flex w-full cursor-pointer items-center gap-2 px-2 py-2 text-left text-sm ${
            selected === null ? "bg-accent" : "hover:bg-accent"
          }`}
        >
          <span className="font-medium">Now</span>
          <span className="ml-auto text-muted">{markdown.length} chars</span>
        </button>
        {[...days.entries()].map(([day, list]) => (
          <div key={day}>
            <div className="px-2 pb-1 pt-3 text-xs uppercase tracking-wider text-muted">
              {day}
            </div>
            {list.map(({ v, delta }) => (
              <button
                key={v.id}
                onClick={() => {
                  setSelected(v.id);
                  setConfirming(false);
                }}
                className={`flex w-full cursor-pointer items-start gap-2 px-2 py-2 text-left text-sm ${
                  selected === v.id ? "bg-accent" : "hover:bg-accent"
                }`}
              >
                <Avatar
                  name={v.author.name}
                  avatar={v.author.avatar}
                  animal={v.author.animal}
                  color={v.author.color}
                  shape={v.author.kind === "agent" ? "hexagon" : "circle"}
                  className="mt-0.5 h-6 w-6"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-medium">
                      {v.author.name}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted">
                      {timeAgo(v.createdAt)}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-2 text-xs text-muted">
                    <span className="truncate">
                      {reasonLabel(v.reason, v.author.name)}
                    </span>
                    {delta && (
                      <span className="ml-auto shrink-0 font-mono">
                        {delta}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
        {versions.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted">
            No versions yet. One is kept each time the text settles.
          </p>
        )}
        <button
          onClick={saveNow}
          className="mt-3 w-full cursor-pointer border border-border px-3 py-2 text-sm hover:bg-accent"
        >
          Save version now
        </button>
      </div>

      <div className="min-w-0 flex-1">
        {notice && <p className="mb-3 text-sm text-muted">{notice}</p>}
        {current ? (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm text-muted">
                {reasonLabel(current.reason, current.author.name)} ·{" "}
                {current.bytes} chars
              </span>
              {confirming ? (
                <span className="ml-auto flex items-center gap-2 text-sm">
                  <span className="text-muted">
                    Restore this version? The current text is saved first.
                  </span>
                  <button
                    onClick={restore}
                    className="cursor-pointer border border-ink bg-ink px-3 py-1 text-paper"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="cursor-pointer px-2 py-1 text-muted hover:text-ink"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  className="ml-auto cursor-pointer border border-border px-3 py-1 text-sm hover:bg-accent"
                >
                  Restore
                </button>
              )}
            </div>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap border border-border bg-border/20 p-3 font-mono text-xs leading-relaxed">
              {preview?.id === selected ? preview.text : ""}
            </pre>
          </>
        ) : (
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap border border-border bg-border/20 p-3 font-mono text-xs leading-relaxed">
            {markdown}
          </pre>
        )}
      </div>
    </div>
  );
}
