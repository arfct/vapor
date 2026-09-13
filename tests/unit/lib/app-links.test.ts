// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { AppLinks, APP_LINK_PROTOCOL, Link, NEW_TAB_FEATURES } from "~/lib/app-links";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(onAppLink: (url: string) => void) {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, link: false }),
      Link.configure({ openOnClick: false, protocols: [APP_LINK_PROTOCOL] }),
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

  it("a click or a tap on an ordinary link opens it in a new tab", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const onAppLink = vi.fn();
    const ed = createEditor(onAppLink);
    const web = ed.view.dom.querySelector('a[href="https://example.com"]')!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    web.dispatchEvent(click);
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", NEW_TAB_FEATURES);
    expect(click.defaultPrevented).toBe(true);
    touch(web, "touchstart");
    const end = touch(web, "touchend");
    expect(open).toHaveBeenCalledTimes(2);
    expect(end.defaultPrevented).toBe(true);
    expect(onAppLink).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("leaves plain text alone", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const ed = createEditor(vi.fn());
    const text = ed.view.dom.querySelector("p")!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    text.dispatchEvent(click);
    const end = touch(text, "touchend");
    expect(open).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
    expect(end.defaultPrevented).toBe(false);
    open.mockRestore();
  });

  it("renders every link to open in a new tab, even one stored with target null", () => {
    const ed = createEditor(vi.fn());
    ed.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "imported", marks: [{ type: "link", attrs: { href: "https://example.com/x", target: null, rel: null } }] }],
        },
      ],
    });
    const a = ed.view.dom.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(ed.getJSON().content?.[0].content?.[0].marks?.[0].attrs).toMatchObject({ href: "https://example.com/x", target: null });
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
