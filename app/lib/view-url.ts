import { notifyEmbedContext } from "~/lib/embed-context";

// Every view a URL (#121). The views a person can reach on a document page
// (an open comment thread, a dialog, the markdown view) live in query
// parameters, written with replaceState so Back still leaves the document,
// and read on load so a reload at the URL comes back to the same view.

/** The dialogs a URL can open: `?dialog=<name>`. History and Send exist only on a document. */
export const DIALOGS = ["invite", "new", "history", "send", "signin"] as const;
export type DialogName = (typeof DIALOGS)[number];

/** The dialog a `?dialog=` value names, or null. */
export function parseDialog(value: string | null | undefined, onDocument: boolean): DialogName | null {
  const name = DIALOGS.find((d) => d === value) ?? null;
  if (!onDocument && (name === "history" || name === "send")) return null;
  return name;
}

/** A thread id as `?thread=` carries it: `t-` and the hash (app/shared/thread-id.ts). */
export function parseThreadParam(value: string | null | undefined): string | null {
  return value && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : null;
}

/** `search` with one parameter set, or removed when the value is null; "" or "?…". */
export function withParam(search: string, name: string, value: string | null): string {
  const params = new URLSearchParams(search);
  if (value === null) params.delete(name);
  else params.set(name, value);
  const out = params.toString();
  return out ? `?${out}` : "";
}

/** A query parameter of the current URL. Null on the server. */
export function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * Rewrite the visible URL without navigating (the router isn't involved)
 * and tell the embedding host, if any. Keeps the history entry's state,
 * which the router keys on.
 */
export function replaceUrl(url: string): void {
  if (typeof window === "undefined") return;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (url !== current) window.history.replaceState(window.history.state, "", url);
  notifyEmbedContext();
}

/** Set (or with null, drop) one query parameter of the current URL. */
export function setParam(name: string, value: string | null): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  replaceUrl(`${pathname}${withParam(search, name, value)}${hash}`);
}
