// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { AppLinks, APP_LINK_PROTOCOL } from "~/lib/app-links";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(onAppLink: (url: string) => void) {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, link: { openOnClick: false, protocols: [APP_LINK_PROTOCOL] } }),
      AppLinks.configure({ onAppLink }),
    ],
    content: '<p>Read on, or <a href="vapor://invite">invite an agent</a>, or visit <a href="https://example.com">the web</a>.</p>',
  });
  return editor;
}

function touch(target: Element, type: "touchstart" | "touchend", x = 10, y = 10) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "changedTouches", { value: [{ clientX: x, clientY: y }] });
  target.dispatchEvent(event);
  return event;
}

describe("AppLinks", () => {
  it("keeps the vapor: address on the rendered link", () => {
    const ed = createEditor(vi.fn());
    expect(ed.view.dom.querySelector('a[href="vapor://invite"]')).not.toBeNull();
  });

  it("a click on an app link fires the handler and goes nowhere", () => {
    const onAppLink = vi.fn();
    const ed = createEditor(onAppLink);
    const link = ed.view.dom.querySelector('a[href="vapor://invite"]')!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(onAppLink).toHaveBeenCalledWith("vapor://invite");
    expect(click.defaultPrevented).toBe(true);
  });

  it("a tap on an app link fires the handler and cancels the tap", () => {
    const onAppLink = vi.fn();
    const ed = createEditor(onAppLink);
    const link = ed.view.dom.querySelector('a[href="vapor://invite"]')!;
    touch(link, "touchstart");
    const end = touch(link, "touchend");
    expect(onAppLink).toHaveBeenCalledWith("vapor://invite");
    expect(end.defaultPrevented).toBe(true);
  });

  it("leaves ordinary links and plain text alone", () => {
    const onAppLink = vi.fn();
    const ed = createEditor(onAppLink);
    const web = ed.view.dom.querySelector('a[href="https://example.com"]')!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    web.dispatchEvent(click);
    touch(web, "touchstart");
    const end = touch(web, "touchend");
    expect(onAppLink).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
    expect(end.defaultPrevented).toBe(false);
  });

  it("setAppLinkHandler swaps the handler", () => {
    const first = vi.fn();
    const second = vi.fn();
    const ed = createEditor(first);
    ed.commands.setAppLinkHandler(second);
    const link = ed.view.dom.querySelector('a[href="vapor://invite"]')!;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("vapor://invite");
  });
});
