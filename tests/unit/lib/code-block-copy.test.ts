// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { EditorView } from "@tiptap/pm/view";
import { parseMarkdown } from "~/shared/rich-markdown";
import { CodeBlockCopy, codeBlockCopyDecorations, createCopyButton } from "~/lib/code-block-copy";

const CODE = "const a = 1;\nconsole.log(a);";
const MARKDOWN = `Intro paragraph\n\n\`\`\`js\n${CODE}\n\`\`\`\n\nOutro`;

function parseDoc(markdown: string) {
  const parsed = parseMarkdown(markdown);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.doc;
}

function fakeView(doc: ReturnType<typeof parseDoc>): EditorView {
  return { state: { doc } } as unknown as EditorView;
}

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

function removeClipboard() {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
}

describe("codeBlockCopyDecorations", () => {
  it("adds one widget at the start of each code block's content", () => {
    const doc = parseDoc(MARKDOWN);
    const found = codeBlockCopyDecorations(doc).find();
    expect(found).toHaveLength(1);

    let codeBlockPos = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") codeBlockPos = pos;
    });
    expect(found[0].from).toBe(codeBlockPos + 1);
    expect(found[0].to).toBe(codeBlockPos + 1);
  });

  it("returns an empty set for a document without code blocks", () => {
    const doc = parseDoc("Just a paragraph");
    expect(codeBlockCopyDecorations(doc).find()).toHaveLength(0);
  });

  it("decorates every code block", () => {
    const doc = parseDoc("```\none\n```\n\n```\ntwo\n```");
    expect(codeBlockCopyDecorations(doc).find()).toHaveLength(2);
  });
});

describe("createCopyButton", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeText = vi.fn(() => Promise.resolve());
    mockClipboard(writeText as (text: string) => Promise<void>);
  });

  afterEach(() => {
    vi.useRealTimers();
    removeClipboard();
  });

  function buttonForDoc(markdown: string) {
    const doc = parseDoc(markdown);
    const [deco] = codeBlockCopyDecorations(doc).find();
    return createCopyButton(fakeView(doc), () => deco.from);
  }

  it("is non-editable UI with an accessible label", () => {
    const button = buttonForDoc(MARKDOWN);
    expect(button.tagName).toBe("BUTTON");
    expect(button.contentEditable).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Copy code");
    expect(button.querySelector(".material-symbols-outlined")?.textContent).toBe("content_copy");
  });

  it("copies the code block's plain text on click", async () => {
    const button = buttonForDoc(MARKDOWN);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledWith(CODE);
  });

  it("shows a check icon briefly after copying", async () => {
    const button = buttonForDoc(MARKDOWN);
    const icon = button.querySelector(".material-symbols-outlined")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(icon.textContent).toBe("check");
    await vi.advanceTimersByTimeAsync(1500);
    expect(icon.textContent).toBe("content_copy");
  });

  it("swallows mousedown so the caret stays put", () => {
    const button = buttonForDoc(MARKDOWN);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const parentSpy = vi.fn();
    const wrapper = document.createElement("div");
    wrapper.appendChild(button);
    wrapper.addEventListener("mousedown", parentSpy);
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(parentSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the position is no longer inside a code block", async () => {
    const doc = parseDoc(MARKDOWN);
    const button = createCopyButton(fakeView(doc), () => 1);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("CodeBlockCopy extension", () => {
  it("renders the button inside the code block's pre", () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ undoRedo: false }), CodeBlockCopy],
      content: "<pre><code>let x = 1;</code></pre><p>after</p>",
    });
    try {
      const button = editor.view.dom.querySelector("pre .code-copy");
      expect(button).not.toBeNull();
      expect(editor.getText()).toContain("let x = 1;");
    } finally {
      editor.destroy();
    }
  });
});
