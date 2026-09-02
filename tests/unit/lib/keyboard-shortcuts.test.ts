// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";
import { BlockId } from "~/lib/block-id";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight } from "~/lib/critic-marks";
import { suggestModePlugin } from "~/lib/suggest-mode";
import { KeyboardShortcuts, withFreshBlockIds } from "~/lib/keyboard-shortcuts";
import { showSuggestNotice, SUGGEST_NOTICE_DEFAULT, SUGGEST_NOTICE_MS } from "~/lib/suggest-notice";

type Mode = "edit" | "suggest";

function modeSource(mode: Mode) {
  return { get: (key: string) => (key === "mode" ? mode : undefined) };
}

const SuggestMode = Extension.create<{ docState: ReturnType<typeof modeSource> }>({
  name: "suggestMode",
  addProseMirrorPlugins() {
    return [suggestModePlugin(this.options.docState)];
  },
});

function makeEditor(content: string, mode: Mode = "edit") {
  const docState = modeSource(mode);
  return new Editor({
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        underline: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      BlockId,
      CriticAddition,
      CriticDeletion,
      CriticComment,
      CriticHighlight,
      SuggestMode.configure({ docState }),
      KeyboardShortcuts.configure({ docState }),
    ],
    content,
  });
}

/**
 * Dispatches a real keydown so handlers run exactly as in the browser
 * (TipTap's `keyboardShortcut` command replays steps but drops the
 * selection a handler sets). jsdom is non-mac, so `Mod` is Ctrl.
 */
function press(editor: Editor, shortcut: string) {
  const parts = shortcut.split(/-(?!$)/);
  const key = parts.pop()!;
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: parts.includes("Mod") || parts.includes("Ctrl"),
    shiftKey: parts.includes("Shift"),
    altKey: parts.includes("Alt"),
    bubbles: true,
    cancelable: true,
  });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

function typeAt(editor: Editor, pos: number, text: string) {
  editor.commands.setTextSelection(pos);
  return editor.view.someProp("handleTextInput", (f) => f(editor.view, pos, pos, text));
}

function paste(editor: Editor, data: Record<string, string>) {
  const event = {
    clipboardData: { getData: (type: string) => data[type] ?? "" },
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
  const handled = editor.view.someProp("handleDOMEvents", (handlers) => handlers.paste?.(editor.view, event));
  return { handled: Boolean(handled), event };
}

function blocks(editor: Editor): PMNode[] {
  const out: PMNode[] = [];
  editor.state.doc.forEach((node) => out.push(node));
  return out;
}

function marksOn(editor: Editor, text: string): string[] {
  let found: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text === text) found = node.marks.map((m) => m.type.name);
  });
  return found;
}

function notice() {
  return document.querySelector(".suggest-notice");
}

let editors: Editor[] = [];
function open(content: string, mode: Mode = "edit") {
  const editor = makeEditor(content, mode);
  editors.push(editor);
  return editor;
}

afterEach(() => {
  editors.forEach((e) => e.destroy());
  editors = [];
  notice()?.remove();
  vi.useRealTimers();
});

describe("Tab / Shift-Tab ladder", () => {
  it("Tab lowers h1 → h2 → h3 → paragraph → bullet list", () => {
    const editor = open("<h1>Title</h1>");
    editor.commands.setTextSelection(2);
    const first = () => blocks(editor)[0];

    press(editor, "Tab");
    expect(first().attrs.level).toBe(2);
    press(editor, "Tab");
    expect(first().attrs.level).toBe(3);
    press(editor, "Tab");
    expect(first().type.name).toBe("paragraph");
    press(editor, "Tab");
    expect(first().type.name).toBe("bulletList");
    expect(first().firstChild?.firstChild?.textContent).toBe("Title");
  });

  it("Shift-Tab raises paragraph → h3 → h2 → h1 and stops there", () => {
    const editor = open("<p>Title</p>");
    editor.commands.setTextSelection(2);
    press(editor, "Shift-Tab");
    expect(editor.getHTML()).toContain("<h3");
    press(editor, "Shift-Tab");
    expect(editor.getHTML()).toContain("<h2");
    press(editor, "Shift-Tab");
    expect(editor.getHTML()).toContain("<h1");
    press(editor, "Shift-Tab");
    expect(editor.getHTML()).toContain("<h1");
  });

  it("leaves list items to StarterKit's sink/lift", () => {
    const editor = open("<ul><li><p>One</p></li><li><p>Two</p></li></ul>");
    editor.commands.setTextSelection(editor.state.doc.content.size - 3);
    press(editor, "Tab");
    expect(editor.getHTML()).toMatch(/<li[^>]*><p[^>]*>One<\/p><ul[^>]*><li[^>]*><p[^>]*>Two<\/p>/);
  });
});

