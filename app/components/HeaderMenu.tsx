import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
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

// In-app webviews block Google Identity Services (disallowed_useragent): the
// script never loads or renderButton leaves the host empty. Past this delay
// with nothing rendered, show a note instead of an empty slot.
const GSI_FALLBACK_DELAY_MS = 2500;

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
  const [signInUnavailable, setSignInUnavailable] = useState(false);
  // State, not a ref: the popover portal mounts a render after `open`
  // flips, so the effect must re-run once the host element exists.
  const [buttonHost, setButtonHost] = useState<HTMLDivElement | null>(null);

  function handleOpenChange(next: boolean) {
    if (next) setSignInUnavailable(false);
    setOpen(next);
  }

  // Load Google Identity Services and render its button only while the menu
  // is open with no active session.
  useEffect(() => {
    if (!open || session?.signedIn || !buttonHost) return;
    let cancelled = false;
    const host = buttonHost;

    const markUnavailable = () => {
      if (!cancelled) setSignInUnavailable(true);
    };
    const fallbackTimer = window.setTimeout(() => {
      if (host.childElementCount === 0) markUnavailable();
    }, GSI_FALLBACK_DELAY_MS);

    async function mount() {
      let config: { googleClientId?: string };
      try {
        config = (await fetch("/auth/config").then((r) => r.json())) as typeof config;
      } catch {
        markUnavailable();
        return;
      }
      if (cancelled) return;
      if (!config.googleClientId) {
        // Not configured is a server-side gap, not a webview limitation.
        clearTimeout(fallbackTimer);
        return;
      }

      const render = () => {
        if (cancelled || !window.google) return;
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
        const dark =
          theme === "dark" ||
          (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        window.google.accounts.id.renderButton(host, {
          theme: dark ? "filled_black" : "outline",
          width: 220,
        });
      };

      if (window.google) {
        render();
      } else {
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.onload = render;
        s.onerror = markUnavailable;
        document.head.appendChild(s);
      }
    }
    mount();
    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
    };
  }, [open, session?.signedIn, theme, buttonHost]);

  async function signOut() {
    await fetch("/auth/logout", { method: "POST" });
    notifyAuthChanged();
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <button aria-label="Menu" className="header-button shrink-0">
            {session?.signedIn ? (
              <Avatar
                name={session.displayName ?? "?"}
                avatar={session.avatar}
                className="h-8 w-8"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center text-2xl leading-none">
                <Icon name="account_circle" />
              </span>
            )}
          </button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={0}
          collisionPadding={0}
          className="z-50"
        >
          <Popover.Popup className="w-64 border border-border bg-paper shadow-md outline-none">
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
              <div className="flex h-[64px] items-center px-4">
                {signInUnavailable ? (
                  <p className="text-sm text-muted">
                    Sign-in needs a full browser — open this page in Safari or Chrome.
                  </p>
                ) : (
                  <div ref={setButtonHost} />
                )}
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
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
