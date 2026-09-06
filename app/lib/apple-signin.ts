/**
 * Sign in with Apple, browser side. Loads Apple's JS toolkit on demand,
 * runs the popup flow, and posts the result to `/auth/apple`, which verifies
 * the ID token and mints the session. The consent page (app/lib/oauth-pages.ts)
 * carries an inline copy of the same steps, since it is a string template.
 */

const APPLE_JS_URL = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

export interface AppleAuthorization {
  authorization: { id_token: string; code: string; state?: string };
  /** Present on the first authorization only. */
  user?: { name?: { firstName?: string; lastName?: string }; email?: string };
}

declare global {
  interface Window {
    AppleID?: {
      auth: {
        init: (opts: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }) => void;
        signIn: () => Promise<AppleAuthorization>;
      };
    };
  }
}

let loading: Promise<void> | null = null;

/** Loads Apple's toolkit once; rejects if the script cannot load (webviews, blockers). */
export function loadAppleJs(): Promise<void> {
  if (window.AppleID) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = APPLE_JS_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("apple js failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Runs the popup flow and completes sign-in on the server. Resolves true on
 * a new session, false when the person closed the popup or the server
 * rejected the token. `redirectURI` must be one of the return URLs
 * registered on the Services ID; `<origin>/auth/apple` is the convention.
 */
export async function signInWithApple(clientId: string, origin = window.location.origin): Promise<boolean> {
  await loadAppleJs();
  const apple = window.AppleID;
  if (!apple) return false;
  apple.auth.init({ clientId, scope: "name email", redirectURI: `${origin}/auth/apple`, usePopup: true });
  let result: AppleAuthorization;
  try {
    result = await apple.auth.signIn();
  } catch {
    // Apple rejects with { error: "popup_closed_by_user" } and friends.
    return false;
  }
  const res = await fetch("/auth/apple", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: result.authorization.id_token, user: result.user }),
  });
  return res.ok;
}