describe("Mod-d duplicate block", () => {
  it("inserts a copy after the block with a fresh blockId", () => {
    const editor = open("<h2>Title</h2><p>Body</p>");
    editor.commands.setTextSelection(2);
    press(editor, "Mod-d");

    const [original, copy, body] = blocks(editor);
    expect(blocks(editor)).toHaveLength(3);
    expect(copy.type.name).toBe("heading");
    expect(copy.textContent).toBe("Title");
    expect(body.textContent).toBe("Body");
    expect(original.attrs.blockId).toBeTruthy();
    expect(copy.attrs.blockId).toBeTruthy();
    expect(copy.attrs.blockId).not.toBe(original.attrs.blockId);
    expect(editor.state.selection.$from.index(0)).toBe(1);
  });

  it("withFreshBlockIds re-mints nested block ids too", () => {
    const editor = open("<ul><li><p>One</p></li></ul>");
    editor.commands.insertContentAt(editor.state.doc.content.size, "<p>tick</p>");
    const list = blocks(editor)[0];
    const copy = withFreshBlockIds(list);
    expect(copy.attrs.blockId).not.toBe(list.attrs.blockId);
    const nestedOriginal = list.firstChild!.firstChild!;
    const nestedCopy = copy.firstChild!.firstChild!;
    expect(nestedCopy.textContent).toBe("One");
    expect(nestedCopy.attrs.blockId).not.toBe(nestedOriginal.attrs.blockId);
  });
});

