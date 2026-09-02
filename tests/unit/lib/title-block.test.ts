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

  it("shows both placeholders on an empty document, the title at heading size", () => {
    const editor = makeEditor("<p></p>");
    const first = editor.view.dom.querySelector(".is-empty");
    expect(first?.getAttribute("data-placeholder")).toBe("Title");
    expect(first?.classList.contains("is-title")).toBe(true);
    const body = editor.view.dom.querySelector(".placeholder-body");
    expect(body?.textContent).toBe("Body");
    expect(body?.getAttribute("contenteditable")).toBe("false");
    editor.destroy();
  });

  it("moves the body hint onto the real second line once it exists", () => {
    const editor = makeEditor("<h1>Plan</h1><p></p>");
    expect(editor.view.dom.querySelector(".placeholder-body")).toBeNull();
    const placeholders = [...editor.view.dom.querySelectorAll(".is-empty")].map((el) =>
      el.getAttribute("data-placeholder"),
    );
    expect(placeholders[0]).toBe("Body");
    editor.destroy();
  });

  it("shows no placeholders once the body has text", () => {
    const longer = makeEditor("<h1>Plan</h1><p>Body</p><p></p>");
    expect(longer.view.dom.querySelector(".is-empty")).toBeNull();
    expect(longer.view.dom.querySelector(".placeholder-body")).toBeNull();
    longer.destroy();
  });
});