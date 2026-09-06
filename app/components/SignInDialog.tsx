import { useEffect, useState } from "react";
import Dialog from "~/components/ui/dialog";
import { useSession, notifyAuthChanged } from "~/lib/useSession";
import { useTheme } from "~/lib/useTheme";
import { signInWithApple } from "~/lib/apple-signin";

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

// Dialog content width: 420px shell, 24px padding each side. Google's button
// takes a pixel width; Apple's is ours and stretches.
const BUTTON_WIDTH_PX = 420 - 2 * 24;

// The Apple mark, from Simple Icons (CC0), for the Sign in with Apple button.
const APPLE_MARK =
  "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701";

type Providers = { googleClientId?: string; appleClientId?: string };

/**
 * The sign-in dialog: one button per provider the instance has configured
 * (Google via GSI, Apple via its popup flow), the same shell as New document
 * and Invite an agent. Opened from the menu's Sign in row, from a
 * `vapor://signin` link in a document, or by anything that needs a session
 * (a dropped file while signed out). Closes itself once a session exists.
 */
export default function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Sign in">
      {open && <SignInBody onClose={onClose} />}
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so provider state starts fresh each time. */
function SignInBody({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const { theme } = useTheme();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  // State, not a ref: the host mounts a render after `open` flips, so the
  // effect must re-run once the element exists.
  const [googleHost, setGoogleHost] = useState<HTMLDivElement | null>(null);

  // Signing in (here or anywhere) is the dialog's exit.
  useEffect(() => {
    if (session?.signedIn) onClose();
  }, [session?.signedIn, onClose]);

  // Which providers, then Google's button into its host.
  useEffect(() => {
    if (session?.signedIn || !googleHost) return;
    let cancelled = false;
    const host = googleHost;

    const markUnavailable = () => {
      if (!cancelled) setUnavailable(true);
    };
    const fallbackTimer = window.setTimeout(() => {
      if (host.childElementCount === 0) markUnavailable();
    }, GSI_FALLBACK_DELAY_MS);

    async function mount() {
      let config: Providers;
      try {
        config = (await fetch("/auth/config").then((r) => r.json())) as Providers;
      } catch {
        markUnavailable();
        return;
      }
      if (cancelled) return;
      setProviders(config);
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
          theme === "dark" || (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        window.google.accounts.id.renderButton(host, {
          theme: dark ? "filled_black" : "outline",
          width: BUTTON_WIDTH_PX,
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
  }, [session?.signedIn, theme, googleHost]);

  async function appleSignIn() {
    const clientId = providers?.appleClientId;
    if (!clientId || appleBusy) return;
    setAppleBusy(true);
    try {
      if (await signInWithApple(clientId)) notifyAuthChanged();
    } catch {
      setUnavailable(true);
    } finally {
      setAppleBusy(false);
    }
  }

  const none = providers !== null && !providers.googleClientId && !providers.appleClientId;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Optional. Your name and face go on your edits and comments instead of an animal, agents you
        connect act as yours, and you can attach files. Nothing else changes: documents stay open to
        anyone with the link.
      </p>

      {unavailable ? (
        <p className="text-sm text-muted">Sign-in needs a full browser — open this page in Safari or Chrome.</p>
      ) : none ? (
        <p className="text-sm text-muted">This instance has no sign-in provider configured.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div ref={setGoogleHost} />
          {providers?.appleClientId && (
            <button
              type="button"
              onClick={appleSignIn}
              disabled={appleBusy}
              className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded bg-ink text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d={APPLE_MARK} />
              </svg>
              Sign in with Apple
            </button>
          )}
        </div>
      )}
    </div>
  );
}
