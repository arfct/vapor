// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight } from "~/lib/critic-marks";
import { CommentClickHandler } from "~/lib/comment-click";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(onCommentClick: (text: string) => void) {
  editor = new Editor({
    extensions: [Document, Paragraph, Text, CriticAddition, CriticDeletion, CriticComment, CriticHighlight, CommentClickHandler.configure({ onCommentClick })],
    content: '<p>plain <span class="cm-highlight">lasts 99 hours</span><span class="cm-comment">Be specific</span> after</p>',
  });
  return editor;
}

function touch(target: Element, type: "touchstart" | "touchend", x = 10, y = 10) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "changedTouches", { value: [{ clientX: x, clientY: y }] });
  target.dispatchEvent(event);
  return event;
}

describe("CommentClickHandler on touch", () => {
  it("a tap on a comment opens its thread and cancels the tap so the editor keeps no focus", () => {
    const onCommentClick = vi.fn();
    const ed = createEditor(onCommentClick);
    const comment = ed.view.dom.querySelector(".cm-comment")!;
    touch(comment, "touchstart");
    const end = touch(comment, "touchend");
    expect(onCommentClick).toHaveBeenCalledWith("Be specific");
    expect(end.defaultPrevented).toBe(true);
  });

  it("a tap on the highlighted text opens the adjacent comment", () => {
    const onCommentClick = vi.fn();
    const ed = createEditor(onCommentClick);
    const highlight = ed.view.dom.querySelector(".cm-highlight")!;
    touch(highlight, "touchstart");
    const end = touch(highlight, "touchend");
    expect(onCommentClick).toHaveBeenCalledWith("Be specific");
    expect(end.defaultPrevented).toBe(true);
  });

  it("a tap on plain text is left to the browser", () => {
    const onCommentClick = vi.fn();
    const ed = createEditor(onCommentClick);
    const paragraph = ed.view.dom.querySelector("p")!;
    touch(paragraph.firstChild!.parentElement!, "touchstart");
    const end = touch(paragraph, "touchend");
    expect(onCommentClick).not.toHaveBeenCalled();
    expect(end.defaultPrevented).toBe(false);
  });

  it("setCommentClickHandler swaps the callback the tap invokes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const ed = createEditor(first);
    ed.commands.setCommentClickHandler(second);
    const comment = ed.view.dom.querySelector(".cm-comment")!;
    touch(comment, "touchstart");
    touch(comment, "touchend");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("Be specific");
  });

  it("a drag that ends on a comment is a scroll, not a tap", () => {
    const onCommentClick = vi.fn();
    const ed = createEditor(onCommentClick);
    const comment = ed.view.dom.querySelector(".cm-comment")!;
    touch(comment, "touchstart", 10, 10);
    const end = touch(comment, "touchend", 10, 80);
    expect(onCommentClick).not.toHaveBeenCalled();
    expect(end.defaultPrevented).toBe(false);
  });
});
