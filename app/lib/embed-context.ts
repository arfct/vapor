import { useEffect, useRef } from "react";
import { isEmbedHost } from "~/shared/embed-hosts";

// What is on screen, told to an embedding host (#121,
// docs/plans/2026-11-21-embed-context-plan.md). A page framed by one of the
// instance's EMBED_HOSTS, or shown in an app's embedded WebView, posts the
// host one message describing the view: the URL, a title, the selected
// text, and the records shown by the ids the MCP tools take. Each message
// replaces the last; the host never answers.

/** The protocol's message type. */
export const EMBED_MESSAGE_TYPE = "embed:context";

/** A record on screen: an id the API's tools take, its kind, and its name. */
export interface EmbedItem {
  id: string;
  type: string;
  name?: string | null;
}

/** What a page reports: what a person calls the view, and the records in it, most relevant first. */
export interface EmbedContext {
  title?: string | null;
  items?: EmbedItem[];
}

export interface EmbedMessage {
  type: typeof EMBED_MESSAGE_TYPE;
  url: string;
  title?: string;
  selection?: string;
  items?: { id: string; type: string; name?: string }[];
}

export const LIMITS = { title: 200, name: 200, selection: 2000, items: 20 } as const;
const TOKEN = /^[A-Za-z0-9_.:-]{1,100}$/;

/** At most max code points, never half a surrogate pair. */
function cut(s: string, max: number): string {
  const points = Array.from(s);
  return points.length > max ? points.slice(0, max).join("") : s;
}

/** One line: breaks, tabs and other control characters become spaces, runs collapse, at most max code points. */
export function oneLine(value: unknown, max: number = LIMITS.title): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return cut(flat, max).trim();
}

/** Plain text as selected: control characters other than line breaks and tabs removed, at most max code points; "" when blank. */
export function plainText(value: unknown, max: number = LIMITS.selection): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
  return text.trim() ? cut(text, max) : "";
}