describe("Mod-Ctrl-ArrowUp/Down move block", () => {
  it("swaps the block with its neighbour and keeps the caret in it", () => {
    const editor = open("<p>One</p><p>Two</p><p>Three</p>");
    editor.commands.setTextSelection(3);
    press(editor, "Mod-Ctrl-ArrowDown");
    expect(blocks(editor).map((b) => b.textContent)).toEqual(["Two", "One", "Three"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("One");
    expect(editor.state.selection.$from.parentOffset).toBe(2);

    press(editor, "Mod-Ctrl-ArrowUp");
    expect(blocks(editor).map((b) => b.textContent)).toEqual(["One", "Two", "Three"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("One");
  });

  it("is a no-op at the document edge", () => {
    const editor = open("<p>One</p><p>Two</p>");
    editor.commands.setTextSelection(2);
    press(editor, "Mod-Ctrl-ArrowUp");
    expect(blocks(editor).map((b) => b.textContent)).toEqual(["One", "Two"]);
  });
});

describe("Mod-Enter insert paragraph", () => {
  it("inserts an empty paragraph after the current block and moves the caret into it", () => {
    const editor = open("<h1>Title</h1><p>Body</p>");
    editor.commands.setTextSelection(2);
    press(editor, "Mod-Enter");
    expect(blocks(editor).map((b) => b.textContent)).toEqual(["Title", "", "Body"]);
    expect(editor.state.selection.$from.index(0)).toBe(1);
  });

  it("stays available in suggest mode and typing into it is tracked", () => {
    const editor = open("<p>Body</p>", "suggest");
    editor.commands.setTextSelection(2);
    press(editor, "Mod-Enter");
    expect(blocks(editor)).toHaveLength(2);
    typeAt(editor, editor.state.selection.from, "x");
    expect(marksOn(editor, "x")).toEqual(["criticAddition"]);
    expect(notice()).toBeNull();
  });
});

describe("Mod-\\ clear formatting", () => {
  it("strips bold but keeps criticAddition", () => {
    const editor = open("<p>hello</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.setMark("criticAddition");
    editor.commands.setBold();
    editor.commands.setItalic();
    expect(marksOn(editor, "hello")).toEqual(expect.arrayContaining(["bold", "italic", "criticAddition"]));

    press(editor, "Mod-\\");
    expect(marksOn(editor, "hello")).toEqual(["criticAddition"]);
  });
});

describe("typography input rules", () => {
  it("turns -> into →", () => {
    const editor = open("<p>a-</p>");
    expect(typeAt(editor, 3, ">")).toBe(true);
    expect(editor.state.doc.textContent).toBe("a→");
  });

  it("turns -- into – and ... into …", () => {
    const dash = open("<p>a-</p>");
    typeAt(dash, 3, "-");
    expect(dash.state.doc.textContent).toBe("a–");

    const dots = open("<p>a..</p>");
    typeAt(dots, 4, ".");
    expect(dots.state.doc.textContent).toBe("a…");
  });

  it("leaves --- alone so the horizontal rule input rule still fires", () => {
    const editor = open("<p>--</p>");
    typeAt(editor, 3, "-");
    expect(editor.state.doc.textContent).toBe("");
    expect(blocks(editor).some((b) => b.type.name === "horizontalRule")).toBe(true);
  });

  it("tracks the replacement as CriticMarkup in suggest mode", () => {
    const editor = open("<p>a-</p>", "suggest");
    typeAt(editor, 3, ">");
    expect(editor.state.doc.textContent).toBe("a-→");
    expect(marksOn(editor, "-")).toEqual(["criticDeletion"]);
    expect(marksOn(editor, "→")).toEqual(["criticAddition"]);
  });

  it("edits an existing addition in place in suggest mode", () => {
    const editor = open("<p>a</p>", "suggest");
    typeAt(editor, 2, "-");
    expect(marksOn(editor, "-")).toEqual(["criticAddition"]);
    typeAt(editor, 3, ">");
    expect(editor.state.doc.textContent).toBe("a→");
    expect(marksOn(editor, "→")).toEqual(["criticAddition"]);
  });
});

describe("smart link paste", () => {
  const URL = "https://example.com/page";

  it("links the selection when a URL is pasted over it", () => {
    const editor = open("<p>hello world</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const { handled, event } = paste(editor, { "text/plain": URL });
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(editor.getHTML()).toMatch(/<a [^>]*href="https:\/\/example\.com\/page"[^>]*>hello<\/a> world/);
  });

  it("inserts the clipboard title as link text for a bare URL", () => {
    const editor = open("<p>see:</p>");
    editor.commands.setTextSelection(5);
    const { handled } = paste(editor, {
      "text/plain": URL,
      "text/html": `<a href="${URL}">Example Page</a>`,
    });
    expect(handled).toBe(true);
    expect(editor.state.doc.textContent).toBe("see:Example Page");
    expect(marksOn(editor, "Example Page")).toEqual(["link"]);
  });

  it("falls back to the document <title>", () => {
    const editor = open("<p></p>");
    editor.commands.setTextSelection(1);
    paste(editor, {
      "text/plain": URL,
      "text/html": `<html><head><title>Example Title</title></head><body>${URL}</body></html>`,
    });
    expect(editor.state.doc.textContent).toBe("Example Title");
  });

  it("returns false for non-URL text and bare URLs without a title", () => {
    const editor = open("<p>hello</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(paste(editor, { "text/plain": "**bold**" }).handled).toBe(false);
    editor.commands.setTextSelection(6);
    expect(paste(editor, { "text/plain": URL }).handled).toBe(false);
    expect(editor.state.doc.textContent).toBe("hello");
  });

  it("blocks linking a selection in suggest mode but tracks a titled insert", () => {
    const editor = open("<p>hello world</p>", "suggest");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(paste(editor, { "text/plain": URL }).handled).toBe(true);
    expect(editor.getHTML()).not.toContain("<a ");
    expect(notice()?.textContent).toBe(SUGGEST_NOTICE_DEFAULT);

    editor.commands.setTextSelection(12);
    paste(editor, { "text/plain": URL, "text/html": `<a href="${URL}">Example</a>` });
    expect(marksOn(editor, "Example").sort()).toEqual(["criticAddition", "link"]);
  });
});

describe("suggest mode blocks structural shortcuts", () => {
  it.each([
    ["Tab", "<h1>Title</h1>"],
    ["Shift-Tab", "<p>Body</p>"],
    ["Mod-Ctrl-ArrowDown", "<p>One</p><p>Two</p>"],
    ["Mod-d", "<p>One</p>"],
  ])("%s is a no-op and shows the notice", (shortcut, content) => {
    const editor = open(content, "suggest");
    editor.commands.setTextSelection(2);
    const before = editor.getHTML();
    press(editor, shortcut);
    expect(editor.getHTML()).toBe(before);
    expect(notice()?.textContent).toBe(SUGGEST_NOTICE_DEFAULT);
  });

  it("Mod-\\ keeps formatting and shows the notice", () => {
    const editor = open("<p><strong>hello</strong></p>", "suggest");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    press(editor, "Mod-\\");
    expect(marksOn(editor, "hello")).toEqual(["bold"]);
    expect(notice()).not.toBeNull();
  });
});

describe("showSuggestNotice", () => {
  it("shows one element, restarts the timer on repeat, and auto-dismisses", () => {
    vi.useFakeTimers();
    showSuggestNotice();
    showSuggestNotice("Custom message");
    expect(document.querySelectorAll(".suggest-notice")).toHaveLength(1);
    expect(notice()?.textContent).toBe("Custom message");

    vi.advanceTimersByTime(SUGGEST_NOTICE_MS - 1);
    expect(notice()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(notice()).toBeNull();
  });
});
