import { useCallback, useEffect, useState } from "react";
import Dialog from "~/components/ui/dialog";
import Icon from "~/components/Icon";
import { Input } from "~/components/ui/input";
import { useSession } from "~/lib/useSession";
import { timeAgo } from "~/lib/time-ago";
import type { DevicesView, SendTarget } from "~/shared/device-policy";

type View = { devices: DevicesView; kindleMail: { from: string } | null };

const textButton = "cursor-pointer text-sm text-muted transition-colors hover:text-ink disabled:opacity-50";
const primary =
  "flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded bg-ink px-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50";

/**
 * Send to Kindle / reMarkable (#100): the document as an EPUB, delivered.
 * Kindle takes it by email to the reader's @kindle.com address (when the
 * instance can send mail); reMarkable through its cloud after a one-time
 * pairing. Both settings are saved once per account. Download EPUB works
 * for anyone, signed in or not.
 */
export default function SendDialog({ open, onClose, docId }: { open: boolean; onClose: () => void; docId: string }) {
  return (
    <Dialog open={open} onClose={onClose} title="Send to device">
      {open && <SendBody docId={docId} />}
    </Dialog>
  );
}

function SendBody({ docId }: { docId: string }) {
  const session = useSession();
  const signedIn = session?.signedIn === true;
  const [view, setView] = useState<View | undefined>(undefined);
  const [kindleInput, setKindleInput] = useState("");
  const [editingKindle, setEditingKindle] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<SendTarget | "kindle-save" | "pair" | null>(null);
  const [note, setNote] = useState<Partial<Record<SendTarget, string>>>({});
  const [error, setError] = useState<Partial<Record<SendTarget, string>>>({});
  const epubHref = `/${docId}.epub`;

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch("/me/devices")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setView(data as View);
      })
      .catch(() => {
        if (!cancelled) setView({ devices: { kindleEmail: null, remarkable: null }, kindleMail: null });
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const call = useCallback(async (method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  }, []);

  const saveKindle = useCallback(async () => {
    setBusy("kindle-save");
    setError((e) => ({ ...e, kindle: undefined }));
    const { ok, data } = await call("PUT", "/me/devices", { kindle: kindleInput });
    if (ok) {
      setView(data as unknown as View);
      setEditingKindle(false);
    } else setError((e) => ({ ...e, kindle: String(data.error ?? "Could not save") }));
    setBusy(null);
  }, [call, kindleInput]);

  const pair = useCallback(async () => {
    setBusy("pair");
    setError((e) => ({ ...e, remarkable: undefined }));
    const { ok, data } = await call("POST", "/me/devices", { remarkable: { code } });
    if (ok) {
      setView(data as unknown as View);
      setCode("");
    } else setError((e) => ({ ...e, remarkable: String(data.error ?? "Could not pair") }));
    setBusy(null);
  }, [call, code]);

  const forget = useCallback(
    async (target: SendTarget) => {
      const { ok, data } = await call("DELETE", `/me/devices?target=${target}`);
      if (ok) setView(data as unknown as View);
    },
    [call],
  );

  const send = useCallback(
    async (target: SendTarget) => {
      setBusy(target);
      setError((e) => ({ ...e, [target]: undefined }));
      setNote((n) => ({ ...n, [target]: undefined }));
      const { ok, data } = await call("POST", `/${docId}/send`, { target });
      if (ok) {
        setNote((n) => ({ ...n, [target]: target === "kindle" ? `Sent to ${String(data.to)}. It shows up on the Kindle in a minute or two.` : "Sent. It shows up in the reMarkable's root folder shortly." }));
      } else setError((e) => ({ ...e, [target]: String(data.error ?? "Could not send") }));
      setBusy(null);
    },
    [call, docId],
  );

  const devices = view?.devices;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        The document as an EPUB, with tracked changes accepted and comments left out. Anyone can download it; sending needs a
        signed-in account to remember where.
      </p>

      {/* Kindle */}
      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="text-lg font-medium">Kindle</h2>
        {!signedIn ? (
          <p className="text-sm text-muted">Sign in to save your Send to Kindle address.</p>
        ) : view === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !view.kindleMail ? (
          <p className="text-sm text-muted">
            This vapor cannot send email. Download the EPUB below and add it at{" "}
            <a href="https://www.amazon.com/sendtokindle" target="_blank" rel="noreferrer" className="underline">
              amazon.com/sendtokindle
            </a>
            .
          </p>
        ) : devices?.kindleEmail && !editingKindle ? (
          <div className="space-y-2">
            <p className="text-sm">
              Sends to <span className="font-mono">{devices.kindleEmail}</span>
              <span className="text-muted"> from {view.kindleMail.from}</span>.
            </p>
            <div className="flex items-center gap-4">
              <button className={primary} onClick={() => send("kindle")} disabled={busy !== null}>
                <Icon name="send" className="text-[18px]" />
                {busy === "kindle" ? "Sending…" : "Send to Kindle"}
              </button>
              <button className={textButton} onClick={() => { setKindleInput(devices.kindleEmail ?? ""); setEditingKindle(true); }} disabled={busy !== null}>
                Change
              </button>
              <button className={`${textButton} hover:text-coral`} onClick={() => forget("kindle")} disabled={busy !== null}>
                Forget
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Your address is under Amazon → Content &amp; Devices → Preferences → Personal Document Settings. Add{" "}
              <span className="font-mono text-ink">{view.kindleMail.from}</span> to your approved senders there, once.
            </p>
            <div className="flex gap-2">
              <Input
                value={kindleInput}
                onChange={(e) => setKindleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveKindle();
                  }
                }}
                placeholder="name@kindle.com"
                aria-label="Send to Kindle address"
                spellCheck={false}
                className="min-w-0 flex-1"
              />
              <button className={textButton} onClick={() => void saveKindle()} disabled={busy !== null || !kindleInput.trim()}>
                Save
              </button>
              {editingKindle && (
                <button className={textButton} onClick={() => setEditingKindle(false)} disabled={busy !== null}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
        {note.kindle && <p className="text-sm text-muted">{note.kindle}</p>}
        {error.kindle && <p className="text-sm text-coral">{error.kindle}</p>}
      </section>

      {/* reMarkable */}
      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="text-lg font-medium">reMarkable</h2>
        {!signedIn ? (
          <p className="text-sm text-muted">Sign in to pair your reMarkable.</p>
        ) : view === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : devices?.remarkable ? (
          <div className="space-y-2">
            <p className="text-sm">
              Paired <span className="text-muted">{timeAgo(devices.remarkable.pairedAt)}</span>.
            </p>
            <div className="flex items-center gap-4">
              <button className={primary} onClick={() => send("remarkable")} disabled={busy !== null}>
                <Icon name="send" className="text-[18px]" />
                {busy === "remarkable" ? "Sending…" : "Send to reMarkable"}
              </button>
              <button className={`${textButton} hover:text-coral`} onClick={() => forget("remarkable")} disabled={busy !== null}>
                Unpair
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Get a one-time code at{" "}
              <a href="https://my.remarkable.com/device/desktop/connect" target="_blank" rel="noreferrer" className="underline">
                my.remarkable.com/device/desktop/connect
              </a>{" "}
              and paste it here. Pairing lasts until you unpair.
            </p>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void pair();
                  }
                }}
                placeholder="8-character code"
                aria-label="reMarkable one-time code"
                spellCheck={false}
                autoComplete="off"
                className="w-44"
              />
              <button className={textButton} onClick={() => void pair()} disabled={busy !== null || code.trim().length !== 8}>
                {busy === "pair" ? "Pairing…" : "Pair"}
              </button>
            </div>
          </div>
        )}
        {note.remarkable && <p className="text-sm text-muted">{note.remarkable}</p>}
        {error.remarkable && <p className="text-sm text-coral">{error.remarkable}</p>}
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <a href={epubHref} className="dialog-row flex items-center gap-3 border border-border px-4 py-3 text-left transition-colors hover:bg-accent">
          <Icon name="menu_book" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Download EPUB</span>
            <span className="block text-sm text-muted">For any reader, or amazon.com/sendtokindle and my.remarkable.com.</span>
          </span>
        </a>
        <a
          href={`/${docId}/print?print=1`}
          target="_blank"
          rel="noreferrer"
          className="dialog-row flex items-center gap-3 border border-border px-4 py-3 text-left transition-colors hover:bg-accent"
        >
          <Icon name="print" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Print or save as PDF</span>
            <span className="block text-sm text-muted">Opens a clean copy and the print dialog; choose Save as PDF there.</span>
          </span>
        </a>
      </section>
    </div>
  );
}