/** The items as sent: valid tokens only (an item with a bad id or type is dropped, not mangled), no repeats, at most 20. */
export function embedItems(items: readonly EmbedItem[] | undefined | null): { id: string; type: string; name?: string }[] {
  const out: { id: string; type: string; name?: string }[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    if (out.length >= LIMITS.items) break;
    if (!item || typeof item.id !== "string" || typeof item.type !== "string") continue;
    if (!TOKEN.test(item.id) || !TOKEN.test(item.type)) continue;
    const key = `${item.type}\u0000${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = oneLine(item.name, LIMITS.name);
    out.push(name ? { id: item.id, type: item.type, name } : { id: item.id, type: item.type });
  }
  return out;
}

/** The message for a URL, a page's context, and the selected text. */
export function embedMessage(url: string, context: EmbedContext | null, selection: unknown): EmbedMessage {
  const msg: EmbedMessage = { type: EMBED_MESSAGE_TYPE, url };
  const title = oneLine(context?.title, LIMITS.title);
  if (title) msg.title = title;
  const sel = plainText(selection);
  if (sel) msg.selection = sel;
  const items = embedItems(context?.items);
  if (items.length) msg.items = items;
  return msg;
}

/**
 * A document page's context: its title (the first heading, as the tab shows
 * it), the document by the id `doc_id` takes, then the open comment thread
 * by the id `thread_id` takes.
 */
export function documentContext(
  doc: { id: string; title: string | null },
  thread?: { id: string; commentText: string } | null,
): EmbedContext {
  const title = oneLine(doc.title) || "Untitled";
  const items: EmbedItem[] = [{ id: doc.id, type: "document", name: title }];
  if (thread) items.push({ id: thread.id, type: "thread", name: thread.commentText });
  return { title, items };
}

/**
 * Whether a user agent is an app's embedded WebView: Android's marks itself
 * "; wv)", and an iOS WebKit view leaves out the "Safari/" every iOS
 * browser (Safari, Chrome, Firefox, Edge) sends.
 */
export function isEmbeddedWebView(userAgent: string): boolean {
  if (/; wv\)/.test(userAgent)) return true;
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent) && /AppleWebKit\//.test(userAgent) && !/Safari\//.test(userAgent);
}

/** What the page knows about where it is shown. */
export interface Placement {
  /** window.parent !== window. */
  framed: boolean;
  /** location.ancestorOrigins[0], where the browser has it. */
  ancestor: string | null;
  /** document.referrer. */
  referrer: string;
  /** The host remembered for this tab, for a reload inside the frame. */
  remembered: string | null;
  /** location.origin. */
  self: string;
  userAgent: string;
  /** The instance's EMBED_HOSTS. */
  hosts: readonly string[];
}

function originOf(url: string): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/**
 * The origin to post to, or null to stay quiet. Framed: the framing page's
 * origin when it is an embedding host. Not framed: the page's own origin in
 * an app's embedded WebView; a browser tab stays quiet. An instance with no
 * hosts never posts.
 */
export function embedTarget(p: Placement): string | null {
  if (!p.hosts.length) return null;
  if (!p.framed) return isEmbeddedWebView(p.userAgent) ? p.self : null;
  const fromReferrer = originOf(p.referrer);
  // A reload inside the frame leaves our own address as the referrer.
  const origin = p.ancestor ?? (fromReferrer && fromReferrer !== p.self ? fromReferrer : p.remembered);
  return origin && isEmbedHost(origin, p.hosts) ? origin : null;
}

// The page's side: each page reports its context; the deepest one mounted wins.

interface Entry {
  level: number;
  seq: number;
  context: EmbedContext;
}

const entries = new Map<symbol, Entry>();
let seq = 0;
let schedule: () => void = () => {};

/** Ask for a send (debounced). Anything that rewrites the URL itself calls this. */
export function notifyEmbedContext(): void {
  schedule();
}

/** The context the deepest page reports, else the document's title. */
function current(): EmbedContext {
  let best: Entry | null = null;
  for (const e of entries.values()) {
    if (!best || e.level > best.level || (e.level === best.level && e.seq > best.seq)) best = e;
  }
  if (best) return best.context;
  return { title: document.title.replace(/\s*·\s*vapor$/, "") };
}

/** Reports what this page shows to an embedding host, while mounted. A page inside another passes a higher level. */
export function useEmbedContext(context: EmbedContext | null, level = 1): void {
  const key = useRef<symbol | null>(null);
  const json = context ? JSON.stringify(context) : null;
  useEffect(() => {
    if (json == null) return;
    const id = (key.current ??= Symbol("embed-context"));
    entries.set(id, { level, seq: ++seq, context: JSON.parse(json) as EmbedContext });
    schedule();
    return () => {
      entries.delete(id);
      schedule();
    };
  }, [json, level]);
}

const REMEMBER = "vapor-embed-host";
export const EMBED_DEBOUNCE_MS = 250;

/**
 * Starts telling the host, when there is one: on popstate, hashchange,
 * selectionchange, a page's new context, and whatever calls
 * notifyEmbedContext (router navigations, the app's own URL rewrites), 250 ms
 * after the last of them. Returns the stop.
 */
export function startEmbedContext(hosts: readonly string[]): () => void {
  let remembered: string | null = null;
  try {
    remembered = window.sessionStorage.getItem(REMEMBER);
  } catch {
    // Storage off: a reload inside the frame finds the host by ancestor or referrer alone.
  }
  const framed = window.parent !== window;
  const target = embedTarget({
    framed,
    ancestor: location.ancestorOrigins?.[0] ?? null,
    referrer: document.referrer,
    remembered,
    self: location.origin,
    userAgent: navigator.userAgent,
    hosts,
  });
  if (target == null) return () => {};
  if (framed) {
    try {
      window.sessionStorage.setItem(REMEMBER, target);
    } catch {
      // As above.
    }
  }
  const into = framed ? window.parent : window;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const post = () => {
    timer = null;
    into.postMessage(embedMessage(location.href, current(), String(document.getSelection() ?? "")), target);
  };
  schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(post, EMBED_DEBOUNCE_MS);
  };
  const on = () => schedule();
  window.addEventListener("popstate", on);
  window.addEventListener("hashchange", on);
  document.addEventListener("selectionchange", on);
  schedule();
  return () => {
    window.removeEventListener("popstate", on);
    window.removeEventListener("hashchange", on);
    document.removeEventListener("selectionchange", on);
    if (timer) clearTimeout(timer);
    schedule = () => {};
  };
}
