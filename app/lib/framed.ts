import { useEffect, useState } from "react";
import { withParam } from "~/lib/view-url";

// A page inside another site's frame (#121). An embedding host frames it
// sandboxed, without top-level navigation, and most sites and both sign-in
// providers refuse to be framed, so links that leave the site open a new
// tab, and sign-in runs in a new tab unless the browser grants the frame
// the person's own cookies.

/** Whether the page is inside a frame. False on the server. */
export function isFramed(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

/** Whether a click on this address, from inside a frame, should open a new tab: another site. */
export function opensOutside(href: URL, self: string): boolean {
  if (href.protocol !== "http:" && href.protocol !== "https:") return false;
  return href.origin !== self;
}

/** Calls back once, when the page has the focus (or is visible) again. */
function watchReturn(onReturn: () => void) {
  const back = () => {
    if (document.visibilityState === "hidden") return;
    window.removeEventListener("focus", back);
    document.removeEventListener("visibilitychange", back);
    onReturn();
  };
  window.addEventListener("focus", back);
  document.addEventListener("visibilitychange", back);
}

/**
 * Inside a frame, a plain click on a link to another site opens a new tab
 * instead of navigating the frame. Caught before the router's links see it.
 * Returns the uninstall.
 */
export function installFramedLinks(): () => void {
  if (!isFramed()) return () => {};
  const click = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
    // Links inside the editor are opened by the editor itself (app-links.ts).
    if (a.closest("[contenteditable=true]")) return;
    let href: URL;
    try {
      href = new URL(a.href, location.href);
    } catch {
      return;
    }
    if (!opensOutside(href, location.origin)) return;
    e.preventDefault();
    e.stopPropagation();
    window.open(href.href, "_blank", "noopener");
  };
  document.addEventListener("click", click, true);
  return () => document.removeEventListener("click", click, true);
}

/** This page, with the Sign in dialog open: where sign-in from a frame goes, in a new tab. */
export function signInUrl(loc: { pathname: string; search: string }): string {
  return `${loc.pathname}${withParam(withParam(loc.search, "thread", null), "dialog", "signin")}`;
}

/**
 * Inside a frame, whether the browser keeps the person's own cookies from
 * the page until they grant storage access (Safari, and Chrome with
 * third-party cookies off): document.hasStorageAccess() says no.
 */
export function useNeedsStorageAccess(framed: boolean): boolean {
  const [needs, setNeeds] = useState(false);
  useEffect(() => {
    if (!framed || typeof document.hasStorageAccess !== "function") return;
    let live = true;
    document.hasStorageAccess().then(
      (has) => {
        if (live) setNeeds(!has);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [framed]);
  return needs;
}

/**
 * Sign in from a frame, from a click. When the browser holds back the
 * person's cookies, ask for storage access and reload with the session it
 * lets through; refused (or not needed), open sign-in in a new tab and call
 * onReturn when the frame has the focus again, so the session is read anew.
 * Must run synchronously in the click, as requestStorageAccess requires.
 */
export function signInFromFrame(needsAccess: boolean, onReturn: () => void): void {
  const openTab = () => {
    window.open(signInUrl(window.location), "_blank", "noopener");
    watchReturn(onReturn);
  };
  if (needsAccess && typeof document.requestStorageAccess === "function") {
    document.requestStorageAccess().then(() => window.location.reload(), openTab);
    return;
  }
  openTab();
}
