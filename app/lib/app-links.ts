import { Extension } from "@tiptap/core";
import { Link as TiptapLink } from "@tiptap/extension-link";
import { Plugin } from "@tiptap/pm/state";

/** Links with this scheme are actions in the app, not places to navigate. */
export const APP_LINK_PROTOCOL = "vapor";

/**
 * The link mark, always rendered to open in a new tab. TipTap's own mark
 * reads `target` and `rel` back from the stored mark, and links imported
 * from markdown carry `target: null` (the `richSchema` mark has no reason
 * to know about tabs), which would win over the option's `_blank`. Here
 * the two attributes are kept on the mark for schema parity with the
 * server but never rendered from it; the element gets the option values.
 */
export const Link = TiptapLink.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      target: { default: null, rendered: false },
      rel: { default: null, rendered: false },
    };
  },
});

/** What the browser is told when a link in the text opens: a new tab that cannot reach back. */
export const NEW_TAB_FEATURES = "noopener,noreferrer";

type AppLinkHandler = (url: string) => void;

export interface AppLinksStorage {
  /** Read at event time, so the component can swap it as its state changes. */
  onAppLink: AppLinkHandler | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    appLinks: {
      /** Replace the handler a click or tap on an app link invokes. */
      setAppLinkHandler: (handler: AppLinkHandler | null) => ReturnType;
    };
  }
}

// Beyond this, a touch was a scroll (or a selection drag), not a tap.
const TAP_SLOP_PX = 10;

function touchPoint(event: TouchEvent): { x: number; y: number } | null {
  const t = event.changedTouches?.[0];
  return t ? { x: t.clientX, y: t.clientY } : null;
}

function hrefAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest("a[href]")?.getAttribute("href") || null;
}

const isAppLink = (href: string) => href.startsWith(`${APP_LINK_PROTOCOL}:`);

/**
 * Clicks and taps on links in the text. A browser does not follow a link
 * inside editable content, so the editor does it: an ordinary link opens
 * in a new tab, keeping the document where it is. `vapor:` links act
 * instead of navigating: `vapor://invite` opens the Agents panel,
 * `vapor://new` the New document dialog, `vapor://signin` the Sign in
 * dialog. The Link mark must list the protocol (`protocols:
 * [APP_LINK_PROTOCOL]`) or it drops the address on render.
 *
 * Mouse clicks are handled on `click`. On touch the tap is handled at
 * `touchend`, the only event WebKit honours for cancelling, so tapping a
 * link doesn't also focus the editor and raise the keyboard.
 */
export const AppLinks = Extension.create<{ onAppLink?: AppLinkHandler }, AppLinksStorage>({
  name: "appLinks",
  addOptions() {
    return { onAppLink: undefined };
  },
  addStorage() {
    return { onAppLink: this.options.onAppLink ?? null };
  },
  addCommands() {
    return {
      setAppLinkHandler: (handler) => () => {
        this.storage.onAppLink = handler;
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    const follow = (href: string) => {
      if (isAppLink(href)) storage.onAppLink?.(href);
      else window.open(href, "_blank", NEW_TAB_FEATURES);
    };
    let touchStart: { x: number; y: number } | null = null;

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            click(_view, event) {
              const href = hrefAt(event.target);
              if (href === null) return false;
              event.preventDefault();
              follow(href);
              return true;
            },
            touchstart(_view, event) {
              touchStart = touchPoint(event);
              return false;
            },
            touchend(_view, event) {
              const end = touchPoint(event);
              const moved =
                touchStart && end ? Math.hypot(end.x - touchStart.x, end.y - touchStart.y) > TAP_SLOP_PX : false;
              touchStart = null;
              if (moved) return false;
              const href = hrefAt(event.target);
              if (href === null) return false;
              event.preventDefault();
              follow(href);
              return true;
            },
          },
        },
      }),
    ];
  },
});
