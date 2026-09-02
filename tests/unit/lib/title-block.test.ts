// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TitleBlock } from "~/lib/title-block";

function makeEditor(content = "<p></p>") {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, underline: false }),
      TitleBlock,
    ],
    content,
  });
}

describe("TitleBlock", () => {
  it("turns the first line of an empty document into a heading as you type", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("Plan");
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.firstChild?.attrs.level).toBe(1);
    expect(editor.state.doc.firstChild?.textContent).toBe("Plan");
    editor.destroy();
  });

  it("leaves a document that already has content alone", () => {
    const editor = makeEditor("<p>Existing</p><p>More</p>");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent("!");
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    editor.destroy();
  });

  it("Enter at the end of the title starts a body paragraph", () => {
    const editor = makeEditor("<h1>Plan</h1>");
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize - 1);
    editor.commands.splitBlock();
    // StarterKit's TrailingNode may add one more empty paragraph after it.
    expect(editor.state.doc.childCount).toBeGreaterThanOrEqual(2);
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    expect([...editor.state.doc.content.content].filter((n) => n.type.name === "heading")).toHaveLength(1);
    editor.destroy();
  });

  it("Backspace at the very start of a heading demotes it to body text", () => {
    const editor = makeEditor("<h1>Plan</h1>");
    editor.commands.setTextSelection(1);
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.firstChild?.textContent).toBe("Plan");
    editor.destroy();
  });

  it("shows Title and Body placeholders on the empty first and second lines only", () => {
    const editor = makeEditor("<h1></h1><p></p>");
    const placeholders = [...editor.view.dom.querySelectorAll(".is-empty")].map((el) =>
      el.getAttribute("data-placeholder"),
    );
    // A trailing paragraph (StarterKit's TrailingNode) shows no placeholder.
    expect(placeholders.slice(0, 2)).toEqual(["Title", "Body"]);
    expect(placeholders.slice(2).every((p) => p === "")).toBe(true);

    // Once the body has text, no block carries a placeholder at all.
    const longer = makeEditor("<h1>Plan</h1><p>Body</p><p></p>");
    expect(longer.view.dom.querySelector(".is-empty")).toBeNull();
    editor.destroy();
    longer.destroy();
  });
});
