import { useEffect, useRef, useState } from "react";
import { useSession, notifyAuthChanged } from "~/lib/useSession";
import { useTheme, type Theme } from "~/lib/useTheme";
import Icon from "~/components/Icon";
import Avatar from "~/components/Avatar";

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

const themeOptions: { value: Theme; icon: string; label: string }[] = [
  { value: "light", icon: "light_mode", label: "Light" },
  { value: "dark", icon: "dark_mode", label: "Dark" },
  { value: "auto", icon: "computer", label: "Auto" },
];

/**
 * The top-right header menu: connection status, the Agents panel, the
 * account row (Google sign-in or name + sign-out), and the theme switcher.
 */
export default function HeaderMenu() {
  const session = useSession();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const buttonHost = useRef<HTMLDivElement | null>(null);

  // Load Google Identity Services and render its button only while the menu
  // is open with no active session.
  useEffect(() => {
    if (!open || session?.signedIn || !buttonHost.current) return;
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
            if (res.ok) notifyAuthChanged();
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
  }, [open, session?.signedIn]);

  async function signOut() {
    await fetch("/auth/logout", { method: "POST" });
    notifyAuthChanged();
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        className="flex h-full w-12 shrink-0 cursor-pointer items-center justify-center transition-colors hover:bg-border"
      >
        {session?.signedIn ? (
          <Avatar
            name={session.displayName ?? "?"}
            avatar={session.avatar}
            className="h-8 w-8"
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center text-2xl leading-none text-muted">
            <Icon name="account_circle" />
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed right-2 top-12 z-50 w-64 border border-border bg-paper shadow-lg">
            {session?.signedIn ? (
              <div className="flex items-center gap-2 px-4 py-3">
                <Avatar
                  name={session.displayName ?? "?"}
                  avatar={session.avatar}
                  className="h-6 w-6"
                />
                <span className="min-w-0 truncate text-sm">{session.displayName}</span>
                <button
                  onClick={signOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="ml-auto cursor-pointer text-muted transition-colors hover:text-ink"
                >
                  <Icon name="logout" />
                </button>
              </div>
            ) : (
              <div className="px-4 py-3">
                <div ref={buttonHost} />
              </div>
            )}
            <div className="flex items-center border-t border-border px-4 py-3">
              <span className="text-sm text-muted">Theme</span>
              <div className="ml-auto flex gap-1">
                {themeOptions.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTheme(t.value)}
                    title={t.label}
                    aria-label={t.label}
                    className={`cursor-pointer px-1.5 py-0.5 transition-colors ${
                      theme === t.value ? "bg-border text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    <Icon name={t.icon} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
