import { useEffect, useRef, useState } from "react";
import { useSession, notifyAuthChanged } from "~/lib/useSession";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/**
 * Header sign-in affordance. Signed out: a "Sign in" button that opens a
 * popover and loads Google Identity Services on demand. Signed in: the
 * avatar + display name plus sign-out. Optional everywhere.
 *
 * The button is a flush toolbar item (a direct sibling of the other header
 * controls); the popover is fixed-position so it never widens the
 * horizontally-scrolling header.
 */
export default function SignIn() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const buttonHost = useRef<HTMLDivElement | null>(null);

  // Load GSI and render the Google button only when the popover opens.
  useEffect(() => {
    if (!open || !buttonHost.current) return;
    let cancelled = false;

    async function mount() {
      const config = (await fetch("/auth/config").then((r) => r.json())) as {
        googleClientId?: string;
      };
      if (cancelled || !config.googleClientId) return;

      const render = () => {
        if (cancelled || !window.google || !buttonHost.current) return;
        window.google.accounts.id.initialize({
          client_id: config.googleClientId as string,
          callback: async (r) => {
            const res = await fetch("/auth/google", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: r.credential }),
            });
            if (res.ok) {
              setOpen(false);
              notifyAuthChanged();
            }
          },
        });
        window.google.accounts.id.renderButton(buttonHost.current, { theme: "outline" });
      };

      if (window.google) {
        render();
      } else {
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.onload = render;
        document.head.appendChild(s);
      }
    }
    mount();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function signOut() {
    await fetch("/auth/logout", { method: "POST" });
    notifyAuthChanged();
  }

  if (session?.signedIn) {
    return (
      <button
        onClick={signOut}
        title="Sign out"
        className="flex h-full shrink-0 cursor-pointer items-center gap-2 px-3 text-sm transition-colors hover:bg-border"
      >
        {session.avatar && <img className="author-avatar" src={session.avatar} alt="" />}
        <span className="whitespace-nowrap">{session.displayName}</span>
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-full shrink-0 cursor-pointer items-center px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
      >
        Sign in
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed right-2 top-12 z-50 border border-border bg-paper p-4 shadow-lg">
            <div ref={buttonHost} />
          </div>
        </>
      )}
    </>
  );
}
