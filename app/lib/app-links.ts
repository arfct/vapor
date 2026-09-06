import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

/** Links with this scheme are actions in the app, not places to navigate. */
export const APP_LINK_PROTOCOL = "vapor";

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

function appLinkAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const href = target.closest("a[href]")?.getAttribute("href") ?? "";
  return href.startsWith(`${APP_LINK_PROTOCOL}:`) ? href : null;
}

/**
 * `vapor:` links act instead of navigating: `vapor://invite` opens the
 * Agents panel. The editor's Link mark must list the protocol
 * (`protocols: [APP_LINK_PROTOCOL]`) or it drops the address on render.
 *
 * Mouse clicks are handled on `click`. On touch the tap is cancelled at
 * `touchend`, the only event WebKit honours for that, so tapping a link
 * doesn't also focus the editor and raise the keyboard.
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
    const fire = (url: string) => storage.onAppLink?.(url);
    let touchStart: { x: number; y: number } | null = null;

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            click(_view, event) {
              const url = appLinkAt(event.target);
              if (url === null) return false;
              event.preventDefault();
              fire(url);
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
              const url = appLinkAt(event.target);
              if (url === null) return false;
              event.preventDefault();
              fire(url);
              return true;
            },
          },
        },
      }),
    ];
  },
});
