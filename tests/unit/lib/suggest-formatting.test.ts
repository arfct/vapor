// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight } from "~/lib/critic-marks";
import { suggestModePlugin } from "~/lib/suggest-mode";
import { SuggestFormatting, SuggestStructureGuard } from "~/lib/suggest-formatting";
import { serializePmDoc } from "~/shared/rich-markdown";

type Mode = "edit" | "suggest";

function makeEditor(html: string, mode: Mode) {
  const docState = { get: (key: string) => (key === "mode" ? mode : undefined) };
  const SuggestMode = Extension.create({
    name: "suggestMode",
    addProseMirrorPlugins: () => [suggestModePlugin(docState)],
  });
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, underline: false }),
      CriticAddition,
      CriticDeletion,
      CriticComment,
      CriticHighlight,
      SuggestMode,
      SuggestFormatting.configure({ docState }),
      SuggestStructureGuard.configure({ docState }),
    ],
    content: html,
  });
}

function marksAt(editor: Editor, text: string): string[] {
  let found: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text === text) found = node.marks.map((m) => m.type.name).sort();
  });
  return found;
}

/** Selects the first occurrence of `text` in the document. */
function select(editor: Editor, text: string) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text?.includes(text)) {
      from = pos + (node.text.indexOf(text) ?? 0);
    }
  });
  editor.commands.setTextSelection({ from, to: from + text.length });
}

afterEach(() => {
  document.querySelectorAll(".suggest-notice").forEach((el) => el.remove());
});

describe("SuggestFormatting", () => {
  it("edit mode: toggleBold formats directly, nothing tracked", () => {
    const editor = makeEditor("<p>hello world</p>", "edit");
    select(editor, "world");
    editor.commands.toggleBold();
    expect(marksAt(editor, "world")).toEqual(["bold"]);
    expect(serializePmDoc(editor.state.doc)).toBe("hello **world**");
    editor.destroy();
  });

  it("suggest mode: toggleBold becomes a deletion plus a bold addition", () => {
    const editor = makeEditor("<p>hello world</p>", "suggest");
    select(editor, "world");
    editor.commands.toggleBold();
    const md = serializePmDoc(editor.state.doc);
    expect(md).toContain("{--world--}");
    expect(md).toContain("{++world++}");
    expect(md).toContain("**");
    // The addition carries both marks; the original is only marked deleted.
    const texts: string[][] = [];
    editor.state.doc.descendants((n) => {
      if (n.isText && n.text === "world") texts.push(n.marks.map((m) => m.type.name).sort());
    });
    expect(texts).toEqual([["criticDeletion"], ["bold", "criticAddition"]]);
    editor.destroy();
  });

  it("suggest mode: unsetting a mark is tracked the same way", () => {
    const editor = makeEditor("<p>hello <strong>world</strong></p>", "suggest");
    select(editor, "world");
    editor.commands.toggleBold();
    const texts: string[][] = [];
    editor.state.doc.descendants((n) => {
      if (n.isText && n.text === "world") texts.push(n.marks.map((m) => m.type.name).sort());
    });
    expect(texts).toEqual([["bold", "criticDeletion"], ["criticAddition"]]);
    editor.destroy();
  });

  it("suggest mode: text inside a pending addition is formatted directly", () => {
    const editor = makeEditor("<p>hello world</p>", "suggest");
    // Type an addition, then bold it.
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.someProp("handleTextInput", (f) => f(editor.view, editor.state.selection.from, editor.state.selection.from, " draft"));
    select(editor, "draft");
    editor.commands.toggleBold();
    expect(marksAt(editor, "draft")).toEqual(["bold", "criticAddition"]);
    expect(serializePmDoc(editor.state.doc)).not.toContain("{--");
    editor.destroy();
  });

  it("suggest mode: a structural shortcut is swallowed with a notice", () => {
    const editor = makeEditor("<p>hello world</p>", "suggest");
    editor.commands.setTextSelection(3);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", ctrlKey: true, altKey: true, bubbles: true }),
    );
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
    expect(document.querySelector(".suggest-notice")).not.toBeNull();
    editor.destroy();
  });

  it("edit mode: the same shortcut still makes a heading", () => {
    const editor = makeEditor("<p>hello world</p>", "edit");
    editor.commands.setTextSelection(3);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", ctrlKey: true, altKey: true, bubbles: true }),
    );
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    editor.destroy();
  });
});
