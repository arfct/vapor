import { useEffect, useState } from "react";

export interface Session {
  signedIn: boolean;
  principal?: string;
  email?: string;
  displayName?: string;
  agentSlug?: string | null;
  avatar?: string | null;
}

const AUTH_CHANGED = "vapor:auth-changed";

/**
 * Notify every `useSession` in the tab that sign-in state changed, so
 * presence, comments, and the header update immediately instead of waiting
 * for a reload. SignIn calls this after login/logout.
 */
export function notifyAuthChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGED));
  }
}

/**
 * Shared reactive view of `/auth/me`. Re-fetches when `notifyAuthChanged`
 * fires, so signing in mid-session updates the whole page without a reload.
 * Returns `null` until the first fetch resolves.
 */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/auth/me")
        .then((r) => r.json())
        .then((raw) => {
          if (!cancelled) setSession(raw as Session);
        })
        .catch(() => {
          if (!cancelled) setSession({ signedIn: false });
        });
    };
    load();
    window.addEventListener(AUTH_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED, load);
    };
  }, []);

  return session;
}
