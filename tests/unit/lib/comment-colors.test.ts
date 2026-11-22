// @vitest-environment jsdom
/**
 * Author-coloured comment ranges (CommentColors) and the point-comment
 * markers that read those colours (CriticPointMarkers), on a real editor.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import { CommentColors, commentColorsKey, commentColorAt } from "~/lib/comment-colors";
import {
  CriticAddition,
  CriticDeletion,
  CriticComment,
  CriticHighlight,
  CriticPointMarkers,
} from "~/lib/critic-marks";

function createEditor(html: string): Editor {
  return new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      CriticAddition,
      CriticDeletion,
      CriticComment,
      CriticHighlight,
      CommentColors,
      CriticPointMarkers,
    ],
    content: html,
  });
}

function decorationsOf(editor: Editor, key: string) {
  const plugin = editor.state.plugins.find((p) => (p as unknown as { key: string }).key.startsWith(key))!;
  const fn = plugin.props.decorations as (this: unknown, s: EditorState) => DecorationSet;
  return fn.call(plugin, editor.state);
}

function setColors(editor: Editor, ranges: { from: number; to: number; color: string }[]) {
  editor.view.dispatch(editor.state.tr.setMeta(commentColorsKey, ranges));
}

describe("CommentColors", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("starts empty and draws nothing", () => {
    editor = createEditor("<p>hello world</p>");
    expect(commentColorsKey.getState(editor.state)).toEqual([]);
    expect(commentColorAt(editor.state, 2)).toBeUndefined();
    expect(decorationsOf(editor, "commentColors")).toBe(DecorationSet.empty);
  });

  it("takes ranges from meta and decorates them with the author colour", () => {
    editor = createEditor("<p>hello world</p>");
    setColors(editor, [{ from: 1, to: 6, color: "#f00" }]);
    expect(commentColorAt(editor.state, 3)).toBe("#f00");
    expect(commentColorAt(editor.state, 6)).toBe("#f00");
    expect(commentColorAt(editor.state, 8)).toBeUndefined();

    const found = decorationsOf(editor, "commentColors").find();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ from: 1, to: 6 });
    expect((found[0] as unknown as { type: { attrs: Record<string, string> } }).type.attrs).toEqual({
      class: "cm-colored",
      style: "--comment-color: #f00",
    });
    expect(editor.view.dom.querySelector(".cm-colored")?.textContent).toBe("hello");
  });

  it("maps ranges through edits and drops ranges that collapse", () => {
    editor = createEditor("<p>hello world</p>");
    setColors(editor, [
      { from: 1, to: 6, color: "#f00" },
      { from: 7, to: 12, color: "#0f0" },
    ]);
    editor.view.dispatch(editor.state.tr.insertText("XX", 1));
    expect(commentColorsKey.getState(editor.state)).toEqual([
      { from: 3, to: 8, color: "#f00" },
      { from: 9, to: 14, color: "#0f0" },
    ]);

    editor.view.dispatch(editor.state.tr.delete(9, 14));
    expect(commentColorsKey.getState(editor.state)).toEqual([{ from: 3, to: 8, color: "#f00" }]);
  });

  it("keeps ranges on selection-only transactions", () => {
    editor = createEditor("<p>hello world</p>");
    setColors(editor, [{ from: 1, to: 6, color: "#f00" }]);
    const before = commentColorsKey.getState(editor.state);
    editor.commands.setTextSelection(3);
    expect(commentColorsKey.getState(editor.state)).toBe(before);
  });
});

describe("CriticPointMarkers", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("draws nothing without critic marks", () => {
    editor = createEditor("<p>plain</p><p>text</p>");
    expect(decorationsOf(editor, "criticPointMarkers")).toBe(DecorationSet.empty);
  });

  it("marks a standalone comment, coloured by its author", () => {
    editor = createEditor('<p>see <span class="cm-comment">note</span> here</p>');
    expect(editor.view.dom.querySelectorAll(".cm-point-marker")).toHaveLength(1);
    expect(editor.view.dom.querySelector(".cm-point-marker")?.getAttribute("aria-label")).toBe("Comment");

    setColors(editor, [{ from: 5, to: 9, color: "#123456" }]);
    const marker = editor.view.dom.querySelector<HTMLElement>(".cm-point-marker")!;
    expect(marker.style.getPropertyValue("--comment-color")).toBe("#123456");
  });

  it("skips a comment paired with a preceding highlight", () => {
    editor = createEditor(
      '<p><span class="cm-highlight">quoted</span><span class="cm-comment">why?</span></p>',
    );
    expect(editor.view.dom.querySelectorAll(".cm-point-marker")).toHaveLength(0);
  });

  it("splits runs at non-text nodes and mark changes", () => {
    editor = createEditor(
      '<p><span class="cm-addition">add</span><span class="cm-comment">a</span></p>' +
        '<p><span class="cm-comment">b</span> mid <span class="cm-deletion">del</span></p>' +
        '<p><span class="cm-comment">c</span></p>',
    );
    // a (after an addition, not a highlight), b, c are all point comments.
    expect(editor.view.dom.querySelectorAll(".cm-point-marker")).toHaveLength(3);
  });

  it("renders highlight thread ids", () => {
    editor = createEditor('<p><span class="cm-highlight">x</span></p>');
    editor.commands.setTextSelection({ from: 1, to: 2 });
    editor.commands.setMark("criticHighlight", { threadId: "t-1" });
    expect(editor.getHTML()).toContain('data-thread-id="t-1"');
    expect(editor.view.dom.querySelector(".cm-addition, .cm-deletion")).toBeNull();
  });

  it("round-trips addition and deletion marks through HTML", () => {
    editor = createEditor('<p><span class="cm-addition">new</span> <span class="cm-deletion">old</span></p>');
    expect(editor.getHTML()).toBe('<p><span class="cm-addition">new</span> <span class="cm-deletion">old</span></p>');
  });
});
