import { useCallback, useEffect, useRef, useState } from "react";

interface Session {
  signedIn: boolean;
  displayName?: string;
}

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
 * popover and loads Google Identity Services on demand (never on every doc
 * view). Signed in: the display name plus sign-out. Optional everywhere —
 * anonymous users never see more than the button.
 */
export default function SignIn() {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const buttonHost = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => {
    fetch("/auth/me")
      .then((r) => r.json())
      .then((s) => setSession(s as Session))
      .catch(() => setSession({ signedIn: false }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Load GSI and render the Google button only when the popover opens.
  useEffect(() => {
    if (!open || !buttonHost.current) return;
    let cancelled = false;

    async function mount() {
      const config = (await fetch("/auth/config").then((r) => r.json())) as { googleClientId?: string };
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
              refresh();
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
  }, [open, refresh]);

  async function signOut() {
    await fetch("/auth/logout", { method: "POST" });
    refresh();
  }

  if (session?.signedIn) {
    return (
      <div className="flex items-center gap-2 px-3">
        <span className="text-sm">{session.displayName}</span>
        <button onClick={signOut} className="cursor-pointer text-sm text-muted hover:text-ink">
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-full cursor-pointer items-center px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
      >
        Sign in
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 border border-border bg-paper p-4 shadow-lg">
          <div ref={buttonHost} />
        </div>
      )}
    </div>
  );
}
